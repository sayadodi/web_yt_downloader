import { jsonResponse } from "@/lib/http";
import { getQuota } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quota = await getQuota();
    return jsonResponse(quota);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal membaca kuota.";
    return jsonResponse({ error: message, code: "QUOTA_ERROR" }, 500);
  }
}

