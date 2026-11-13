import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCookieStatus, resolveCookiesFile } from "./ytdlp";

export type QuotaInfo = {
  source: "vercel_api" | "internal_estimate";
  used: number;
  limit: number;
  remaining: number;
  percentRemaining: number;
  resetDate: string;
  monthLabel: string;
  isExhausted: boolean;
  debug?: {
    hasToken: boolean;
    tokenLength?: number;
    userStatus?: number;
    username?: string;
    teamId?: string | null;
    usageStatus?: number;
    usageError?: string;
    hasCookies?: boolean;
    cookieCount?: number;
    hasLoginCookies?: boolean;
  };
  vercelDetails?: {
    cpuUsedHours?: number;
    cpuLimitHours?: number;
    bandwidthUsedGB?: number;
    bandwidthLimitGB?: number;
    invocations?: number;
  };
};

const DEFAULT_MONTHLY_LIMIT = 1200;

const redisUrl =
  process.env.UPSTASH_REDIS_REST_URL?.trim() ||
  process.env.KV_REST_API_URL?.trim() ||
  "";
const redisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
  process.env.KV_REST_API_TOKEN?.trim() ||
  "";

const LOCAL_QUOTA_FILE = path.join(
  process.env.NODE_ENV === "production" ? os.tmpdir() : process.cwd(),
  ".ytaudio-quota.json",
);

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

let vercelCache: { at: number; data: QuotaInfo } | null = null;
const VERCEL_CACHE_TTL_MS = 60 * 1000;
let lastDebugInfo: NonNullable<QuotaInfo["debug"]> = { hasToken: false };

function getMonthKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `ytaudio_quota_${year}_${month}`;
}

function getMonthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getResetDateLabel(date: Date): string {
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return `1 ${MONTH_NAMES[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`;
}

/**
 * Directly queries the official Vercel REST API for live account resource usage.
 */
async function fetchVercelApiUsage(token: string): Promise<QuotaInfo | null> {
  const cookieStatus = getCookieStatus();
  lastDebugInfo = {
    hasToken: true,
    tokenLength: token.length,
    hasCookies: cookieStatus.active,
    cookieCount: cookieStatus.count,
    hasLoginCookies: cookieStatus.hasLogin,
  };

  // 1. Verify user & resolve team via Vercel /v2/user
  let teamId = process.env.VERCEL_TEAM_ID?.trim() || null;
  let username = "";
  try {
    const userRes = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    lastDebugInfo.userStatus = userRes.status;
    if (userRes.ok) {
      const userData = (await userRes.json()) as {
        user?: { username?: string; defaultTeamId?: string };
      };
      username = userData?.user?.username || "";
      lastDebugInfo.username = username;
      if (!teamId && userData?.user?.defaultTeamId) {
        teamId = userData.user.defaultTeamId;
      }
    } else {
      const errText = await userRes.text().catch(() => "");
      lastDebugInfo.usageError = `User verify failed (${userRes.status}): ${errText.slice(0, 200)}`;
      return null;
    }
  } catch (err) {
    lastDebugInfo.usageError = `User fetch error: ${err instanceof Error ? err.message : String(err)}`;
    return null;
  }

  lastDebugInfo.teamId = teamId;

  // 2. Query usage with required `type` parameter
  const now = new Date();
  const limitSongs = Number(process.env.MONTHLY_SONG_LIMIT) || DEFAULT_MONTHLY_LIMIT;

  const typeCandidates = [
    "bandwidth",
    "invocations",
    "execution",
    "serverlessFunctionExecution",
    "total",
  ];

  let rawUsageData: Record<string, unknown> | null = null;

  for (const typeCandidate of typeCandidates) {
    const url = new URL("https://api.vercel.com/v2/usage");
    url.searchParams.set("type", typeCandidate);
    if (teamId) url.searchParams.set("teamId", teamId);

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      lastDebugInfo.usageStatus = res.status;
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        rawUsageData = json;
        break;
      }
    } catch {
      // try next candidate
    }
  }

  // 3. Fallback tracking values if /v2/usage metrics array is empty or restricted on Hobby
  const monthKey = getMonthKey(now);
  let localUsed = 0;
  if (redisUrl && redisToken) {
    localUsed = await getRedisCount(monthKey);
  } else {
    localUsed = await getLocalCount(monthKey);
  }

  let cpuUsedHours = 0;
  let bandwidthUsedGB = 0;
  let invocations = localUsed;
  let usedSongs = localUsed;

  if (rawUsageData) {
    const execution = (rawUsageData.serverlessFunctionExecution || {}) as {
      usage?: number;
      metrics?: { computeTimeMs?: number; invocations?: number };
    };
    const bandwidth = (rawUsageData.bandwidth || {}) as { value?: number };

    if (typeof execution.usage === "number") {
      usedSongs = Math.max(localUsed, Math.min(limitSongs, Math.round((execution.usage / 100) * limitSongs)));
    }
    if (execution.metrics?.computeTimeMs) {
      cpuUsedHours = Math.round((execution.metrics.computeTimeMs / (1000 * 3600)) * 100) / 100;
    }
    if (execution.metrics?.invocations) {
      invocations = execution.metrics.invocations;
    }
    if (bandwidth.value) {
      bandwidthUsedGB = Math.round((bandwidth.value / (1024 * 1024 * 1024)) * 100) / 100;
    }
  }

  const remainingSongs = Math.max(0, limitSongs - usedSongs);
  const percentRemaining = Math.max(
    0,
    Math.min(100, Math.round((remainingSongs / limitSongs) * 1000) / 10),
  );

  return {
    source: "vercel_api",
    used: usedSongs,
    limit: limitSongs,
    remaining: remainingSongs,
    percentRemaining,
    resetDate: getResetDateLabel(now),
    monthLabel: getMonthLabel(now),
    isExhausted: remainingSongs <= 0,
    debug: lastDebugInfo,
    vercelDetails: {
      cpuUsedHours,
      cpuLimitHours: 4.0,
      bandwidthUsedGB,
      bandwidthLimitGB: 100.0,
      invocations,
    },
  };
}

async function getRedisCount(key: string): Promise<number> {
  try {
    const res = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.result) || 0;
  } catch (err) {
    console.warn("[quota] Redis get failed, using fallback:", err);
    return 0;
  }
}

async function incrRedisCount(key: string, amount: number): Promise<number> {
  try {
    const res = await fetch(
      `${redisUrl}/incrby/${encodeURIComponent(key)}/${amount}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${redisToken}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.result) || 0;
  } catch (err) {
    console.warn("[quota] Redis incr failed:", err);
    return 0;
  }
}

async function getLocalCount(key: string): Promise<number> {
  try {
    if (existsSync(LOCAL_QUOTA_FILE)) {
      const content = await readFile(LOCAL_QUOTA_FILE, "utf-8");
      const json = JSON.parse(content);
      if (json && json[key] != null) {
        return Number(json[key]) || 0;
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

async function incrLocalCount(key: string, amount: number): Promise<number> {
  try {
    let json: Record<string, number> = {};
    if (existsSync(LOCAL_QUOTA_FILE)) {
      try {
        json = JSON.parse(await readFile(LOCAL_QUOTA_FILE, "utf-8"));
      } catch {
        json = {};
      }
    }
    const current = Number(json[key]) || 0;
    const next = current + amount;
    json[key] = next;
    await writeFile(LOCAL_QUOTA_FILE, JSON.stringify(json, null, 2), "utf-8");
    return next;
  } catch (err) {
    console.warn("[quota] File save failed:", err);
    return 0;
  }
}

export async function getQuota(): Promise<QuotaInfo> {
  const vercelToken = process.env.VERCEL_API_TOKEN?.trim();
  if (vercelToken) {
    const now = Date.now();
    if (vercelCache && now - vercelCache.at < VERCEL_CACHE_TTL_MS) {
      return vercelCache.data;
    }
    try {
      const liveData = await fetchVercelApiUsage(vercelToken);
      if (liveData) {
        vercelCache = { at: now, data: liveData };
        return liveData;
      }
    } catch (err) {
      console.warn("[quota] Failed to fetch live Vercel usage, falling back:", err);
    }
  } else {
    const cookieStatus = getCookieStatus();
    lastDebugInfo = {
      hasToken: false,
      hasCookies: cookieStatus.active,
      cookieCount: cookieStatus.count,
      hasLoginCookies: cookieStatus.hasLogin,
    };
  }

  const limit = Math.max(
    1,
    Number(process.env.MONTHLY_SONG_LIMIT) || DEFAULT_MONTHLY_LIMIT,
  );
  const now = new Date();
  const monthKey = getMonthKey(now);

  let used = 0;
  if (redisUrl && redisToken) {
    used = await getRedisCount(monthKey);
  } else {
    used = await getLocalCount(monthKey);
  }

  const remaining = Math.max(0, limit - used);
  const percentRemaining = Math.max(
    0,
    Math.min(100, Math.round((remaining / limit) * 1000) / 10),
  );

  return {
    source: "internal_estimate",
    used,
    limit,
    remaining,
    percentRemaining,
    resetDate: getResetDateLabel(now),
    monthLabel: getMonthLabel(now),
    isExhausted: remaining <= 0,
    debug: lastDebugInfo,
  };
}

export async function incrementQuota(amount = 1): Promise<QuotaInfo> {
  vercelCache = null;

  const now = new Date();
  const monthKey = getMonthKey(now);

  if (redisUrl && redisToken) {
    await incrRedisCount(monthKey, amount);
  } else {
    await incrLocalCount(monthKey, amount);
  }

  return getQuota();
}

/**
 * Calculates quota units consumed by an audio based on its duration.
 * 1 standard song unit = up to 4 minutes (240 seconds).
 * E.g.:
 * - 3 min song = 1 unit
 * - 8 min song = 2 units
 * - 50 min video = 13 units
 */
export function calculateQuotaUnits(durationSec: number): number {
  if (!durationSec || durationSec <= 0) return 1;
  return Math.max(1, Math.ceil(durationSec / 240));
}
