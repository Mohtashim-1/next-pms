/**
 * Time / duration field with optional air-datepicker sliders.
 *
 * - Duration: 24h `HH:mm` (optional 15-minute steps, decimal hours like 1.5).
 * - Start/End: 12h display with explicit AM/PM toggles; form value stays 24h `HH:mm`.
 *
 * "Current time" comes from the browser clock (`new Date()`), never the server.
 */
import { useEffect, useRef } from "react";
import AirDatepicker from "air-datepicker";
import localeEn from "air-datepicker/locale/en";
import { mergeClassNames } from "@next-pms/design-system/utils";
import { Clock3 } from "lucide-react";

import {
  formatClockDisplay,
  formatClockFace,
  getDayPeriod,
  parseClockTime,
  withDayPeriod,
  type DayPeriod,
} from "@/lib/timesheetClockTime";

import "air-datepicker/air-datepicker.css";
import "./timePickerField.css";

type TimePickerFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  showNow?: boolean;
  ariaLabel?: string;
  minutesStep?: number;
  hour12?: boolean;
};

const OPEN_PICKER_EVENT = "nextpms:open-timepicker";

function toDate(time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function fromDate(date: Date, minutesStep = 1): string {
  return parseClockTime(
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
    minutesStep
  );
}

function looksComplete(raw: string, hour12: boolean): boolean {
  const trimmed = (raw ?? "").trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) return true;
  if (/^\d+(\.\d{1,2})?$/.test(trimmed)) return true;
  if (hour12 && /^\d{1,2}(?::[0-5]?\d)?\s*(am|pm)$/i.test(trimmed)) return true;
  return false;
}

const debugTimePicker = (label: string, ariaLabel: string | undefined, details?: unknown) => {
  console.log(`[TimePickerField:${ariaLabel || "time"}] ${label}`, details ?? {});
};

export const TimePickerField = ({
  value,
  onChange,
  placeholder,
  className,
  showNow = true,
  ariaLabel,
  minutesStep = 1,
  hour12 = false,
}: TimePickerFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<AirDatepicker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const minutesStepRef = useRef(minutesStep);
  minutesStepRef.current = minutesStep;
  const hour12Ref = useRef(hour12);
  hour12Ref.current = hour12;
  const focusedRef = useRef(false);
  const ignorePickerSelectRef = useRef(false);
  const pointerInPickerRef = useRef(false);
  const pickerOpenRef = useRef(false);

  const isLarge = className?.includes("h-10");
  const isQuarterHour = minutesStep > 1;
  // With AM/PM toggles, the input shows only the clock face (`9:00`).
  const resolvedPlaceholder =
    placeholder || (hour12 ? "9:00" : isQuarterHour ? "1:30 or 1.5" : "00:00");
  const activePeriod = getDayPeriod(value) || "AM";

  const toInputDisplay = (hhmm: string) =>
    hour12Ref.current ? formatClockFace(hhmm) : formatClockDisplay(hhmm, false);

  const writeInputDisplay = (hhmm: string) => {
    if (!inputRef.current) return;
    inputRef.current.value = toInputDisplay(hhmm);
  };

  /** Parse typed text; if hour12 and no am/pm suffix, keep the active period. */
  const normalizeTyped = (raw: string) => {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return "";
    let normalized = parseClockTime(trimmed, minutesStepRef.current);
    if (!normalized) return "";
    if (hour12Ref.current && !/\s*(am|pm)$/i.test(trimmed)) {
      const period = getDayPeriod(valueRef.current) || "AM";
      normalized = withDayPeriod(normalized, period);
    }
    return normalized;
  };

  const commitTypedValue = (raw: string, hidePicker: boolean) => {
    const normalized = normalizeTyped(raw);
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
      writeInputDisplay(normalized);
      onChange(normalized);
      const picker = pickerRef.current;
      if (picker) {
        const selected = picker.selectedDates[0];
        if (!selected || fromDate(selected, minutesStepRef.current) !== normalized) {
          picker.selectDate(toDate(normalized), { silent: true });
        }
      }
    }

    window.setTimeout(() => {
      ignorePickerSelectRef.current = false;
    }, 0);
  };

  const applyPeriod = (period: DayPeriod) => {
    const face =
      parseClockTime(inputRef.current?.value || "", minutesStep) ||
      parseClockTime(value, minutesStep) ||
      "09:00";
    const current = withDayPeriod(face, getDayPeriod(value) || getDayPeriod(face) || "AM");
    const next = withDayPeriod(current, period);
    debugTimePicker("AM/PM toggle", ariaLabel, { current, period, next });
    writeInputDisplay(next);
    onChange(next);
    const picker = pickerRef.current;
    if (picker) {
      ignorePickerSelectRef.current = true;
      picker.selectDate(toDate(next), { silent: true });
      window.setTimeout(() => {
        ignorePickerSelectRef.current = false;
      }, 0);
    }
  };

  useEffect(() => {
    if (!inputRef.current || !containerRef.current) return;

    const picker = new AirDatepicker(inputRef.current, {
      container: containerRef.current,
      timepicker: true,
      onlyTimepicker: true,
      locale: hour12 ? localeEn : { ...localeEn, timeFormat: "HH:mm" },
      timeFormat: hour12 ? "hh:mm aa" : "HH:mm",
      autoClose: false,
      isMobile: false,
      keyboardNav: false,
      minutesStep: minutesStep > 1 ? minutesStep : 1,
      showEvent: OPEN_PICKER_EVENT,
      ...(showNow
        ? {
            buttons: [
              {
                content: "Now",
                onClick: (instance: AirDatepicker) => {
                  const now = new Date();
                  debugTimePicker("Now button", ariaLabel, {
                    source: "browser new Date()",
                    local: now.toString(),
                  });
                  ignorePickerSelectRef.current = false;
                  instance.selectDate(now);
                },
              },
            ],
          }
        : {}),
      onShow: (isFinished) => {
        if (!isFinished) return;
        pickerOpenRef.current = true;
        const step = minutesStepRef.current;
        const seed =
          parseClockTime(valueRef.current, step) || parseClockTime(inputRef.current?.value || "", step);
        const next = seed || fromDate(new Date(), step);
        ignorePickerSelectRef.current = true;
        if (!picker.selectedDates.length || (seed && fromDate(picker.selectedDates[0], step) !== seed)) {
          picker.selectDate(toDate(next), { silent: true });
        }
        if (inputRef.current && seed) writeInputDisplay(seed);
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
        const next = fromDate(selected, minutesStepRef.current);
        writeInputDisplay(next);
        onChangeRef.current(next);
      },
    });
    pickerRef.current = picker;
    inputRef.current.removeAttribute("readonly");
    if (valueRef.current) {
      const normalized = parseClockTime(valueRef.current, minutesStep);
      if (normalized) writeInputDisplay(normalized);
    }

    return () => {
      picker.destroy();
      pickerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, hour12, minutesStep, showNow]);

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
      if (pickerOpenRef.current && !insideField) {
        commitTypedValue(inputRef.current?.value || "", true);
      }
    };
    const onPointerUp = () => {
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

    const normalized = parseClockTime(value, minutesStep);
    if (!normalized) {
      if (picker.selectedDates.length) picker.clear({ silent: true });
      if (input.value !== "") input.value = "";
      return;
    }

    const selected = picker.selectedDates[0];
    if (!selected || fromDate(selected, minutesStep) !== normalized) {
      ignorePickerSelectRef.current = true;
      picker.selectDate(toDate(normalized), { silent: true });
      ignorePickerSelectRef.current = false;
    }
    const display = hour12 ? formatClockFace(normalized) : formatClockDisplay(normalized, false);
    if (input.value !== display) input.value = display;
  }, [hour12, minutesStep, value]);

  const openPicker = () => {
    const input = inputRef.current;
    const picker = pickerRef.current;
    if (!input || !picker) return;
    input.removeAttribute("readonly");
    const seed = normalizeTyped(input.value) || parseClockTime(valueRef.current, minutesStep);
    if (seed) {
      ignorePickerSelectRef.current = true;
      picker.selectDate(toDate(seed), { silent: true });
      writeInputDisplay(seed);
      window.setTimeout(() => {
        ignorePickerSelectRef.current = false;
      }, 0);
    }
    input.focus({ preventScroll: true });
    input.dispatchEvent(new Event(OPEN_PICKER_EVENT));
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <div className="relative w-full min-w-[7.5rem]">
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
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          placeholder={resolvedPlaceholder}
          defaultValue={
            hour12
              ? formatClockFace(parseClockTime(value, minutesStep))
              : formatClockDisplay(parseClockTime(value, minutesStep), false)
          }
          onFocus={() => {
            focusedRef.current = true;
            inputRef.current?.removeAttribute("readonly");
          }}
          onChange={(event) => {
            const raw = event.target.value;
            if (looksComplete(raw, hour12)) {
              const normalized = normalizeTyped(raw);
              if (normalized) onChange(normalized);
            }
          }}
          onBlur={() => {
            focusedRef.current = false;
            window.setTimeout(() => {
              if (pointerInPickerRef.current || pickerOpenRef.current) return;
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
            "w-full min-w-0 cursor-text rounded-md border border-input bg-background pl-9 text-foreground shadow-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            hour12 ? "pr-[4.75rem]" : "pr-3",
            isLarge ? "h-10 text-sm" : "h-8 text-xs",
            className
          )}
        />
        {hour12 ? (
          <div
            className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 overflow-hidden rounded-md border border-input bg-muted/50 p-0.5"
            role="group"
            aria-label={`${ariaLabel || "Time"} AM/PM`}
          >
            {(["AM", "PM"] as DayPeriod[]).map((period) => {
              const selected = activePeriod === period;
              return (
                <button
                  key={period}
                  type="button"
                  className={mergeClassNames(
                    "rounded-sm px-1.5 text-[10px] font-semibold leading-5 transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPeriod(period)}
                >
                  {period}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};
