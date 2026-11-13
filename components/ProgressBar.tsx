type ProgressBarProps = {
  percent: number | null;
  className?: string;
  label?: string;
};

export default function ProgressBar({
  percent,
  className = "",
  label = "Progres unduhan",
}: ProgressBarProps) {
  const indeterminate = percent === null;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      aria-valuetext={indeterminate ? "Sedang diproses" : `${Math.round(percent)}%`}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      {indeterminate ? (
        <div className="h-full w-2/5 animate-pulse rounded-full bg-accent/60" />
      ) : (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      )}
    </div>
  );
}
