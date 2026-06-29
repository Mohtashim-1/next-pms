/**
 * Compact time field with preset dropdown (same pattern as Add Time).
 */
import { Input } from "@next-pms/design-system/components";
import { floatToTime, mergeClassNames } from "@next-pms/design-system/utils";

import TimeSelector from "@/app/components/add-time/time-selector";
import { formatTime } from "@/lib/utils";

type TimePickerFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

function normalizeTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let time = trimmed;
  if (!time.includes(":")) {
    const numeric = Number(time);
    if (Number.isNaN(numeric)) return null;
    time = floatToTime(numeric, 2, 2);
  }

  return formatTime(time);
}

export const TimePickerField = ({
  value,
  onChange,
  placeholder = "09:00",
  className,
}: TimePickerFieldProps) => {
  const isLarge = className?.includes("h-10");
  const handleBlur = () => {
    if (!value.trim()) return;
    try {
      const normalized = normalizeTimeInput(value);
      if (normalized) onChange(normalized);
    } catch {
      // Keep typed value when format is invalid.
    }
  };

  return (
    <div
      className={mergeClassNames(
        "flex w-full min-w-[6.5rem] rounded-lg border border-muted-foreground/20 bg-background shadow-sm",
        isLarge ? "h-10" : "h-8",
        className
      )}
    >
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        className={mergeClassNames(
          "rounded-none border-0 border-r bg-transparent placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 px-2",
          isLarge ? "h-10 min-h-10 text-sm" : "h-8 min-h-8 text-xs"
        )}
        type="text"
      />
      <div
        className={mergeClassNames(
          "shrink-0 [&_button]:px-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5",
          isLarge ? "[&_button]:h-10 [&_button]:min-h-10" : "[&_button]:h-8 [&_button]:min-h-8"
        )}
      >
        <TimeSelector onClick={onChange} />
      </div>
    </div>
  );
};
