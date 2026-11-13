import { ApiError, friendlyYtdlpError } from "./errors";
import {
  allowedFormats,
  disabledReason,
  estimateSizeMB,
  FORMATS,
  FORMAT_ORDER,
  formatDuration,
  MAX_DURATION_SEC,
  type FormatId,
} from "./quality";
import { fetchRawInfo, YtdlpError } from "./ytdlp";

export type QualityOption = {
  id: FormatId;
  label: string;
  kbps: number;
  sizeMB: number;
  available: boolean;
  reason: string | null;
};

export type VideoInfoResponse = {
  id: string;
  title: string;
  uploader: string;
  duration: number;
  durationLabel: string;
  thumbnail: string;
  sourceBitrate: number | null;
  tooLong: boolean;
  maxDuration: number;
  qualities: QualityOption[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 100;

const cache = new Map<string, { at: number; value: VideoInfoResponse }>();

function remember(key: string, value: VideoInfoResponse) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * Fetches metadata and derives the quality ladder. Cached in-process because
 * `/api/download` needs the same duration a moment later.
 */
export async function getVideoInfo(
  videoId: string,
  canonicalUrl: string,
  signal?: AbortSignal,
): Promise<VideoInfoResponse> {
  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  let raw;
  try {
    raw = await fetchRawInfo(canonicalUrl, signal);
  } catch (error) {
    if (error instanceof YtdlpError) {
      if (error.code === "ABORTED") {
        throw new ApiError("Permintaan dibatalkan.", 499, "ABORTED");
      }
      if (error.code === "TIMEOUT") {
        throw new ApiError(
          "Pengambilan info terlalu lama. Coba lagi.",
          504,
          "INFO_TIMEOUT",
        );
      }
      if (error.code === "BINARY_MISSING") throw error;

      console.error("[info] yt-dlp failed", error.stderr.slice(-2000));
      throw new ApiError(
        friendlyYtdlpError(error.stderr),
        502,
        "INFO_FAILED",
      );
    }
    throw error;
  }

  if (raw.is_live || raw.live_status === "is_live" || raw.live_status === "is_upcoming") {
    throw new ApiError(
      "Live stream dan premiere tidak didukung.",
      422,
      "LIVE_UNSUPPORTED",
    );
  }

  const duration = Math.round(Number(raw.duration) || 0);
  if (duration <= 0) {
    throw new ApiError(
      "Durasi video tidak dapat dibaca.",
      422,
      "DURATION_UNKNOWN",
    );
  }

  const tooLong = duration > MAX_DURATION_SEC;
  const allowed = new Set(allowedFormats(duration));
  const sourceBitrate =
    typeof raw.abr === "number" && raw.abr > 0 ? Math.round(raw.abr) : null;

  const qualities: QualityOption[] = FORMAT_ORDER.map((id) => {
    const spec = FORMATS[id];
    const kbps = spec.kind === "copy" ? (sourceBitrate ?? 128) : spec.kbps;
    const available = !tooLong && allowed.has(id);

    return {
      id,
      label: spec.label,
      kbps,
      sizeMB: Math.round(estimateSizeMB(kbps, duration) * 10) / 10,
      available,
      reason: available
        ? null
        : tooLong
          ? `Durasi melebihi batas ${MAX_DURATION_SEC / 3600} jam.`
          : disabledReason(id, duration),
    };
  });

  const value: VideoInfoResponse = {
    id: raw.id ?? videoId,
    title: raw.title?.trim() || "Tanpa judul",
    uploader: (raw.uploader ?? raw.channel ?? "").trim(),
    duration,
    durationLabel: formatDuration(duration),
    thumbnail: raw.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    sourceBitrate,
    tooLong,
    maxDuration: MAX_DURATION_SEC,
    qualities,
  };

  remember(videoId, value);
  return value;
}
