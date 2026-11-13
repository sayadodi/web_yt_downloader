"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zip } from "fflate";
import {
  AlertCircle,
  Check,
  Download,
  FileArchive,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { ClientError, fetchVideoInfo } from "@/lib/client/api";
import {
  downloadAudio,
  saveBlob,
  type DownloadProgress,
} from "@/lib/client/download";
import { formatBytes, formatPercent } from "@/lib/client/format";
import type { VideoInfoResponse } from "@/lib/client/types";
import { FORMATS, type FormatId } from "@/lib/quality";
import { parseYouTubeUrl } from "@/lib/youtube-url";
import ProgressBar from "./ProgressBar";
import QualityPicker from "./QualityPicker";
import SongCard from "./SongCard";

const MAX_LINKS = 20;
const CONCURRENCY = 3;
const GAP_MS = 400;
const ZIP_LIMIT_BYTES = 300 * 1024 * 1024;

type CardStatus =
  | "empty"
  | "loading"
  | "ready"
  | "downloading"
  | "done"
  | "error";

type LinkRef = { videoId: string; url: string };

type Card = {
  id: string;
  url: string;
  info: VideoInfoResponse | null;
  status: CardStatus;
  format: FormatId;
  progress: DownloadProgress | null;
  error: string | null;
  blob: Blob | null;
  filename: string | null;
  resolvedFormat: FormatId | null;
  savedDirectly?: boolean;
};

type ZipState =
  | { status: "idle" }
  | { status: "building" }
  | {
      status: "ready";
      blob: Blob;
      name: string;
      files: number;
      bytes: number;
      autoSaved: boolean;
    }
  | { status: "error"; message: string };

type Entry = { name: string; blob: Blob };

let cardSeq = 0;

function makeCard(url = ""): Card {
  cardSeq += 1;
  return {
    id: `card-${Date.now()}-${cardSeq}`,
    url,
    info: null,
    status: "empty",
    format: "mp3_320",
    progress: null,
    error: null,
    blob: null,
    filename: null,
    resolvedFormat: null,
  };
}

function extractLinks(text: string): LinkRef[] {
  const seen = new Set<string>();
  const out: LinkRef[] = [];

  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    const parsed = parseYouTubeUrl(token);
    if (!parsed) continue;
    if (seen.has(parsed.videoId)) continue;
    seen.add(parsed.videoId);
    out.push({ videoId: parsed.videoId, url: parsed.canonicalUrl });
  }

  return out;
}

function defaultFormat(info: VideoInfoResponse): FormatId {
  const preferred = info.qualities.find((q) => q.id === "mp3_320" && q.available);
  const fallback = info.qualities.find((q) => q.available);
  return (preferred?.id ?? fallback?.id ?? "m4a") as FormatId;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  const queue = [...items];

  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        await worker(next);
        if (queue.length > 0) await delay(GAP_MS);
      }
    }),
  );
}

function uniqueName(files: Record<string, Uint8Array>, name: string): string {
  if (!files[name]) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let counter = 2;
  while (files[`${base} (${counter})${ext}`]) counter += 1;
  return `${base} (${counter})${ext}`;
}

function cardStatusLabel(card: Card): string {
  switch (card.status) {
    case "loading":
      return "Mengambil info…";
    case "ready":
      return "Siap";
    case "downloading":
      return card.progress?.percent != null
        ? `Mengunduh ${formatPercent(card.progress.percent)}`
        : "Mengunduh…";
    case "done":
      return "Selesai";
    case "error":
      return "Gagal";
    default:
      return "Belum ada info";
  }
}

function todayStamp(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function BatchMode() {
  const [cards, setCards] = useState<Card[]>(() => [makeCard()]);
  const [running, setRunning] = useState(false);
  const [zipState, setZipState] = useState<ZipState>({ status: "idle" });
  const [outputMode, setOutputMode] = useState<"direct" | "zip">("direct");
  const [directDone, setDirectDone] = useState<number | null>(null);

  const controllers = useRef(new Map<string, AbortController>());
  const canceled = useRef(false);

  useEffect(
    () => () => {
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
    },
    [],
  );

  const patch = useCallback((id: string, updates: Partial<Card>) => {
    setCards((prev) =>
      prev.map((card) => (card.id === id ? { ...card, ...updates } : card)),
    );
  }, []);

  const loadInfo = useCallback(
    async (id: string, rawUrl: string) => {
      const value = rawUrl.trim();
      if (!value) return;

      const parsed = parseYouTubeUrl(value);
      if (!parsed) {
        patch(id, {
          status: "empty",
          info: null,
          error: "Link YouTube tidak valid.",
        });
        return;
      }

      controllers.current.get(id)?.abort();
      const controller = new AbortController();
      controllers.current.set(id, controller);
      patch(id, {
        status: "loading",
        info: null,
        error: null,
        blob: null,
        filename: null,
        progress: null,
        resolvedFormat: null,
      });

      try {
        const info = await fetchVideoInfo(parsed.canonicalUrl, controller.signal);
        if (controller.signal.aborted) return;
        patch(id, {
          status: "ready",
          info,
          url: parsed.canonicalUrl,
          format: defaultFormat(info),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(id, {
          status: "empty",
          info: null,
          error:
            error instanceof ClientError
              ? error.message
              : "Gagal mengambil info video.",
        });
      } finally {
        if (controllers.current.get(id) === controller) {
          controllers.current.delete(id);
        }
      }
    },
    [patch],
  );

  const startDownload = useCallback(
    async (card: Card, directSave = false): Promise<Entry | null> => {
      if (!card.info) return null;

      controllers.current.get(card.id)?.abort();
      const controller = new AbortController();
      controllers.current.set(card.id, controller);

      patch(card.id, {
        status: "downloading",
        error: null,
        progress: {
          loaded: 0,
          total: null,
          percent: null,
          bytesPerSecond: null,
        },
        blob: null,
        filename: null,
        resolvedFormat: null,
        savedDirectly: false,
      });

      try {
        const result = await downloadAudio({
          url: `https://www.youtube.com/watch?v=${card.info.id}`,
          format: card.format,
          signal: controller.signal,
          onProgress: (progress) => patch(card.id, { progress }),
        });

        if (directSave) {
          saveBlob(result.blob, result.filename);
        }

        patch(card.id, {
          status: "done",
          blob: directSave ? null : result.blob,
          filename: result.filename,
          resolvedFormat: result.format as FormatId | null,
          savedDirectly: directSave,
          progress: {
            loaded: result.blob.size,
            total: result.blob.size,
            percent: 100,
            bytesPerSecond: null,
          },
        });

        window.dispatchEvent(new Event("ytaudio-quota-updated"));

        return { name: result.filename, blob: result.blob };
      } catch (error) {
        if (controller.signal.aborted) {
          patch(card.id, { status: "ready", progress: null });
          return null;
        }
        patch(card.id, {
          status: "error",
          error:
            error instanceof ClientError
              ? error.message
              : "Gagal mengunduh audio.",
          progress: null,
        });
        return null;
      } finally {
        if (controllers.current.get(card.id) === controller) {
          controllers.current.delete(card.id);
        }
      }
    },
    [patch],
  );

  const buildZip = useCallback(async (entries: Entry[], autoSave: boolean) => {
    if (entries.length === 0) {
      setZipState({ status: "idle" });
      return;
    }

    setZipState({ status: "building" });

    try {
      const files: Record<string, Uint8Array> = {};
      for (const entry of entries) {
        const buffer = new Uint8Array(await entry.blob.arrayBuffer());
        files[uniqueName(files, entry.name)] = buffer;
      }

      const archive = await new Promise<Uint8Array>((resolve, reject) => {
        zip(files, { level: 0 }, (error, data) => {
          if (error) reject(error);
          else resolve(data);
        });
      });

      const blob = new Blob([archive as unknown as BlobPart], {
        type: "application/zip",
      });
      const name = `yt-audio-${todayStamp()}.zip`;

      if (autoSave) saveBlob(blob, name);

      setZipState({
        status: "ready",
        blob,
        name,
        files: entries.length,
        bytes: blob.size,
        autoSaved: autoSave,
      });
    } catch {
      setZipState({
        status: "error",
        message: "Gagal membuat ZIP. Tekan Unduh semua untuk mencoba lagi.",
      });
    }
  }, []);

  const downloadAll = async () => {
    if (running) return;

    const targets = cards.filter(
      (card) =>
        card.info &&
        !card.info.tooLong &&
        (card.status === "ready" || card.status === "error"),
    );
    if (targets.length === 0) return;

    canceled.current = false;
    setZipState({ status: "idle" });
    setDirectDone(null);
    setRunning(true);

    const isDirect = outputMode === "direct";
    const collected = new Map<string, Entry>();
    const poolLimit = isDirect ? 1 : CONCURRENCY;

    await pool(targets, poolLimit, async (card) => {
      if (canceled.current) return;
      const entry = await startDownload(card, isDirect);
      if (entry) collected.set(card.id, entry);
    });

    setRunning(false);

    if (canceled.current) {
      canceled.current = false;
      return;
    }

    if (isDirect) {
      setDirectDone(collected.size);
      return;
    }

    // Previously finished cards keep their blob; this run's results are added
    // from `collected` because the state snapshot above is stale.
    const entries: Entry[] = [
      ...cards
        .filter((card) => card.status === "done" && card.blob && card.filename)
        .map((card) => ({ name: card.filename as string, blob: card.blob as Blob })),
      ...collected.values(),
    ];

    const seen = new Set<string>();
    const unique = entries.filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });

    const totalBytes = unique.reduce((sum, entry) => sum + entry.blob.size, 0);
    if (unique.length === 0 || totalBytes > ZIP_LIMIT_BYTES) {
      setZipState({ status: "idle" });
      return;
    }

    await buildZip(unique, true);
  };

  const cancelAll = () => {
    canceled.current = true;
    controllers.current.forEach((controller) => controller.abort());
    setRunning(false);
  };

  const addLinks = useCallback(
    (links: LinkRef[], sourceId?: string): Card[] => {
      const existing = new Set<string>();
      for (const card of cards) {
        const id = card.info?.id ?? parseYouTubeUrl(card.url)?.videoId;
        if (id) existing.add(id);
      }

      const accepted = links
        .filter((link) => !existing.has(link.videoId))
        .filter(
          (link, index, all) =>
            all.findIndex((item) => item.videoId === link.videoId) === index,
        )
        .slice(0, Math.max(0, MAX_LINKS - cards.length));

      if (accepted.length === 0) return [];

      const targets: Card[] = [];
      const created: Card[] = [];

      let start = 0;
      const source = sourceId
        ? cards.find((card) => card.id === sourceId)
        : undefined;

      // An untouched card is reused for the first pasted link.
      if (source && !source.url.trim() && !source.info) {
        patch(source.id, {
          url: accepted[0].url,
          error: null,
          status: "empty",
        });
        targets.push({ ...source, url: accepted[0].url });
        start = 1;
      }

      for (let index = start; index < accepted.length; index += 1) {
        const card = makeCard(accepted[index].url);
        created.push(card);
        targets.push(card);
      }

      if (created.length > 0) {
        setCards((prev) => [...prev, ...created]);
      }

      return targets;
    },
    [cards, patch],
  );

  const handlePaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    cardId: string,
  ) => {
    const links = extractLinks(event.clipboardData.getData("text"));
    if (links.length === 0) return;

    event.preventDefault();

    if (links.length === 1) {
      patch(cardId, {
        url: links[0].url,
        info: null,
        status: "empty",
        error: null,
        blob: null,
        filename: null,
        progress: null,
      });
      void loadInfo(cardId, links[0].url);
      return;
    }

    const targets = addLinks(links, cardId);
    void pool(targets, CONCURRENCY, (card) => loadInfo(card.id, card.url));
  };

  const updateUrl = (cardId: string, value: string) => {
    controllers.current.get(cardId)?.abort();
    controllers.current.delete(cardId);
    setZipState({ status: "idle" });
    setDirectDone(null);
    patch(cardId, {
      url: value,
      info: null,
      status: "empty",
      error: null,
      progress: null,
      blob: null,
      filename: null,
      resolvedFormat: null,
      savedDirectly: false,
    });
  };

  const addCard = () => {
    setCards((prev) =>
      prev.length >= MAX_LINKS ? prev : [...prev, makeCard()],
    );
  };

  const removeCard = (cardId: string) => {
    controllers.current.get(cardId)?.abort();
    controllers.current.delete(cardId);
    setZipState({ status: "idle" });
    setDirectDone(null);
    setCards((prev) => {
      const next = prev.filter((card) => card.id !== cardId);
      return next.length > 0 ? next : [makeCard()];
    });
  };

  const clearAll = () => {
    canceled.current = true;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setRunning(false);
    setZipState({ status: "idle" });
    setDirectDone(null);
    setCards([makeCard()]);
  };

  const queue = useMemo(
    () => cards.filter((card) => card.info && !card.info.tooLong),
    [cards],
  );

  const doneCards = useMemo(
    () => cards.filter((card) => card.status === "done" && card.blob),
    [cards],
  );

  const failedCards = useMemo(
    () => cards.filter((card) => card.status === "error"),
    [cards],
  );

  const pending = queue.filter((card) => card.status !== "done").length;
  const loadingAny = cards.some((card) => card.status === "loading");

  const overall = useMemo(() => {
    if (queue.length === 0) return 0;
    const sum = queue.reduce((total, card) => {
      if (card.status === "done") return total + 100;
      if (card.status === "downloading") return total + (card.progress?.percent ?? 0);
      return total;
    }, 0);
    return sum / queue.length;
  }, [queue]);

  const doneBytes = doneCards.reduce(
    (sum, card) => sum + (card.blob?.size ?? 0),
    0,
  );
  const zipTooBig = doneBytes > ZIP_LIMIT_BYTES;
  const showProgress = running || doneCards.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addCard}
          disabled={cards.length >= MAX_LINKS || running}
          className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={15} aria-hidden="true" />
          Tambah link
        </button>

        <span className="tnum text-xs text-faint">
          {cards.length}/{MAX_LINKS} form
        </span>

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={cancelAll}
              className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
            >
              <X size={15} aria-hidden="true" />
              Batal
            </button>
          ) : (
            <button
              type="button"
              onClick={downloadAll}
              disabled={pending === 0 || loadingAny}
              className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} aria-hidden="true" />
              Unduh semua{pending > 0 ? ` (${pending})` : ""}
            </button>
          )}

          <button
            type="button"
            onClick={clearAll}
            aria-label="Hapus semua form"
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-control border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface/50 p-2 text-xs">
        <span className="font-medium text-muted">Mode simpan unduhan batch:</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setOutputMode("direct");
              setDirectDone(null);
            }}
            disabled={running}
            className={[
              "flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 font-medium transition-colors",
              outputMode === "direct"
                ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]"
                : "text-faint hover:text-fg",
            ].join(" ")}
          >
            <Save size={13} aria-hidden="true" />
            Satu per satu (Hemat RAM / HP)
          </button>
          <button
            type="button"
            onClick={() => {
              setOutputMode("zip");
              setDirectDone(null);
            }}
            disabled={running}
            className={[
              "flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 font-medium transition-colors",
              outputMode === "zip"
                ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]"
                : "text-faint hover:text-fg",
            ].join(" ")}
          >
            <FileArchive size={13} aria-hidden="true" />
            Bundel ZIP
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        {outputMode === "direct"
          ? "Setiap lagu diunduh secara berurutan dan langsung disimpan ke browser Anda (tanpa membebani memori HP)."
          : "Semua lagu diproses lalu disatukan ke dalam satu file ZIP (maksimal 300 MB, cocok untuk laptop/PC)."}
      </p>

      {directDone !== null && directDone > 0 ? (
        <div className="flex items-start gap-2.5 rounded-card border border-accent/30 bg-accent/10 p-4">
          <Check size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent">
              Selesai · {directDone} lagu berhasil disimpan langsung
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              File audio telah diunduh satu per satu langsung ke folder unduhan browser kamu.
            </p>
          </div>
        </div>
      ) : null}

      {showProgress ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-fg">
              {running
                ? "Mengunduh antrean…"
                : zipState.status === "ready"
                  ? "Semua selesai"
                  : "Antrean berhenti"}
            </p>
            <p className="tnum text-xs text-faint">
              {doneCards.length}/{queue.length} lagu ·{" "}
              {Math.round(overall)}%
            </p>
          </div>

          <ProgressBar percent={overall} label="Progres unduhan semua" />

          {failedCards.length > 0 ? (
            <p className="text-xs leading-relaxed text-danger">
              {failedCards.length} lagu gagal. Tekan Unduh semua lagi untuk
              mengulang yang gagal.
            </p>
          ) : null}
        </div>
      ) : null}

      {zipState.status === "building" ? (
        <div className="flex items-center gap-2 rounded-control border border-line bg-surface/60 px-3 py-2.5 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          Membuat ZIP…
        </div>
      ) : null}

      {zipState.status === "ready" ? (
        <div className="flex flex-col gap-3 rounded-card border border-accent/30 bg-accent/10 p-4">
          <div className="flex items-start gap-2">
            <FileArchive
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-accent"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-accent">
                ZIP siap · {zipState.files} file · {formatBytes(zipState.bytes)}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {zipState.autoSaved
                  ? "Unduhan otomatis sudah dimulai. Kalau terlewat, klik tombol di bawah."
                  : "Klik tombol di bawah untuk mengunduh."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => saveBlob(zipState.blob, zipState.name)}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-strong"
          >
            <Download size={16} aria-hidden="true" />
            Unduh ZIP ({formatBytes(zipState.bytes)})
          </button>
        </div>
      ) : null}

      {zipState.status === "error" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-danger/40 bg-danger-soft px-3 py-2">
          <p className="text-xs leading-relaxed text-danger">
            {zipState.message}
          </p>
          <button
            type="button"
            onClick={() =>
              void buildZip(
                doneCards
                  .filter((card) => card.blob && card.filename)
                  .map((card) => ({
                    name: card.filename as string,
                    blob: card.blob as Blob,
                  })),
                true,
              )
            }
            className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-[11px] font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <FileArchive size={12} aria-hidden="true" />
            Buat ulang ZIP
          </button>
        </div>
      ) : null}

      {zipTooBig ? (
        <p className="rounded-control border border-danger/40 bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
          Total {formatBytes(doneBytes)} melebihi batas ZIP 300 MB, jadi ZIP
          tidak dibuat. Simpan lagu satu per satu lewat tombol di tiap kartu.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {cards.map((card, index) => {
          const downloading = card.status === "downloading";
          const downgraded =
            card.status === "done" &&
            card.resolvedFormat &&
            card.resolvedFormat !== card.format;

          return (
            <li
              key={card.id}
              className="rounded-card border border-line bg-surface/50 p-3 sm:p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                  Link {index + 1}
                </span>
                <span
                  className={[
                    "ml-auto text-[11px]",
                    card.status === "done"
                      ? "text-accent"
                      : card.status === "error"
                        ? "text-danger"
                        : "text-faint",
                  ].join(" ")}
                >
                  {cardStatusLabel(card)}
                </span>
                <button
                  type="button"
                  onClick={() => removeCard(card.id)}
                  disabled={running}
                  aria-label={`Hapus link ${index + 1}`}
                  className="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-faint transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadInfo(card.id, card.url);
                }}
                className="mt-2 flex gap-2"
              >
                <div className="relative min-w-0 flex-1">
                  <Link2
                    size={16}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={card.url}
                    disabled={downloading || running}
                    onChange={(event) => updateUrl(card.id, event.target.value)}
                    onPaste={(event) => handlePaste(event, card.id)}
                    placeholder="https://youtu.be/..."
                    aria-label={`Link YouTube ${index + 1}`}
                    className="h-11 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={
                    !card.url.trim() ||
                    card.status === "loading" ||
                    downloading ||
                    running
                  }
                  className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control border border-line bg-surface-2 px-3 text-sm font-medium text-fg transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {card.status === "loading" ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {card.status === "loading" ? "Mengambil…" : "Ambil info"}
                </button>
              </form>

              {card.error ? (
                <p
                  role="alert"
                  className="mt-2 flex items-start gap-2 rounded-control border border-danger/40 bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger"
                >
                  <AlertCircle
                    size={14}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  />
                  <span>{card.error}</span>
                </p>
              ) : null}

              {card.info ? (
                <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                  <SongCard info={card.info} />

                  <QualityPicker
                    options={card.info.qualities}
                    value={card.format}
                    onChange={(id) =>
                      patch(card.id, {
                        format: id as FormatId,
                        // The stored blob belongs to the previous quality.
                        status: card.status === "done" ? "ready" : card.status,
                        blob: card.status === "done" ? null : card.blob,
                        filename:
                          card.status === "done" ? null : card.filename,
                        resolvedFormat:
                          card.status === "done" ? null : card.resolvedFormat,
                      })
                    }
                    disabled={downloading || running}
                    legend="Kualitas"
                  />

                  {card.info.tooLong ? (
                    <p className="rounded-control border border-danger/40 bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
                      Durasi melebihi batas 2 jam, jadi file ini tidak bisa
                      diproses.
                    </p>
                  ) : null}

                  {card.status === "ready" && !running && !card.info.tooLong ? (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => void startDownload(card, true)}
                        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface-2 px-2.5 text-xs font-medium text-fg transition-colors hover:bg-surface"
                      >
                        <Download size={13} aria-hidden="true" />
                        Unduh lagu ini
                      </button>
                    </div>
                  ) : null}

                  {downloading && card.progress ? (
                    <div className="flex flex-col gap-1.5">
                      <ProgressBar percent={card.progress.percent} />
                      <div className="tnum flex flex-wrap items-center justify-between gap-x-3 text-xs text-faint">
                        <span>{formatPercent(card.progress.percent)}</span>
                        <span>
                          {formatBytes(card.progress.loaded)} /{" "}
                          {card.progress.total
                            ? formatBytes(card.progress.total)
                            : "…"}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {card.status === "done" && card.filename ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-accent">
                      <Check size={14} aria-hidden="true" className="shrink-0" />
                      <span className="min-w-0 break-words">
                        {card.filename}
                        {card.blob ? ` · ${formatBytes(card.blob.size)}` : ""}
                        {card.savedDirectly ? " · Tersimpan" : ""}
                        {downgraded && card.resolvedFormat
                          ? ` · ${FORMATS[card.resolvedFormat].label}`
                          : ""}
                      </span>
                      {card.blob ? (
                        <button
                          type="button"
                          onClick={() => saveBlob(card.blob!, card.filename!)}
                          className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-[11px] font-medium text-fg transition-colors hover:bg-surface-2"
                        >
                          <Save size={12} aria-hidden="true" />
                          Simpan lagi
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
