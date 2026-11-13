import type { ApiErrorPayload, VideoInfoResponse } from "./types";

export class ClientError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ClientError";
    this.code = code;
  }
}

export async function fetchVideoInfo(
  url: string,
  signal?: AbortSignal,
): Promise<VideoInfoResponse> {
  const response = await fetch("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });

  const payload = (await response.json().catch(() => null)) as
    | (VideoInfoResponse & ApiErrorPayload)
    | null;

  if (!response.ok) {
    throw new ClientError(
      payload?.error ?? "Gagal mengambil info video.",
      payload?.code,
    );
  }

  if (!payload) {
    throw new ClientError("Respons server tidak valid.", "BAD_RESPONSE");
  }

  return payload;
}
