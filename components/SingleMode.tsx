"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  Link2,
  Loader2,
} from "lucide-react";

import { ClientError, fetchVideoInfo } from "@/lib/client/api";
import {
  downloadAudio,
  saveBlob,
  type DownloadProgress,
} from "@/lib/client/download";
import { formatBytes, formatPercent, formatSpeed } from "@/lib/client/format";
import type { VideoInfoResponse } from "@/lib/client/types";
import { FORMATS, type FormatId } from "@/lib/quality";
import ProgressBar from "./ProgressBar";
import QualityPicker from "./QualityPicker";
import SongCard from "./SongCard";

type Phase = "idle" | "loading" | "ready" | "downloading" | "done";

function defaultFormat(info: VideoInfoResponse): FormatId {
  const preferred = info.qualities.find((q) => q.id === "mp3_320" && q.available);
  const fallback = info.qualities.find((q) => q.available);
  return (preferred?.id ?? fallback?.id ?? "m4a") as FormatId;
}

export default function SingleMode() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<VideoInfoResponse | null>(null);
  const [format, setFormat] = useState<FormatId>("mp3_320");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setInfo(null);
    setPhase("idle");
    setProgress(null);
    setError(null);
    setSavedName(null);
  }, []);

  const handleFetch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || phase === "loading" || phase === "downloading") return;

    reset();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("loading");

    try {
      const data = await fetchVideoInfo(url, controller.signal);
      setInfo(data);
      setFormat(defaultFormat(data));
      setPhase("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof ClientError ? err.message : "Gagal mengambil info video.",
      );
      setPhase("idle");
    } finally {
      controllerRef.current = null;
    }
  };

  const handleDownload = async () => {
    if (!info) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("downloading");
    setProgress({ loaded: 0, total: null, percent: null, bytesPerSecond: null });
    setError(null);

    try {
      const { blob, filename } = await downloadAudio({
        url: `https://www.youtube.com/watch?v=${info.id}`,
        format,
        signal: controller.signal,
        onProgress: setProgress,
      });
      saveBlob(blob, filename);
      setSavedName(filename);
      setPhase("done");
      window.dispatchEvent(new Event("ytaudio-quota-updated"));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof ClientError ? err.message : "Gagal mengunduh audio.",
      );
      setPhase("ready");
    } finally {
      controllerRef.current = null;
    }
  };

  const isBusy = phase === "loading" || phase === "downloading";
  const canDownload = Boolean(info) && !isBusy && !info?.tooLong;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleFetch} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Link2
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (info) reset();
            }}
            placeholder="https://youtu.be/..."
            aria-label="Link YouTube"
            className="h-12 w-full rounded-control border border-line bg-surface pl-10 pr-3 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={!url.trim() || isBusy}
          className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-control border border-line bg-surface-2 px-4 text-sm font-medium text-fg transition-colors duration-200 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "loading" ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : null}
          {phase === "loading" ? "Mengambil…" : "Ambil info"}
        </button>
      </form>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {info ? (
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface/50 p-4">
          <SongCard info={info} />

          <div className="h-px w-full bg-line" />

          <QualityPicker
            options={info.qualities}
            value={format}
            onChange={(id) => setFormat(id as FormatId)}
            disabled={phase === "downloading"}
          />

          {info.tooLong ? (
            <p className="rounded-control border border-danger/40 bg-danger-soft px-3 py-2.5 text-xs leading-relaxed text-danger">
              Durasi melebihi batas 2 jam, jadi file ini tidak bisa diproses.
            </p>
          ) : null}

          {phase === "downloading" && progress ? (
            <div className="flex flex-col gap-1.5">
              <ProgressBar percent={progress.percent} />
              <div className="tnum flex flex-wrap items-center justify-between gap-x-3 text-xs text-faint">
                <span>{formatPercent(progress.percent)}</span>
                <span>
                  {formatBytes(progress.loaded)} /{" "}
                  {progress.total ? formatBytes(progress.total) : "…"}
                  {progress.bytesPerSecond
                    ? ` · ${formatSpeed(progress.bytesPerSecond)}`
                    : ""}
                </span>
              </div>
            </div>
          ) : null}

          {phase === "done" && savedName ? (
            <div className="flex items-start gap-2 rounded-control border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm text-accent">
              <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">Tersimpan: {savedName}</span>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "downloading" ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : phase === "done" ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <Download size={18} aria-hidden="true" />
            )}
            {phase === "downloading"
              ? "Mengunduh…"
              : phase === "done"
                ? "Unduh lagi"
                : `Unduh ${FORMATS[format].label}`}
          </button>

          <p className="text-[11px] leading-relaxed text-faint">
            File dibuat di memori sementara server lalu langsung dihapus setelah
            terkirim.
          </p>
        </div>
      ) : null}
    </div>
  );
}
