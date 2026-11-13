/** Error type that maps cleanly to an HTTP response. */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * yt-dlp failures are noisy. Translate the most common ones into something a
 * visitor can act on, and keep the raw text in the server log.
 */
export function friendlyYtdlpError(stderr: string): string {
  const text = stderr.toLowerCase();

  if (text.includes("sign in to confirm") || text.includes("not a bot")) {
    return "YouTube menolak permintaan ini (Bot Detection). Pastikan cookies YouTube sudah terhubung di Vercel.";
  }
  if (text.includes("private video")) {
    return "Video ini bersifat privat.";
  }
  if (text.includes("members-only") || text.includes("join this channel")) {
    return "Video ini khusus member channel.";
  }
  if (text.includes("age") && (text.includes("confirm") || text.includes("restricted"))) {
    return "Video ini dibatasi usia dan tidak bisa diproses.";
  }
  if (text.includes("not available in your country") || text.includes("geo")) {
    return "Video ini dibatasi di wilayah server.";
  }
  if (text.includes("live event") || text.includes("is live") || text.includes("premieres")) {
    return "Live stream dan premiere tidak didukung.";
  }
  if (
    text.includes("video unavailable") ||
    text.includes("this video is unavailable") ||
    text.includes("video ini tidak tersedia") ||
    text.includes("removed") ||
    text.includes("has been terminated") ||
    text.includes("no longer available")
  ) {
    return "Video ini tidak tersedia atau sudah dihapus di YouTube. Silakan gunakan link video YouTube yang lain.";
  }
  if (text.includes("unsupported url")) {
    return "Hanya link YouTube yang didukung.";
  }
  if (text.includes("requested format is not available")) {
    return "Format audio yang diminta tidak tersedia untuk video ini. Silakan coba link video YouTube yang lain.";
  }

  return "Gagal memproses video. Coba lagi.";
}
