import { errorResponse, jsonResponse } from "@/lib/http";
import { getVideoInfo } from "@/lib/info";
import { parseYouTubeUrl } from "@/lib/youtube-url";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: { url?: unknown };

  try {
    payload = (await request.json()) as { url?: unknown };
  } catch {
    return jsonResponse(
      { error: "Body harus berupa JSON.", code: "BAD_JSON" },
      400,
    );
  }

  const parsed = parseYouTubeUrl(
    typeof payload.url === "string" ? payload.url : "",
  );

  if (!parsed) {
    return jsonResponse(
      { error: "Hanya link YouTube yang didukung.", code: "INVALID_URL" },
      400,
    );
  }

  try {
    const info = await getVideoInfo(
      parsed.videoId,
      parsed.canonicalUrl,
      request.signal,
    );
    return jsonResponse(info);
  } catch (error) {
    return errorResponse(error);
  }
}
