const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Keeps filenames portable across Windows, macOS, Android and iOS. */
export function sanitizeFilename(name: string, ext: string): string {
  let base = name.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  base = base.replace(/^[.\s]+/, "").slice(0, 120).trim();
  if (!base) base = "audio";
  return `${base}.${ext}`;
}

/** RFC 5987 header so Indonesian titles survive the round trip. */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");

  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "webm":
      return "audio/webm";
    case "opus":
      return "audio/opus";
    case "ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}
