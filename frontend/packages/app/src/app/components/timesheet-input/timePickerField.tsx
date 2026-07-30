/**
 * Time field using air-datepicker in timepicker-only mode, matching the
 * hour/minute sliders and "Now" button of Frappe desk Time controls.
 */
import { useEffect, useRef } from "react";
import AirDatepicker from "air-datepicker";
import { floatToTime, mergeClassNames } from "@next-pms/design-system/utils";
import { Clock3 } from "lucide-react";

import { formatTime } from "@/lib/utils";

import "air-datepicker/air-datepicker.css";
import "./timePickerField.css";

type TimePickerFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** The "Now" shortcut only makes sense for clock times, not for durations. */
  showNow?: boolean;
  ariaLabel?: string;
};

/** Accepts "8", "8.5" or "08:30" and returns "HH:mm" the picker can render. */
function toTimeValue(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  try {
    let time = trimmed;
    if (!time.includes(":")) {
      const numeric = Number(time);
      if (Number.isNaN(numeric)) return "";
      time = floatToTime(numeric, 2, 2);
    }
    const [hours, minutes] = formatTime(time).split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return "";
    // The slider track only spans a single day.
    if (hours > 23) return "23:59";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function toDate(time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function fromDate(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export const TimePickerField = ({
  value,
  onChange,
  placeholder = "00:00",
  className,
  showNow = true,
  ariaLabel,
}: TimePickerFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<AirDatepicker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const isLarge = className?.includes("h-10");

  useEffect(() => {
    if (!inputRef.current || !containerRef.current) return;

    const picker = new AirDatepicker(inputRef.current, {
      // Radix dialogs and popovers disable pointer events on <body>, which makes
      // air-datepicker's default body-level container unusable. Keeping the
      // picker inside this field also keeps it out of the dialog's focus trap.
      container: containerRef.current,
      timepicker: true,
      onlyTimepicker: true,
      timeFormat: "HH:mm",
      autoClose: false,
      isMobile: false,
      ...(showNow
        ? {
            buttons: [
              {
                content: "Now",
                onClick: (instance: AirDatepicker) => {
                  instance.selectDate(new Date());
                  instance.hide();
                },
              },
            ],
          }
        : {}),
      onShow: (isFinished) => {
        // The sliders only emit a change when a date is already selected.
        if (!isFinished || picker.selectedDates.length) return;
        picker.selectDate(toDate(toTimeValue(valueRef.current) || fromDate(new Date())), { silent: true });
      },
      onSelect: ({ date }) => {
        const selected = Array.isArray(date) ? date[0] : date;
        if (selected) onChangeRef.current(fromDate(selected));
      },
    });
    pickerRef.current = picker;

    return () => {
      picker.destroy();
      pickerRef.current = null;
    };
  }, [showNow]);

  useEffect(() => {
    const picker = pickerRef.current;
    const input = inputRef.current;
    if (!picker || !input) return;

    const normalized = toTimeValue(value);
    if (!normalized) {
      if (picker.selectedDates.length) picker.clear({ silent: true });
      if (document.activeElement !== input) input.value = "";
      return;
    }

    const selected = picker.selectedDates[0];
    if (!selected || fromDate(selected) !== normalized) {
      picker.selectDate(toDate(normalized), { silent: true });
    }
    // Never rewrite the field mid-keystroke, it would move the caret and
    // reformat a half-typed value.
    if (document.activeElement !== input && input.value !== normalized) {
      input.value = normalized;
    }
  }, [value]);

  return (
    <div ref={containerRef} className="relative w-full">
      <Clock3 className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        placeholder={placeholder}
        defaultValue={toTimeValue(value)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          const normalized = toTimeValue(event.target.value);
          if (normalized) {
            event.target.value = normalized;
            onChange(normalized);
          }
        }}
        className={mergeClassNames(
          "w-full cursor-pointer rounded-md border border-input bg-background pl-9 pr-3 text-foreground shadow-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isLarge ? "h-10 text-sm" : "h-8 text-xs",
          className
        )}
      />
    </div>
  );
};
