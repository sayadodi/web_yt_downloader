"use client";

import { useState } from "react";
import { ListMusic, Music2 } from "lucide-react";

import BatchMode from "./BatchMode";
import SingleMode from "./SingleMode";
import QuotaBadge from "./QuotaBadge";

type Mode = "single" | "batch";

const TABS: { id: Mode; label: string; hint: string }[] = [
  { id: "single", label: "Satu lagu", hint: "Satu link, pilih kualitas" },
  { id: "batch", label: "Banyak link", hint: "Sampai 20 form, satu klik unduh semua" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-10 pt-6 sm:pt-12">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <span className="grid size-9 sm:size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink">
            <Music2 size={18} className="sm:hidden" aria-hidden="true" />
            <Music2 size={20} className="hidden sm:block" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg sm:text-xl font-bold leading-none tracking-tight text-fg truncate">
              YT Audio
            </p>
            <p className="mt-1 text-[11px] sm:text-xs text-faint truncate">
              Unduh lagu dari YouTube jadi MP3
            </p>
          </div>
        </div>

        <QuotaBadge />
      </header>

      <main className="mt-8 flex flex-1 flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-[28px]">
            Tempel link, ambil audionya.
          </h1>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">
            Pilih kualitas, unduh, selesai. File dibuat sementara di server dan
            langsung dihapus setelah terkirim.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Mode unduhan"
          className="grid grid-cols-2 gap-1 rounded-control border border-line bg-surface p-1"
        >
          {TABS.map((tab) => {
            const selected = mode === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setMode(tab.id)}
                className={[
                  "flex cursor-pointer items-center justify-center gap-2 rounded-[8px] px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                  selected
                    ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]"
                    : "text-muted hover:text-fg",
                ].join(" ")}
              >
                {tab.id === "single" ? (
                  <Music2 size={15} aria-hidden="true" />
                ) : (
                  <ListMusic size={15} aria-hidden="true" />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>

        <section
          role="tabpanel"
          id="panel-single"
          aria-labelledby="tab-single"
          hidden={mode !== "single"}
          className="min-w-0"
        >
          <p className="mb-3 text-xs text-faint">
            {TABS[0].hint}
          </p>
          <SingleMode />
        </section>

        <section
          role="tabpanel"
          id="panel-batch"
          aria-labelledby="tab-batch"
          hidden={mode !== "batch"}
          className="min-w-0"
        >
          <p className="mb-3 text-xs text-faint">
            {TABS[1].hint}
          </p>
          {/* Kept mounted so a running batch survives switching tabs. */}
          <BatchMode />
        </section>
      </main>

      <footer className="mt-10 flex flex-col gap-2 border-t border-line pt-5 text-[11px] leading-relaxed text-faint">
        <p>
          Batas durasi 2 jam per lagu. Untuk video panjang, kualitas tinggi
          otomatis diturunkan agar proses selesai tepat waktu.
        </p>
        <p>
          Gunakan hanya untuk konten yang kamu berhak unduh. Hormati hak cipta
          pembuat konten.
        </p>
      </footer>
    </div>
  );
}
