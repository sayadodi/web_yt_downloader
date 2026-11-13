import { spawn } from "node:child_process";
import { access, chmod, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const IS_WINDOWS = process.platform === "win32";
const BIN_DIR = path.join(process.cwd(), "bin");
const COOKIES_TMP_PATH = path.join(os.tmpdir(), "ytaudio-cookies.txt");

export const YTDLP_PATH = path.join(
  BIN_DIR,
  IS_WINDOWS ? "yt-dlp.exe" : "yt-dlp",
);
export const FFMPEG_PATH =
  typeof ffmpegStatic === "string" && ffmpegStatic.length > 0
    ? ffmpegStatic
    : "";


export class YtdlpError extends Error {
  code: string;
  stderr: string;

  constructor(message: string, code: string, stderr = "") {
    super(message);
    this.name = "YtdlpError";
    this.code = code;
    this.stderr = stderr;
  }
}

let prepared: Promise<void> | null = null;
let activeCookiesPath: string | null = null;

export function resolveCookiesFile(): string | null {
  if (activeCookiesPath && existsSync(activeCookiesPath)) return activeCookiesPath;
  if (existsSync(COOKIES_TMP_PATH)) return COOKIES_TMP_PATH;

  // Support both raw plain-text cookies (YOUTUBE_COOKIES) and Base64 (YOUTUBE_COOKIES_BASE64)
  const rawCookies = process.env.YOUTUBE_COOKIES?.trim();
  const base64Cookies = process.env.YOUTUBE_COOKIES_BASE64?.trim();

  let cookiesText = "";
  if (rawCookies) {
    cookiesText = rawCookies;
  } else if (base64Cookies) {
    try {
      cookiesText = Buffer.from(base64Cookies, "base64").toString("utf-8");
    } catch (err) {
      console.error("[ytdlp] Gagal mendekode YOUTUBE_COOKIES_BASE64:", err);
    }
  }

  if (cookiesText) {
    try {
      writeFileSync(COOKIES_TMP_PATH, cookiesText, "utf-8");
      activeCookiesPath = COOKIES_TMP_PATH;
      return COOKIES_TMP_PATH;
    } catch (err) {
      console.error("[ytdlp] Gagal menulis cookies ke COOKIES_TMP_PATH:", err);
    }
  }

  const customCookieFile = process.env.YTDLP_COOKIES_FILE?.trim();
  if (customCookieFile && existsSync(path.resolve(customCookieFile))) {
    activeCookiesPath = path.resolve(customCookieFile);
    return activeCookiesPath;
  }

  const localCookies = path.join(process.cwd(), "cookies.txt");
  if (existsSync(localCookies)) {
    activeCookiesPath = localCookies;
    return localCookies;
  }

  return null;
}

export function prepare(): Promise<void> {
  if (!prepared) {
    prepared = (async () => {
      try {
        await access(YTDLP_PATH);
      } catch {
        throw new YtdlpError(
          "Binary yt-dlp tidak ditemukan. Jalankan `npm run fetch:bin`.",
          "BINARY_MISSING",
        );
      }

      // Check and resolve cookies
      resolveCookiesFile();

      if (IS_WINDOWS) return;
      // Lambda zip archives occasionally lose the executable bit.
      await chmod(YTDLP_PATH, 0o755).catch(() => {});
      if (FFMPEG_PATH) await chmod(FFMPEG_PATH, 0o755).catch(() => {});
    })();
  }
  return prepared;
}

/** Shared flags. `--no-playlist` guarantees a single audio file per request. */
export function ytdlpBaseArgs(): string[] {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-cache-dir",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
  ];

  const cookiePath = resolveCookiesFile();
  if (cookiePath) {
    args.push("--cookies", cookiePath);
  }

  const customClients = process.env.YTDLP_PLAYER_CLIENTS?.trim();
  if (customClients) {
    args.push("--extractor-args", `youtube:player_client=${customClients}`);
  } else if (!cookiePath) {
    // When no cookies, fallback to standard web clients
    args.push("--extractor-args", "youtube:player_client=default,web_safari");
  }

  if (FFMPEG_PATH) args.push("--ffmpeg-location", FFMPEG_PATH);

  return args;
}

export type RunOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export async function runYtdlp(
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  await prepare();

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args, {
      env: {
        ...process.env,
        // Keep yt-dlp from writing outside the ephemeral filesystem.
        HOME: os.tmpdir(),
        XDG_CACHE_HOME: path.join(os.tmpdir(), "yt-dlp-cache"),
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      action();
    };

    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() =>
        reject(new YtdlpError("Permintaan dibatalkan.", "ABORTED", stderr)),
      );
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new YtdlpError(
              "Proses melebihi batas waktu server.",
              "TIMEOUT",
              stderr,
            ),
          ),
        );
      }, options.timeoutMs);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 4_000_000) stdout += chunk;

      if (options.onStdoutLine) {
        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) options.onStdoutLine(line);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 200_000) stderr += chunk;
    });

    child.on("error", (error) => {
      finish(() =>
        reject(
          new YtdlpError(
            `Tidak bisa menjalankan yt-dlp: ${error.message}`,
            "SPAWN_FAILED",
          ),
        ),
      );
    });

    child.on("close", (code) => {
      finish(() => resolve({ stdout, stderr, code: code ?? -1 }));
    });
  });
}

export type RawVideoInfo = {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  abr?: number;
  is_live?: boolean;
  live_status?: string;
};

export async function fetchRawInfo(
  url: string,
  signal?: AbortSignal,
): Promise<RawVideoInfo> {
  const { stdout, stderr, code } = await runYtdlp(
    ["-J", "--skip-download", ...ytdlpBaseArgs(), url],
    { signal, timeoutMs: 45_000 },
  );

  if (code !== 0) {
    throw new YtdlpError("Gagal mengambil metadata video.", "INFO_FAILED", stderr);
  }

  try {
    return JSON.parse(stdout) as RawVideoInfo;
  } catch {
    throw new YtdlpError(
      "Gagal membaca metadata video.",
      "INFO_PARSE_FAILED",
      stderr,
    );
  }
}
