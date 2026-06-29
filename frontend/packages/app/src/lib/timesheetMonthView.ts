import { getFormatedDate, getUTCDateTime } from "@next-pms/design-system/date";
import { endOfMonth, format, startOfMonth } from "date-fns";

const MANAGER_ROLES = new Set([
  "Timesheet Manager",
  "Projects Manager",
  "HR Manager",
  "System Manager",
  "Administrator",
]);

export type MonthBounds = {
  start: string;
  end: string;
};

export function isTimesheetManagerView(roles: string[] = []): boolean {
  return roles.some((role) => MANAGER_ROLES.has(role));
}

export function getCurrentMonthBounds(referenceDate = getUTCDateTime()): MonthBounds {
  return {
    start: getFormatedDate(startOfMonth(referenceDate)),
    end: getFormatedDate(endOfMonth(referenceDate)),
  };
}

export function getCurrentMonthLabel(referenceDate = getUTCDateTime()): string {
  return format(referenceDate, "MMMM yyyy");
}

export function weekOverlapsMonth(
  weekStart: string,
  weekEnd: string,
  month: MonthBounds = getCurrentMonthBounds()
): boolean {
  return weekEnd >= month.start && weekStart <= month.end;
}

/** Max weeks needed to cover any calendar month when loading in one request. */
export const MAX_WEEKS_PER_MONTH = 6;

export function filterTimesheetWeeksToMonth<T extends { start_date: string; end_date: string }>(
  weeks: Record<string, T>,
  month: MonthBounds = getCurrentMonthBounds()
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(weeks).filter(([, week]) =>
      weekOverlapsMonth(getFormatedDate(week.start_date), getFormatedDate(week.end_date), month)
    )
  );
}
