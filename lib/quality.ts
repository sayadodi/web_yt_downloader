export const MAX_DURATION_SEC = 2 * 60 * 60;

export type FormatId = "m4a" | "mp3_320" | "mp3_192" | "mp3_128" | "mp3_96";

export type FormatSpec = {
  id: FormatId;
  label: string;
  /** Short label used in compact controls. */
  short: string;
  kind: "copy" | "transcode";
  /** Target bitrate for transcodes; 0 for the untouched source stream. */
  kbps: number;
  ext: "m4a" | "mp3";
  mime: string;
};

export const FORMATS: Record<FormatId, FormatSpec> = {
  m4a: {
    id: "m4a",
    label: "M4A Original",
    short: "Asli",
    kind: "copy",
    kbps: 0,
    ext: "m4a",
    mime: "audio/mp4",
  },
  mp3_320: {
    id: "mp3_320",
    label: "MP3 320 kbps",
    short: "320",
    kind: "transcode",
    kbps: 320,
    ext: "mp3",
    mime: "audio/mpeg",
  },
  mp3_192: {
    id: "mp3_192",
    label: "MP3 192 kbps",
    short: "192",
    kind: "transcode",
    kbps: 192,
    ext: "mp3",
    mime: "audio/mpeg",
  },
  mp3_128: {
    id: "mp3_128",
    label: "MP3 128 kbps",
    short: "128",
    kind: "transcode",
    kbps: 128,
    ext: "mp3",
    mime: "audio/mpeg",
  },
  mp3_96: {
    id: "mp3_96",
    label: "MP3 96 kbps",
    short: "96",
    kind: "transcode",
    kbps: 96,
    ext: "mp3",
    mime: "audio/mpeg",
  },
};

export const FORMAT_ORDER: FormatId[] = [
  "m4a",
  "mp3_320",
  "mp3_192",
  "mp3_128",
  "mp3_96",
];

export function isFormatId(value: string): value is FormatId {
  return Object.prototype.hasOwnProperty.call(FORMATS, value);
}

/**
 * Which qualities we are willing to run for a given duration.
 *
 * MP3 needs a full decode + encode with ffmpeg. On Vercel Hobby's 60s function limit,
 * a 50-minute file re-encoding at high bitrate will time out.
 * M4A (direct stream copy without transcode) finishes in seconds for any duration up to 2 hours!
 */
export function allowedFormats(durationSec: number): FormatId[] {
  if (durationSec <= 15 * 60) {
    return ["m4a", "mp3_320", "mp3_192", "mp3_128", "mp3_96"];
  }
  if (durationSec <= 30 * 60) {
    return ["m4a", "mp3_192", "mp3_128", "mp3_96"];
  }
  if (durationSec <= 60 * 60) {
    return ["m4a", "mp3_96"];
  }
  return ["m4a"];
}

export function isAllowed(format: FormatId, durationSec: number): boolean {
  return allowedFormats(durationSec).includes(format);
}

/** Falls back to the closest lower bitrate that is allowed for this duration. */
export function resolveFormat(requested: FormatId, durationSec: number): FormatId {
  const allowed = allowedFormats(durationSec);
  if (allowed.includes(requested)) return requested;
  if (requested === "m4a") return "m4a";

  const requestedKbps = FORMATS[requested].kbps;
  const transcodes = allowed.filter((id) => FORMATS[id].kind === "transcode");

  const lower = transcodes
    .filter((id) => FORMATS[id].kbps <= requestedKbps)
    .sort((a, b) => FORMATS[b].kbps - FORMATS[a].kbps)[0];

  return lower ?? transcodes[0] ?? "m4a";
}

export function disabledReason(format: FormatId, durationSec: number): string {
  if (durationSec > MAX_DURATION_SEC) return "Durasi melebihi batas 2 jam.";
  if (format === "m4a") return "Tidak tersedia untuk video ini.";
  if (durationSec > 30 * 60) {
    return "Untuk video panjang (>30m), disarankan M4A Original agar selesai cepat tanpa batas waktu Vercel (60s).";
  }
  return "Durasi terlalu panjang untuk bitrate ini agar proses selesai tepat waktu.";
}

export function estimateSizeMB(kbps: number, durationSec: number): number {
  return (kbps * durationSec) / 8 / 1024;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
