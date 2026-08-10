/**
 * Clock-time helpers for Start/End (12h AM/PM UI) and Duration (24h / decimal).
 * Form + API always store 24-hour `HH:mm`.
 */
import { floatToTime } from "@next-pms/design-system/utils";

import { formatTime } from "@/lib/utils";

export type DayPeriod = "AM" | "PM";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function snapMinutes(hours: number, minutes: number, step: number): { hours: number; minutes: number } {
  if (!step || step <= 1) return { hours, minutes };
  let total = hours * 60 + minutes;
  total = Math.round(total / step) * step;
  const max = 23 * 60 + (60 - step);
  if (total > max) total = max;
  if (total < 0) total = 0;
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Convert 24h HH:mm → 12h face without AM/PM (e.g. `9:00`). */
export function formatClockFace(hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  let hour12val = h % 12;
  if (hour12val === 0) hour12val = 12;
  return `${hour12val}:${pad2(m)}`;
}

/** Convert 24h HH:mm → display (12h with AM/PM when hour12). */
export function formatClockDisplay(hhmm: string, hour12: boolean): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  if (!hour12) return `${pad2(h)}:${pad2(m)}`;
  const period: DayPeriod = h >= 12 ? "PM" : "AM";
  return `${formatClockFace(hhmm)} ${period}`;
}

export function getDayPeriod(hhmm: string): DayPeriod | null {
  const normalized = parseClockTime(hhmm);
  if (!normalized) return null;
  const hours = Number(normalized.split(":")[0]);
  return hours >= 12 ? "PM" : "AM";
}

/** Flip / set AM↔PM while keeping the 1–12 hour face. */
export function withDayPeriod(hhmm: string, period: DayPeriod, fallbackFace = "09:00"): string {
  const base = parseClockTime(hhmm) || fallbackFace;
  const [h, m] = base.split(":").map(Number);
  const face = h % 12 || 12; // 1–12
  const nextHours = period === "AM" ? (face === 12 ? 0 : face) : face === 12 ? 12 : face + 12;
  return `${pad2(nextHours)}:${pad2(m)}`;
}

/**
 * Parse user/API input into 24h `HH:mm`.
 * Accepts: "13:30", "1:30 PM", "1:30pm", "1.5" (duration hours), "8".
 */
export function parseClockTime(raw: string, minutesStep = 1): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  const ampmMatch = /^(\d{1,2})(?::([0-5]?\d))?\s*(am|pm)$/i.exec(trimmed);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] != null ? parseInt(ampmMatch[2], 10) : 0;
    const period = ampmMatch[3].toLowerCase();
    if (hours < 1 || hours > 12 || Number.isNaN(minutes)) return "";
    if (period === "am") {
      if (hours === 12) hours = 0;
    } else if (hours !== 12) {
      hours += 12;
    }
    const snapped = snapMinutes(hours, minutes, minutesStep);
    return `${pad2(snapped.hours)}:${pad2(snapped.minutes)}`;
  }

  try {
    let time = trimmed;
    if (!time.includes(":")) {
      const numeric = Number(time);
      if (Number.isNaN(numeric)) return "";
      time = floatToTime(numeric, 2, 2);
    }
    const [hours, minutes] = formatTime(time).split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return "";
    const snapped = snapMinutes(hours, minutes, minutesStep);
    if (snapped.hours > 23) return minutesStep > 1 ? `23:${pad2(60 - minutesStep)}` : "23:59";
    return `${pad2(snapped.hours)}:${pad2(snapped.minutes)}`;
  } catch {
    return "";
  }
}

/** Friendly same-day range error that surfaces AM/PM mistakes. */
export function rangeOrderError(fromHhmm: string, toHhmm: string): string {
  const fromLabel = formatClockDisplay(fromHhmm, true);
  const toLabel = formatClockDisplay(toHhmm, true);
  return `${toLabel} is before ${fromLabel} on the same day. Check AM/PM (e.g. 9:00 AM – 10:00 AM).`;
}
