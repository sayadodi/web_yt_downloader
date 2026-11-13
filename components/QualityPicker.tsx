import type { QualityOption } from "@/lib/client/types";

type QualityPickerProps = {
  options: QualityOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  legend?: string;
};

export default function QualityPicker({
  options,
  value,
  onChange,
  disabled = false,
  legend = "Kualitas",
}: QualityPickerProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
        {legend}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = value === option.id;
          const isDisabled = !option.available;

          return (
            <label
              key={option.id}
              className={[
                "relative flex items-center justify-between gap-3 rounded-control border px-3 py-2.5 transition-colors duration-200",
                selected
                  ? "border-accent bg-accent/10"
                  : "border-line bg-surface",
                isDisabled
                  ? "cursor-not-allowed opacity-45"
                  : "cursor-pointer hover:border-line hover:bg-surface-2",
                disabled ? "cursor-not-allowed" : "",
              ].join(" ")}
            >
              <input
                type="radio"
                name="quality"
                value={option.id}
                checked={selected}
                disabled={isDisabled}
                onChange={() => onChange(option.id)}
                className="sr-only"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">
                  {option.label}
                </span>
                <span className="tnum block text-xs text-faint">
                  {option.kbps} kbps · ±{option.sizeMB.toFixed(1)} MB
                </span>
                {isDisabled && option.reason ? (
                  <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                    {option.reason}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                className={[
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  selected ? "border-accent" : "border-line",
                ].join(" ")}
              >
                {selected ? (
                  <span className="size-2 rounded-full bg-accent" />
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
