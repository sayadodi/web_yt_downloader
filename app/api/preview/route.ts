import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { jsonResponse } from "@/lib/http";
import { parseYouTubeUrl } from "@/lib/youtube-url";
import { getYtdlpEnv, prepare, YTDLP_PATH, ytdlpBaseArgs } from "@/lib/ytdlp";
import { getQuota } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url") || (searchParams.get("id") ? `https://www.youtube.com/watch?v=${searchParams.get("id")}` : "");

  const parsed = parseYouTubeUrl(rawUrl);
  if (!parsed) {
    return jsonResponse(
      { error: "Hanya link YouTube yang didukung.", code: "INVALID_URL" },
      400,
    );
  }

  const quota = await getQuota();
  if (quota.isExhausted) {
    return jsonResponse(
      {
        error: `Kuota bulanan server telah habis. Fitur preview dinonaktifkan hingga ${quota.resetDate}.`,
        code: "QUOTA_EXHAUSTED",
      },
      429,
    );
  }

  try {
    await prepare();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Binary yt-dlp tidak siap.";
    return jsonResponse({ error: message, code: "BINARY_MISSING" }, 500);
  }

  const args = [
    ...ytdlpBaseArgs(),
    "--no-progress",
    "-f",
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
    "-o",
    "-",
    parsed.canonicalUrl,
  ];

  const child = spawn(YTDLP_PATH, args, {
    env: getYtdlpEnv(),
    windowsHide: true,
  });

  let killed = false;
  const killChild = () => {
    if (!killed) {
      killed = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  };

  request.signal.addEventListener("abort", () => {
    killChild();
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 50_000) stderr += chunk;
  });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => {
        if (killed) return;
        controller.enqueue(new Uint8Array(chunk));
      });

      child.stdout.on("end", () => {
        if (killed) return;
        killChild();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });

      child.stdout.on("error", (error) => {
        killChild();
        try {
          controller.error(error);
        } catch {
          // ignore
        }
      });

      child.on("error", (error) => {
        killChild();
        try {
          controller.error(error);
        } catch {
          // ignore
        }
      });

      child.on("close", (code) => {
        killChild();
        if (code !== 0 && stderr) {
          console.warn("[preview] yt-dlp exited with code", code, stderr.slice(-500));
        }
      });
    },
    cancel() {
      killChild();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mp4",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

