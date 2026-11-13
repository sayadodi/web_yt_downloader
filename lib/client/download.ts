import { ClientError } from "./api";
import type { ApiErrorPayload } from "./types";

export type DownloadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
  bytesPerSecond: number | null;
};

export type DownloadResult = {
  blob: Blob;
  filename: string;
  /** Format actually produced by the server (may be lower than requested). */
  format: string | null;
};

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function filenameFromHeaders(headers: Headers): string {
  const encoded = headers.get("X-Filename");
  if (encoded) {
    try {
      return decodeBase64(encoded);
    } catch {
      // fall through to the Content-Disposition parser
    }
  }

  const disposition = headers.get("Content-Disposition") ?? "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // ignore
    }
  }

  const plain = disposition.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : "audio.mp3";
}

export async function downloadAudio(options: {
  url: string;
  format: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}): Promise<DownloadResult> {
  const { url, format, signal, onProgress } = options;

  const response = await fetch(
    `/api/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}`,
    { signal },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | ApiErrorPayload
      | null;
    throw new ClientError(
      payload?.error ?? "Gagal mengunduh audio.",
      payload?.code,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ClientError(
      "Browser ini tidak mendukung unduhan streaming.",
      "NO_STREAM",
    );
  }

  const lengthHeader =
    Number(response.headers.get("Content-Length")) ||
    Number(response.headers.get("X-Size"));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
  const filename = filenameFromHeaders(response.headers);
  const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastEmit = 0;
  const startedAt = performance.now();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    chunks.push(value);
    loaded += value.byteLength;

    const now = performance.now();
    if (onProgress && (now - lastEmit > 120 || loaded === total)) {
      lastEmit = now;
      const elapsed = (now - startedAt) / 1000;
      onProgress({
        loaded,
        total,
        percent: total ? Math.min(100, (loaded / total) * 100) : null,
        bytesPerSecond: elapsed > 0.2 ? loaded / elapsed : null,
      });
    }
  }

  return {
    blob: new Blob(chunks as BlobPart[], { type: contentType }),
    filename,
    format: response.headers.get("X-Format"),
  };
}

export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
