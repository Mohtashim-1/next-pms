/**
 * Time / duration field with optional air-datepicker sliders.
 * - Typing in the input always works.
 * - Clock icon opens the slider popup; it stays open while you drag,
 *   and closes only on outside click, Tab to another field, Enter, or Escape.
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

/** Custom event — picker opens from the clock icon, not on every focus. */
const OPEN_PICKER_EVENT = "nextpms:open-timepicker";

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

function looksComplete(raw: string): boolean {
  return /^\d{1,2}:\d{2}$/.test((raw ?? "").trim());
}

const debugTimePicker = (label: string, ariaLabel: string | undefined, details?: unknown) => {
  console.log(`[TimePickerField:${ariaLabel || "time"}] ${label}`, details ?? {});
};

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
  const focusedRef = useRef(false);
  const ignorePickerSelectRef = useRef(false);
  /** True while pointer is down inside the slider popup — blur must not close it. */
  const pointerInPickerRef = useRef(false);
  const pickerOpenRef = useRef(false);

  const isLarge = className?.includes("h-10");

  const commitTypedValue = (raw: string, hidePicker: boolean) => {
    const normalized = toTimeValue(raw);
    debugTimePicker("commitTypedValue", ariaLabel, { raw, normalized, hidePicker });
    ignorePickerSelectRef.current = true;

    if (hidePicker) {
      pickerRef.current?.hide();
      pickerOpenRef.current = false;
    }

    if (!normalized) {
      if (inputRef.current) inputRef.current.value = raw;
      onChange(raw.trim());
    } else {
      if (inputRef.current) inputRef.current.value = normalized;
      onChange(normalized);
      const picker = pickerRef.current;
      if (picker && !hidePicker) {
        const selected = picker.selectedDates[0];
        if (!selected || fromDate(selected) !== normalized) {
          picker.selectDate(toDate(normalized), { silent: true });
        }
      } else if (picker && hidePicker) {
        const selected = picker.selectedDates[0];
        if (!selected || fromDate(selected) !== normalized) {
          picker.selectDate(toDate(normalized), { silent: true });
        }
      }
    }

    window.setTimeout(() => {
      ignorePickerSelectRef.current = false;
    }, 0);
  };

  useEffect(() => {
    if (!inputRef.current || !containerRef.current) return;

    const picker = new AirDatepicker(inputRef.current, {
      container: containerRef.current,
      timepicker: true,
      onlyTimepicker: true,
      timeFormat: "HH:mm",
      autoClose: false,
      isMobile: false,
      keyboardNav: false,
      showEvent: OPEN_PICKER_EVENT,
      ...(showNow
        ? {
            buttons: [
              {
                content: "Now",
                onClick: (instance: AirDatepicker) => {
                  ignorePickerSelectRef.current = false;
                  instance.selectDate(new Date());
                  // Keep open — user closes by clicking outside / leaving field.
                },
              },
            ],
          }
        : {}),
      onShow: (isFinished) => {
        if (!isFinished) return;
        pickerOpenRef.current = true;
        const seed = toTimeValue(valueRef.current) || toTimeValue(inputRef.current?.value || "");
        const next = seed || fromDate(new Date());
        debugTimePicker("picker onShow", ariaLabel, { seed, next });
        ignorePickerSelectRef.current = true;
        if (!picker.selectedDates.length || (seed && fromDate(picker.selectedDates[0]) !== seed)) {
          picker.selectDate(toDate(next), { silent: true });
        }
        if (inputRef.current && seed) {
          inputRef.current.value = seed;
        }
        window.setTimeout(() => {
          ignorePickerSelectRef.current = false;
        }, 0);
      },
      onHide: (isFinished) => {
        if (isFinished) pickerOpenRef.current = false;
      },
      onSelect: ({ date }) => {
        if (ignorePickerSelectRef.current) return;
        const selected = Array.isArray(date) ? date[0] : date;
        if (!selected) return;
        const next = fromDate(selected);
        debugTimePicker("picker onSelect", ariaLabel, { next });
        if (inputRef.current) inputRef.current.value = next;
        onChangeRef.current(next);
        // Do NOT hide — stay open until outside click / other field / Escape.
      },
    });
    pickerRef.current = picker;
    inputRef.current.removeAttribute("readonly");

    return () => {
      picker.destroy();
      pickerRef.current = null;
    };
  }, [ariaLabel, showNow]);

  // Keep popup open while dragging sliders; close only on true outside click.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const pickerEl = container.querySelector(".air-datepicker");
      const insidePicker = Boolean(pickerEl?.contains(target));
      const insideField = container.contains(target);

      if (insidePicker) {
        pointerInPickerRef.current = true;
        return;
      }

      pointerInPickerRef.current = false;

      // Clicked outside this field entirely while picker is open → commit + close.
      if (pickerOpenRef.current && !insideField) {
        debugTimePicker("outside click -> close", ariaLabel, {});
        commitTypedValue(inputRef.current?.value || "", true);
      }
    };

    const onPointerUp = () => {
      // Allow a following blur to see the flag during the same gesture.
      window.setTimeout(() => {
        pointerInPickerRef.current = false;
      }, 0);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel]);

  useEffect(() => {
    const picker = pickerRef.current;
    const input = inputRef.current;
    if (!picker || !input) return;
    if (focusedRef.current || document.activeElement === input || pickerOpenRef.current) return;

    const normalized = toTimeValue(value);
    if (!normalized) {
      if (picker.selectedDates.length) picker.clear({ silent: true });
      if (input.value !== "") input.value = "";
      return;
    }

    const selected = picker.selectedDates[0];
    if (!selected || fromDate(selected) !== normalized) {
      ignorePickerSelectRef.current = true;
      picker.selectDate(toDate(normalized), { silent: true });
      ignorePickerSelectRef.current = false;
    }
    if (input.value !== normalized) input.value = normalized;
  }, [value]);

  const openPicker = () => {
    const input = inputRef.current;
    const picker = pickerRef.current;
    if (!input || !picker) return;
    input.removeAttribute("readonly");
    const seed = toTimeValue(input.value) || toTimeValue(valueRef.current);
    if (seed) {
      ignorePickerSelectRef.current = true;
      picker.selectDate(toDate(seed), { silent: true });
      input.value = seed;
      window.setTimeout(() => {
        ignorePickerSelectRef.current = false;
      }, 0);
    }
    input.focus({ preventScroll: true });
    debugTimePicker("open picker via clock", ariaLabel, { seed });
    input.dispatchEvent(new Event(OPEN_PICKER_EVENT));
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        tabIndex={-1}
        className="absolute left-0 top-0 z-10 flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={`Open ${ariaLabel || "time"} picker`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openPicker();
        }}
      >
        <Clock3 className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        placeholder={placeholder}
        defaultValue={toTimeValue(value)}
        onFocus={() => {
          focusedRef.current = true;
          inputRef.current?.removeAttribute("readonly");
        }}
        onChange={(event) => {
          const raw = event.target.value;
          if (looksComplete(raw)) {
            const normalized = toTimeValue(raw);
            onChange(normalized || raw);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          // Clicking the slider blurs the input — keep the popup open in that case.
          window.setTimeout(() => {
            if (pointerInPickerRef.current || pickerOpenRef.current) {
              debugTimePicker("blur ignored (picker still open)", ariaLabel, {
                pointerInPicker: pointerInPickerRef.current,
                pickerOpen: pickerOpenRef.current,
              });
              return;
            }
            const active = document.activeElement;
            if (containerRef.current?.contains(active)) return;
            commitTypedValue(inputRef.current?.value || "", true);
          }, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commitTypedValue((event.target as HTMLInputElement).value, true);
            (event.target as HTMLInputElement).blur();
            return;
          }
          if (event.key === "Tab") {
            event.stopPropagation();
            commitTypedValue((event.target as HTMLInputElement).value, true);
          }
          if (event.key === "Escape") {
            pickerRef.current?.hide();
            pickerOpenRef.current = false;
          }
        }}
        className={mergeClassNames(
          "w-full cursor-text rounded-md border border-input bg-background pl-9 pr-3 text-foreground shadow-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isLarge ? "h-10 text-sm" : "h-8 text-xs",
          className
        )}
      />
    </div>
  );
};
