import moment from "moment";

import type { ResourceAllocationTimeLineFilterProps } from "./types";

export type TimelineZoomLevel = "day" | "week" | "month" | "quarter";
export type TimelineColorMode = "project" | "status" | "skill";

export type TimelineZoomConfig = {
  level: TimelineZoomLevel;
  visibleDurationMs: number;
  minZoomMs: number;
  maxZoomMs: number;
  apiMaxWeek: number;
  isCompactItemLabels: boolean;
};

const durationMs = (amount: number, unit: moment.unitOfTime.DurationConstructor) =>
  moment.duration(amount, unit).asMilliseconds();

export const normalizeZoomLevel = (filters: ResourceAllocationTimeLineFilterProps): TimelineZoomLevel => {
  if (filters.zoomLevel) {
    return filters.zoomLevel;
  }
  return filters.isShowMonth ? "month" : "week";
};

export const normalizeColorMode = (filters: ResourceAllocationTimeLineFilterProps): TimelineColorMode =>
  filters.colorMode ?? "project";

export const getTimelineZoomConfig = (level: TimelineZoomLevel): TimelineZoomConfig => {
  switch (level) {
    case "day":
      return {
        level,
        visibleDurationMs: durationMs(14, "days"),
        minZoomMs: durationMs(7, "days"),
        maxZoomMs: durationMs(21, "days"),
        apiMaxWeek: 3,
        isCompactItemLabels: false,
      };
    case "week":
      return {
        level,
        visibleDurationMs: durationMs(6, "weeks"),
        minZoomMs: durationMs(4, "weeks"),
        maxZoomMs: durationMs(10, "weeks"),
        apiMaxWeek: 8,
        isCompactItemLabels: false,
      };
    case "month":
      return {
        level,
        visibleDurationMs: durationMs(3, "months"),
        minZoomMs: durationMs(2, "months"),
        maxZoomMs: durationMs(4, "months"),
        apiMaxWeek: 14,
        isCompactItemLabels: true,
      };
    case "quarter":
      return {
        level,
        visibleDurationMs: durationMs(12, "months"),
        minZoomMs: durationMs(9, "months"),
        maxZoomMs: durationMs(15, "months"),
        apiMaxWeek: 54,
        isCompactItemLabels: true,
      };
    default:
      return getTimelineZoomConfig("week");
  }
};

export const isWideZoom = (level: TimelineZoomLevel) => level === "month" || level === "quarter";
