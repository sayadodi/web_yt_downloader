import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  lastDebugInfo = {
    hasToken: true,
    tokenLength: token.length,
  };

  // 1. Verify user & resolve team
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

  // 2. Query usage with multiple URL shapes
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = now.toISOString();

  const urlCandidates: string[] = [];
  if (teamId) {
    urlCandidates.push(
      `https://api.vercel.com/v2/usage?teamId=${encodeURIComponent(teamId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    urlCandidates.push(
      `https://api.vercel.com/v2/usage?teamId=${encodeURIComponent(teamId)}`,
    );
  }
  urlCandidates.push(
    `https://api.vercel.com/v2/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  urlCandidates.push(`https://api.vercel.com/v2/usage`);

  let res: Response | null = null;
  let responseText = "";

  for (const candidate of urlCandidates) {
    try {
      const candidateRes = await fetch(candidate, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      lastDebugInfo.usageStatus = candidateRes.status;
      if (candidateRes.ok) {
        res = candidateRes;
        break;
      } else {
        responseText = await candidateRes.text().catch(() => "");
      }
    } catch (err) {
      lastDebugInfo.usageError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!res) {
    lastDebugInfo.usageError = `Usage endpoint returned status ${lastDebugInfo.usageStatus}: ${responseText.slice(0, 250)}`;
    console.warn("[quota]", lastDebugInfo.usageError);
    return null;
  }

  const json = (await res.json()) as {
    period?: { start?: number; end?: number };
    bandwidth?: { value?: number; units?: string; usage?: number };
    serverlessFunctionExecution?: {
      value?: number;
      units?: string;
      usage?: number;
      limit?: number;
      metrics?: {
        invocations?: number;
        computeTimeMs?: number;
        executionDurationAverageMs?: number;
      };
    };
  };

  const execution = json.serverlessFunctionExecution || {};
  const metrics = execution.metrics || {};
  const bandwidth = json.bandwidth || {};

  const usagePercent =
    typeof execution.usage === "number" ? execution.usage : 0;
  const percentRemaining = Math.max(
    0,
    Math.min(100, Math.round((100 - usagePercent) * 10) / 10),
  );

  const computeTimeMs = Number(metrics.computeTimeMs) || 0;
  const cpuUsedHours = Math.round((computeTimeMs / (1000 * 3600)) * 100) / 100;
  const cpuLimitHours = 4.0;

  const limitSongs = Number(process.env.MONTHLY_SONG_LIMIT) || DEFAULT_MONTHLY_LIMIT;
  const usedSongs = Math.min(
    limitSongs,
    Math.round((usagePercent / 100) * limitSongs),
  );
  const remainingSongs = Math.max(0, limitSongs - usedSongs);

  const bandwidthBytes = Number(bandwidth.value) || 0;
  const bandwidthUsedGB =
    Math.round((bandwidthBytes / (1024 * 1024 * 1024)) * 100) / 100;
  const bandwidthLimitGB = 100.0;

  let resetDate = "";
  let monthLabel = "";
  if (json.period?.end) {
    const endDate = new Date(json.period.end);
    resetDate = `${endDate.getDate()} ${MONTH_NAMES[endDate.getMonth()]} ${endDate.getFullYear()}`;
    monthLabel = `${MONTH_NAMES[endDate.getMonth()]} ${endDate.getFullYear()}`;
  } else {
    resetDate = getResetDateLabel(now);
    monthLabel = getMonthLabel(now);
  }

  return {
    source: "vercel_api",
    used: usedSongs,
    limit: limitSongs,
    remaining: remainingSongs,
    percentRemaining,
    resetDate,
    monthLabel,
    isExhausted: remainingSongs <= 0 || usagePercent >= 100,
    debug: lastDebugInfo,
    vercelDetails: {
      cpuUsedHours,
      cpuLimitHours,
      bandwidthUsedGB,
      bandwidthLimitGB,
      invocations: Number(metrics.invocations) || 0,
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
    lastDebugInfo = { hasToken: false };
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
