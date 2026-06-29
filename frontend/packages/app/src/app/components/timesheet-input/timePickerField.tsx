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
    <div className={mergeClassNames("flex w-full min-w-[6.5rem] border rounded-md h-8", className)}>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        className="h-8 min-h-8 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 border-r rounded-none px-2 text-xs"
        type="text"
      />
      <div className="[&_button]:h-8 [&_button]:min-h-8 [&_button]:px-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5 shrink-0">
        <TimeSelector onClick={onChange} />
      </div>
    </div>
  );
};
