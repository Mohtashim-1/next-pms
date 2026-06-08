import { getDateFromDateAndTimeString } from "@next-pms/design-system/date";

export type TimesheetInputMode = "duration" | "range";

export const DEFAULT_INLINE_DESCRIPTION = "-";

export const extractTimeFromDatetime = (value?: string): string => {
  if (!value) return "";
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = match[1].padStart(2, "0");
  const minute = match[2].padStart(2, "0");
  if (hour === "00" && minute === "00") return "";
  return `${hour}:${minute}`;
};

export const isRangeEntry = (fromTime?: string, toTime?: string): boolean => {
  const from = extractTimeFromDatetime(fromTime);
  const to = extractTimeFromDatetime(toTime);
  return Boolean(from || to);
};

export const getEntryDate = (fromTime?: string, fallbackDate?: string): string => {
  if (fromTime) {
    return getDateFromDateAndTimeString(fromTime);
  }
  return fallbackDate ?? "";
};

export const formatRangeLabel = (fromTime?: string, toTime?: string): string => {
  const from = extractTimeFromDatetime(fromTime);
  const to = extractTimeFromDatetime(toTime);
  if (!from && !to) return "";
  if (from && to) return `${from}–${to}`;
  return from || to;
};
