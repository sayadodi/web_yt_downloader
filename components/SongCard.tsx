"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, Loader2, Pause, Play, UserRound, Volume2 } from "lucide-react";

import type { VideoInfoResponse } from "@/lib/client/types";

export default function SongCard({ info }: { info: VideoInfoResponse }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const handleGlobalPlay = (event: Event) => {
      const customEvent = event as CustomEvent<{ id: string }>;
      if (customEvent.detail?.id !== info.id && audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    };

    window.addEventListener("ytaudio-preview-play", handleGlobalPlay);

    return () => {
      window.removeEventListener("ytaudio-preview-play", handleGlobalPlay);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, [info.id]);

  const togglePreview = () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (!audioRef.current) {
      const audio = new Audio(`/api/preview?id=${encodeURIComponent(info.id)}`);
      audio.preload = "none";

      audio.onwaiting = () => setIsLoading(true);
      audio.onplaying = () => {
        setIsLoading(false);
        setIsPlaying(true);
      };
      audio.onpause = () => {
        setIsPlaying(false);
        setIsLoading(false);
      };
      audio.onended = () => {
        setIsPlaying(false);
        setIsLoading(false);
      };
      audio.onerror = () => {
        setIsLoading(false);
        setIsPlaying(false);
        setHasError(true);
      };

      audioRef.current = audio;
    }

    window.dispatchEvent(
      new CustomEvent("ytaudio-preview-play", { detail: { id: info.id } }),
    );

    setIsLoading(true);
    setHasError(false);

    audioRef.current.play().catch(() => {
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(true);
    });
  };

  return (
    <div className="flex gap-3">
      {/* Thumbnail with interactive Play/Pause overlay */}
      <div className="relative h-[63px] w-[112px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={info.thumbnail}
          alt=""
          width={112}
          height={63}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        <button
          type="button"
          onClick={togglePreview}
          aria-label={
            isPlaying
              ? `Jeda preview audio ${info.title}`
              : `Putar preview audio ${info.title}`
          }
          className="absolute inset-0 flex items-center justify-center bg-black/45 transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span
            className={[
              "grid size-8 place-items-center rounded-full shadow-md transition-all duration-200 active:scale-95",
              isPlaying || isLoading
                ? "bg-accent text-accent-ink scale-105 ring-2 ring-accent/50"
                : "bg-surface/90 text-fg hover:bg-accent hover:text-accent-ink hover:scale-105",
            ].join(" ")}
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : isPlaying ? (
              <Pause size={15} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play
                size={15}
                fill="currentColor"
                className="ml-0.5"
                aria-hidden="true"
              />
            )}
          </span>
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-fg">
          {info.title}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {info.uploader ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{info.uploader}</span>
            </span>
          ) : null}

          <span className="tnum inline-flex items-center gap-1">
            <Clock3 size={12} aria-hidden="true" />
            {info.durationLabel}
          </span>

          {/* Quick Preview Text Control */}
          <button
            type="button"
            onClick={togglePreview}
            className={[
              "inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium transition-colors hover:underline",
              hasError
                ? "text-danger"
                : isPlaying
                  ? "text-accent font-semibold"
                  : "text-muted hover:text-fg",
            ].join(" ")}
          >
            <Volume2 size={12} aria-hidden="true" />
            {isLoading
              ? "Memuat preview…"
              : isPlaying
                ? "Jeda preview"
                : hasError
                  ? "Gagal memutar"
                  : "Preview audio"}
          </button>
        </div>
      </div>
    </div>
  );
}
