import type { ResourceAllocationEmployeeProps, ResourceAllocationTimeLineProps } from "./types";

export type EmployeeDayUtilization = {
  date: string;
  allocatedHours: number;
  capacityHours: number;
  utilization: number;
  hasConflict: boolean;
};

const eachDayBetween = (startTime: number, endTime: number) => {
  const days: string[] = [];
  const cursor = new Date(startTime);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endTime);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
};

export const buildEmployeeConflictDays = (
  employees: ResourceAllocationEmployeeProps[],
  allocations: ResourceAllocationTimeLineProps[]
) => {
  const employeeCapacity = Object.fromEntries(
    employees.map((employee) => [employee.name, employee.daily_working_hours ?? 8])
  );

  const byEmployeeDate: Record<string, Record<string, number>> = {};

  allocations
    .filter((item) => item.type === "allocation")
    .forEach((allocation) => {
      const days = eachDayBetween(allocation.start_time, allocation.end_time - 1);
      days.forEach((date) => {
        if (!byEmployeeDate[allocation.employee]) {
          byEmployeeDate[allocation.employee] = {};
        }
        byEmployeeDate[allocation.employee][date] =
          (byEmployeeDate[allocation.employee][date] ?? 0) + (allocation.hours_allocated_per_day || 0);
      });
    });

  const heatMap: Record<string, EmployeeDayUtilization[]> = {};

  Object.entries(byEmployeeDate).forEach(([employee, dateMap]) => {
    const capacity = employeeCapacity[employee] ?? 8;
    heatMap[employee] = Object.entries(dateMap).map(([date, allocatedHours]) => {
      const utilization = capacity > 0 ? allocatedHours / capacity : allocatedHours > 0 ? 2 : 0;
      return {
        date,
        allocatedHours,
        capacityHours: capacity,
        utilization,
        hasConflict: allocatedHours > capacity || (capacity <= 0 && allocatedHours > 0),
      };
    });
  });

  return heatMap;
};

export const getConflictHeatOpacity = (utilization: number) => {
  if (utilization > 1) return 0.45;
  if (utilization >= 0.85) return 0.3;
  if (utilization >= 0.65) return 0.2;
  return 0;
};

export const getConflictHeatColor = (utilization: number) => {
  if (utilization > 1) return "rgb(239 68 68)";
  if (utilization >= 0.85) return "rgb(251 146 60)";
  return "rgb(250 204 21)";
};
