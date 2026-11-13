import { ApiError } from "./errors";
import { YtdlpError } from "./ytdlp";

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }

  if (error instanceof YtdlpError) {
    if (error.code === "ABORTED") {
      return jsonResponse(
        { error: "Permintaan dibatalkan.", code: "ABORTED" },
        499,
      );
    }
    if (error.code === "TIMEOUT") {
      return jsonResponse(
        {
          error:
            "Proses melebihi batas waktu server. Coba kualitas lebih rendah atau M4A.",
          code: "TIMEOUT",
        },
        504,
      );
    }
    if (error.code === "BINARY_MISSING") {
      console.error("[api]", error.message);
      return jsonResponse(
        { error: "Server belum siap (engine tidak ditemukan).", code: "BINARY_MISSING" },
        500,
      );
    }

    return jsonResponse(
      { error: error.message, code: error.code },
      502,
    );
  }

  console.error("[api] unexpected error", error);
  return jsonResponse(
    { error: "Terjadi kesalahan di server. Coba lagi.", code: "INTERNAL" },
    500,
  );
}
