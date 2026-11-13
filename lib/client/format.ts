export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number | null): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(percent: number | null): string {
  if (percent === null) return "…";
  return `${percent.toFixed(percent >= 100 ? 0 : 1)}%`;
}
