const BASE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type ParsedYouTubeUrl = {
  videoId: string;
  canonicalUrl: string;
};

/**
 * Accepts any common YouTube URL shape and returns a canonical watch URL.
 * Only whitelisted hosts are allowed so the value can never point somewhere
 * else when handed to yt-dlp (SSRF guard).
 */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!BASE_HOSTS.has(host)) return null;

  // Playlists expand into many downloads; we only handle single videos.
  if (url.pathname.startsWith("/playlist")) return null;

  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else {
    const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    if (match) videoId = match[1];
  }

  if (!videoId || !VIDEO_ID.test(videoId)) return null;

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
