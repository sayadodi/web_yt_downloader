/**
 * Downloads the yt-dlp standalone binary for the current platform into ./bin.
 *
 * Runs on `postinstall`, so it executes both locally (Windows/macOS) and on
 * Vercel's Linux build machines. yt-dlp's standalone builds embed their own
 * Python runtime, so no Python is required at runtime.
 */
import { chmod, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const BIN_DIR = path.join(process.cwd(), "bin");
const FORCE = process.env.FORCE_FETCH === "1";

function target() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32") {
    return { fileName: "yt-dlp.exe", asset: "yt-dlp.exe" };
  }
  if (platform === "darwin") {
    return { fileName: "yt-dlp", asset: "yt-dlp_macos" };
  }
  if (platform === "linux") {
    return {
      fileName: "yt-dlp",
      asset: arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux",
    };
  }
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function exists(file) {
  try {
    const info = await stat(file);
    return info.size > 1_000_000;
  } catch {
    return false;
  }
}

async function main() {
  const { fileName, asset } = target();
  const dest = path.join(BIN_DIR, fileName);

  await mkdir(BIN_DIR, { recursive: true });

  if (!FORCE && (await exists(dest))) {
    console.log(`[bin] yt-dlp already present (${asset}), skipping download`);
    return;
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  const tmp = `${dest}.tmp`;

  console.log(`[bin] downloading ${asset} ...`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

    const info = await stat(tmp);
    if (info.size < 1_000_000) {
      throw new Error(`Downloaded file looks invalid (${info.size} bytes)`);
    }

    await unlink(dest).catch(() => {});
    await rename(tmp, dest);
    if (process.platform !== "win32") {
      await chmod(dest, 0o755);
    }
    await writeFile(
      path.join(BIN_DIR, "VERSION"),
      `${asset} fetched ${new Date().toISOString()}\n`,
      "utf8",
    );

    console.log(`[bin] ready: ${dest} (${(info.size / 1e6).toFixed(1)} MB)`);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

main().catch((error) => {
  console.error("[bin] failed:", error.message);
  // Do not fail the whole install: `next build` can still run, and the
  // failure is reported clearly at request time.
  process.exitCode = 0;
});
