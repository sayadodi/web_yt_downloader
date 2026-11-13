"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, HardDrive, Info, RefreshCw, X, Zap } from "lucide-react";

import type { QuotaInfo } from "@/lib/quota";

export default function QuotaBadge() {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const popoverRef = useRef<HTMLDivElement | null>(null);

  const loadQuota = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/quota", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as QuotaInfo;
        setQuota(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQuota();

    const handleUpdated = () => {
      void loadQuota();
    };

    window.addEventListener("ytaudio-quota-updated", handleUpdated);

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("ytaudio-quota-updated", handleUpdated);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!quota) return null;

  const isLow = quota.remaining < quota.limit * 0.2;
  const isCritical = quota.remaining < quota.limit * 0.05 || quota.isExhausted;

  const dotColor = isCritical
    ? "bg-danger"
    : isLow
      ? "bg-amber-400"
      : "bg-accent";

  const percentUsed = Math.min(
    100,
    Math.round((quota.used / quota.limit) * 100),
  );

  const isLive = quota.source === "vercel_api";

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 sm:gap-2 rounded-control border border-line bg-surface/80 px-2 sm:px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-line/80 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title="Lihat detail kuota server Vercel bulan ini"
      >
        <span
          className={`size-2 shrink-0 rounded-full ${dotColor} ${isCritical ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
        <Zap size={13} className="text-accent shrink-0" aria-hidden="true" />
        <span className="tnum font-medium text-fg">
          {quota.remaining.toLocaleString("id-ID")}
        </span>
        <span className="text-faint hidden sm:inline">
          / {quota.limit.toLocaleString("id-ID")} lagu
        </span>
        <span className="text-faint sm:hidden">lagu</span>
      </button>

      {open ? (
        <>
          {/* Backdrop on mobile */}
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] sm:hidden animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-label="Informasi Kuota Server"
            className="fixed left-4 right-4 top-1/2 z-50 -translate-y-1/2 max-w-sm mx-auto rounded-card border border-line bg-surface-2 p-4 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:translate-y-0 sm:w-84 sm:max-w-none sm:shadow-xl sm:shadow-black/40 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-line gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Cpu size={15} className="text-accent shrink-0" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-fg truncate">
                  Kuota Serverless Vercel
                </h3>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    isLive
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-surface text-faint border border-line"
                  }`}
                >
                  {isLive
                    ? `● Live (${quota.debug?.username || "Vercel"})`
                    : "Estimasi"}
                </span>

                <button
                  type="button"
                  onClick={() => void loadQuota()}
                  disabled={loading}
                  aria-label="Refresh kuota"
                  className="grid size-6 place-items-center rounded text-faint hover:text-fg hover:bg-surface cursor-pointer transition-colors"
                >
                  <RefreshCw
                    size={12}
                    className={loading ? "animate-spin" : ""}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Tutup"
                  className="grid size-6 place-items-center rounded text-faint hover:text-fg hover:bg-surface cursor-pointer transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

          <div className="mt-3 flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted">Periode {quota.monthLabel}</span>
              <span className="font-semibold text-fg">
                {quota.percentRemaining}% sisa
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface border border-line">
              <div
                className={`h-full transition-all duration-300 ${
                  isCritical ? "bg-danger" : isLow ? "bg-amber-400" : "bg-accent"
                }`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-control bg-surface p-2 text-xs">
              <div>
                <p className="text-faint text-[11px]">Terpakai</p>
                <p className="tnum font-medium text-fg">
                  {quota.used.toLocaleString("id-ID")} lagu
                </p>
              </div>
              <div>
                <p className="text-faint text-[11px]">Sisa Kuota</p>
                <p
                  className={`tnum font-semibold ${
                    isCritical
                      ? "text-danger"
                      : isLow
                        ? "text-amber-400"
                        : "text-accent"
                  }`}
                >
                  {quota.remaining.toLocaleString("id-ID")} lagu
                </p>
              </div>
            </div>

            {/* Live Vercel Metrics breakdown if available */}
            {quota.vercelDetails ? (
              <div className="grid grid-cols-2 gap-2 rounded-control border border-line/60 bg-surface/40 p-2 text-[11px]">
                <div>
                  <p className="text-faint">CPU Serverless</p>
                  <p className="font-medium text-fg">
                    {quota.vercelDetails.cpuUsedHours} / {quota.vercelDetails.cpuLimitHours} Jam
                  </p>
                </div>
                <div>
                  <p className="text-faint">Bandwidth Akun</p>
                  <p className="font-medium text-fg">
                    {quota.vercelDetails.bandwidthUsedGB} / {quota.vercelDetails.bandwidthLimitGB} GB
                  </p>
                </div>
              </div>
            ) : null}

            {/* Status Cookies YouTube Bypass */}
            <div className="flex items-center justify-between rounded-control border border-line/60 bg-surface/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-faint">Status Cookies YouTube:</span>
              <span
                className={`font-medium ${
                  quota.debug?.hasCookies && quota.debug?.hasLoginCookies !== false
                    ? "text-accent"
                    : quota.debug?.hasCookies
                    ? "text-amber-400"
                    : "text-faint"
                }`}
              >
                {quota.debug?.hasCookies
                  ? quota.debug?.cookieCount
                    ? quota.debug.hasLoginCookies
                      ? `● Terhubung (${quota.debug.cookieCount} cookies, Login OK)`
                      : `⚠ ${quota.debug.cookieCount} cookies (Belum Login)`
                    : "● Terhubung (Bypass Bot OK)"
                  : "○ Belum terpasang"}
              </span>
            </div>

            <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted bg-surface/40 rounded p-2 border border-line/50">
              <Info size={13} className="shrink-0 mt-0.5 text-accent" />
              <span>
                {isLive ? (
                  <>
                    Data ditarik langsung dari akun Vercel <strong>{quota.debug?.username ? `@${quota.debug.username}` : "Live API"}</strong>. Kuota akan direset otomatis pada{" "}
                    <strong className="text-fg">{quota.resetDate}</strong>.
                  </>
                ) : quota.debug?.hasToken === false ? (
                  <>
                    Variabel <code className="text-accent">VERCEL_API_TOKEN</code> belum aktif pada deployment ini. Silakan buka Vercel tab <strong>Deployments &gt; Redeploy</strong>.
                  </>
                ) : quota.debug?.usageError ? (
                  <>
                    Gagal memuat API Vercel: <span className="text-danger">{quota.debug.usageError}</span>
                  </>
                ) : (
                  <>
                    Estimasi aman batas gratis Vercel Hobby (4 jam CPU / ~1.200 lagu). Direset pada{" "}
                    <strong className="text-fg">{quota.resetDate}</strong>.
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </>
    ) : null}
    </div>
  );
}
