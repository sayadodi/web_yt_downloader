import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApiError, friendlyYtdlpError } from "@/lib/errors";
import {
  contentDisposition,
  mimeForExtension,
  sanitizeFilename,
} from "@/lib/filename";
import { errorResponse, jsonResponse } from "@/lib/http";
import { getVideoInfo } from "@/lib/info";
import {
  FORMATS,
  isFormatId,
  isAllowed,
  resolveFormat,
} from "@/lib/quality";
import { parseYouTubeUrl } from "@/lib/youtube-url";
import { runYtdlp, YtdlpError, ytdlpBaseArgs } from "@/lib/ytdlp";
import { getQuota, incrementQuota } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MEDIA_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "mp4",
  "webm",
  "opus",
  "ogg",
  "aac",
]);

/** yt-dlp reports the final path after post-processing; fall back to a scan. */
async function resolveOutputFile(
  dir: string,
  pathFile: string,
): Promise<string> {
  const recorded = (await readFile(pathFile, "utf8").catch(() => "")).trim();

  if (recorded) {
    const found = await stat(recorded).catch(() => null);
    if (found?.isFile()) return recorded;
  }

  const entries = await readdir(dir);
  const candidates = entries.filter((entry) =>
    MEDIA_EXTENSIONS.has(path.extname(entry).slice(1).toLowerCase()),
  );

  if (candidates.length === 0) {
    throw new ApiError(
      "File audio tidak dihasilkan. Coba lagi.",
      502,
      "NO_OUTPUT",
    );
  }

  const sized = await Promise.all(
    candidates.map(async (entry) => {
      const full = path.join(dir, entry);
      const info = await stat(full).catch(() => null);
      return { full, size: info?.size ?? 0 };
    }),
  );

  sized.sort((a, b) => b.size - a.size);
  return sized[0].full;
}

function streamFile(
  filePath: string,
  dir: string,
  filename: string,
  contentType: string,
  size: number,
  format: string,
): Response {
  const nodeStream = createReadStream(filePath);
  let done = false;

  const cleanup = () => {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        if (done) return;
        controller.enqueue(new Uint8Array(chunk as Buffer));
      });
      nodeStream.on("end", () => {
        if (done) return;
        done = true;
        controller.close();
        cleanup();
      });
      nodeStream.on("error", (error) => {
        if (done) return;
        done = true;
        controller.error(error);
        cleanup();
      });
    },
    cancel() {
      done = true;
      nodeStream.destroy();
      cleanup();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      // Next streams with chunked encoding, which drops Content-Length, so the
      // size also travels in a custom header the client can rely on.
      "X-Size": String(size),
      "Content-Disposition": contentDisposition(filename),
      // Read by the browser to name the blob (headers stay same-origin).
      "X-Filename": Buffer.from(filename, "utf8").toString("base64"),
      // Lets the batch UI show when a long video was downgraded.
      "X-Format": format,
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = parseYouTubeUrl(searchParams.get("url") ?? "");
  if (!parsed) {
    return jsonResponse(
      { error: "Hanya link YouTube yang didukung.", code: "INVALID_URL" },
      400,
    );
  }

  const requested = searchParams.get("format") ?? "mp3_320";
  if (!isFormatId(requested)) {
    return jsonResponse(
      { error: "Kualitas tidak dikenal.", code: "INVALID_FORMAT" },
      400,
    );
  }

  const quota = await getQuota();
  if (quota.isExhausted) {
    return jsonResponse(
      {
        error: `Kuota bulanan server gratis (${quota.limit} lagu) telah habis. Kuota akan direset pada ${quota.resetDate}.`,
        code: "QUOTA_EXHAUSTED",
      },
      429,
    );
  }

  let dir: string | null = null;

  try {
    const info = await getVideoInfo(
      parsed.videoId,
      parsed.canonicalUrl,
      request.signal,
    );

    if (info.tooLong) {
      throw new ApiError(
        "Durasi melebihi batas 2 jam.",
        400,
        "TOO_LONG",
      );
    }

    const format = isAllowed(requested, info.duration)
      ? requested
      : resolveFormat(requested, info.duration);
    const spec = FORMATS[format];

    dir = await mkdtemp(path.join(os.tmpdir(), "ytaudio-"));
    const pathFile = path.join(dir, "filepath.txt");
    const outTemplate = path.join(dir, "%(id)s.%(ext)s");

    const args = [
      ...ytdlpBaseArgs(),
      "--newline",
      "--print-to-file",
      "after_move:filepath",
      pathFile,
      "-o",
      outTemplate,
    ];

    if (spec.kind === "copy") {
      args.push("-f", "bestaudio[ext=m4a]/bestaudio");
    } else {
      args.push(
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        `${spec.kbps}K`,
        "--embed-thumbnail",
        "--convert-thumbnails",
        "jpg",
        "--add-metadata",
      );
    }

    args.push(parsed.canonicalUrl);

    const { code, stderr } = await runYtdlp(args, {
      signal: request.signal,
      timeoutMs: 55_000,
    });

    if (code !== 0) {
      console.error("[download] yt-dlp failed:", stderr.slice(-2000));
      throw new YtdlpError(
        friendlyYtdlpError(stderr),
        "DOWNLOAD_FAILED",
        stderr,
      );
    }

    const filePath = await resolveOutputFile(dir, pathFile);
    const fileStat = await stat(filePath);

    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new ApiError(
        "File hasil kosong. Coba lagi.",
        502,
        "EMPTY_OUTPUT",
      );
    }

    const actualExt = path.extname(filePath).slice(1).toLowerCase();
    const ext = actualExt || spec.ext;
    const filename = sanitizeFilename(info.title, ext);

    const response = streamFile(
      filePath,
      dir,
      filename,
      mimeForExtension(ext),
      fileStat.size,
      format,
    );

    // Track monthly quota
    void incrementQuota(1).catch((err) =>
      console.warn("[download] incrementQuota failed:", err),
    );

    // Ownership of the temp directory moved to the response stream.
    dir = null;
    return response;
  } catch (error) {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return errorResponse(error);
  }
}
