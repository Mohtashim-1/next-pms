import { getDateFromDateAndTimeString } from "@next-pms/design-system/date";

import type { HolidayProp, LeaveProps, TaskProps, timesheet } from "@/types/timesheet";
import { isWeekendDay, isWeeklyOff } from "@/lib/utils";

export const calculateTaskHoursForDate = (tasks: TaskProps, date: string) => {
  return Object.values(tasks).reduce((total, taskData) => {
    const taskHours = taskData.data
      .filter((entry) => getDateFromDateAndTimeString(entry.from_time) === date)
      .reduce((sum, item) => sum + item.hours, 0);
    return total + taskHours;
  }, 0);
};

export const calculateLeaveHoursForDate = (
  leaves: LeaveProps[],
  date: string,
  dailyWorkingHours: number,
  holiday?: HolidayProp
) => {
  return leaves.reduce((total, leave) => {
    if (date >= leave.from_date && date <= leave.to_date) {
      if (!leave.is_lwp && (holiday ? holiday.weekly_off : isWeekendDay(date))) {
        return 0;
      }
      if (leave.half_day && leave.half_day_date === date) {
        return total + dailyWorkingHours / 2;
      }
      return total + dailyWorkingHours;
    }
    return total;
  }, 0);
};

export const calculateDayCapacityUsed = (
  tasks: TaskProps,
  leaves: LeaveProps[],
  date: string,
  dailyWorkingHours: number,
  holiday?: HolidayProp
) => {
  return (
    calculateTaskHoursForDate(tasks, date) +
    calculateLeaveHoursForDate(leaves, date, dailyWorkingHours, holiday)
  );
};

export const findTimesheetWeekForDate = (
  weeks: Record<string, timesheet>,
  date: string
): timesheet | null => {
  for (const week of Object.values(weeks)) {
    if (week.dates?.includes(date)) {
      return week;
    }
  }
  return null;
};

export const getRemainingHoursForDate = (
  date: string,
  dailyNorm: number,
  tasks: TaskProps,
  leaves: LeaveProps[],
  holidays: HolidayProp[]
): number => {
  const holiday = holidays.find((item) => item.holiday_date === date);
  if (isWeeklyOff(date, holidays)) {
    return -calculateTaskHoursForDate(tasks, date);
  }

  return dailyNorm - calculateDayCapacityUsed(tasks, leaves, date, dailyNorm, holiday);
};
