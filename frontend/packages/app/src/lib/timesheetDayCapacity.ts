import { getDateFromDateAndTimeString } from "@next-pms/design-system/date";

import type { TaskProps } from "@/types/timesheet";

export const MAX_HOURS_PER_DAY = 24;

export const DAY_FULLY_BOOKED_MESSAGE =
  "Day fully booked (24:00 logged on other tasks). Edit another task first or choose a different day.";

export function getDayTotalsFromTasks(tasks: TaskProps, dates: string[]): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const date of dates) {
    totals[date] = Object.values(tasks).reduce((total, taskData) => {
      const taskHours = taskData.data
        .filter((entry) => getDateFromDateAndTimeString(entry.from_time) === date)
        .reduce((sum, item) => sum + (item.hours || 0), 0);
      return total + taskHours;
    }, 0);
  }

  return totals;
}

export function isDayFullyBooked(dayTotalHours: number): boolean {
  return dayTotalHours >= MAX_HOURS_PER_DAY;
}
