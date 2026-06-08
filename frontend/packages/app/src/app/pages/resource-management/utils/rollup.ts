import { getMonthKey } from "@next-pms/design-system/date";

import type { AllocationDataProps, DateProps, EmployeeResourceObjectProps, EmployeeResourceProps } from "../store/types";
import type { RollupPeriod } from "../store/types";

export type RollupColumn = {
  key: string;
  label: string;
  dates: string[];
  weekKey?: string;
  weekIndex?: number;
  dateIndex?: number;
};

export const normalizeRollupPeriod = (
  rollupPeriod?: RollupPeriod,
  combineWeekHours?: boolean
): RollupPeriod => {
  if (rollupPeriod) {
    return rollupPeriod;
  }
  return combineWeekHours ? "week" : "day";
};

export const getRollupColumns = (dates: DateProps[], period: RollupPeriod): RollupColumn[] => {
  if (period === "week") {
    return dates.map((week) => ({
      key: week.key,
      label: week.key,
      dates: week.dates,
      weekKey: week.key,
    }));
  }

  if (period === "month") {
    const monthMap = new Map<string, string[]>();

    dates.forEach((week) => {
      week.dates.forEach((date) => {
        const monthKey = getMonthKey(date);
        const bucket = monthMap.get(monthKey) ?? [];
        bucket.push(date);
        monthMap.set(monthKey, bucket);
      });
    });

    return Array.from(monthMap.entries()).map(([monthKey, monthDates]) => ({
      key: monthKey,
      label: monthKey,
      dates: monthDates,
    }));
  }

  return dates.flatMap((week, weekIndex) =>
    week.dates.map((date, dateIndex) => ({
      key: date,
      label: date,
      dates: [date],
      weekKey: week.key,
      weekIndex,
      dateIndex,
    }))
  );
};

const emptyPeriodData = (date: string): EmployeeResourceProps => ({
  date,
  total_allocated_hours: 0,
  total_working_hours: 0,
  total_worked_hours: 0,
  employee_resource_allocation_for_given_date: [],
  is_on_leave: false,
  total_leave_hours: 0,
  total_allocation_count: 0,
});

export const aggregateEmployeePeriod = (
  allDatesData: EmployeeResourceObjectProps,
  dates: string[],
  dailyWorkingHours: number
): EmployeeResourceProps => {
  if (dates.length === 1) {
    return (
      allDatesData[dates[0]] ?? {
        ...emptyPeriodData(dates[0]),
        total_working_hours: dailyWorkingHours,
      }
    );
  }

  const allocationsByName = new Map<string, AllocationDataProps>();
  let totalAllocatedHours = 0;
  let totalWorkedHours = 0;
  let totalWorkingHours = 0;
  let totalLeaveHours = 0;
  let isOnLeave = false;

  dates.forEach((date) => {
    const dayData = allDatesData[date];
    if (!dayData) {
      totalWorkingHours += dailyWorkingHours;
      return;
    }

    totalAllocatedHours += dayData.total_allocated_hours;
    totalWorkedHours += dayData.total_worked_hours;
    totalWorkingHours += dayData.total_working_hours;
    totalLeaveHours += dayData.total_leave_hours;
    isOnLeave = isOnLeave || dayData.is_on_leave;

    dayData.employee_resource_allocation_for_given_date?.forEach((allocation) => {
      allocationsByName.set(allocation.name, allocation);
    });
  });

  return {
    date: dates[0],
    total_allocated_hours: totalAllocatedHours,
    total_worked_hours: totalWorkedHours,
    total_working_hours: totalWorkingHours,
    total_leave_hours: totalLeaveHours,
    is_on_leave: isOnLeave,
    total_allocation_count: allocationsByName.size,
    employee_resource_allocation_for_given_date: Array.from(allocationsByName.values()),
  };
};
