/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
import { Calendar, Typography } from "@next-pms/design-system/components";
import { getUTCDateTime } from "@next-pms/design-system/date";
import { format, isWithinInterval, parseISO, startOfMonth, endOfMonth } from "date-fns";

/**
 * Internal dependencies.
 */
import type { PersonalAllocation } from "../types";
import { AssignmentCard } from "./assignmentCard";

const overlapsDate = (allocation: PersonalAllocation, date: string) => {
  return (
    allocation.allocation_start_date <= date &&
    allocation.allocation_end_date >= date
  );
};

export const AssignmentCalendarView = ({
  allocations,
}: {
  allocations: PersonalAllocation[];
}) => {
  const [selectedDate, setSelectedDate] = useState<Date>(getUTCDateTime(new Date().toISOString().slice(0, 10)));

  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");

  const selectedDayAllocations = useMemo(
    () => allocations.filter((allocation) => overlapsDate(allocation, selectedDateKey)),
    [allocations, selectedDateKey]
  );

  const monthAllocations = useMemo(() => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    return allocations.filter((allocation) => {
      const start = parseISO(allocation.allocation_start_date);
      const end = parseISO(allocation.allocation_end_date);
      return (
        isWithinInterval(start, { start: monthStart, end: monthEnd }) ||
        isWithinInterval(end, { start: monthStart, end: monthEnd }) ||
        (start <= monthStart && end >= monthEnd)
      );
    });
  }, [allocations, selectedDate]);

  const eventDays = useMemo(() => {
    const days = new Set<string>();
    allocations.forEach((allocation) => {
      let cursor = parseISO(allocation.allocation_start_date);
      const end = parseISO(allocation.allocation_end_date);
      while (cursor <= end) {
        days.add(format(cursor, "yyyy-MM-dd"));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
    });
    return days;
  }, [allocations]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => date && setSelectedDate(date)}
          modifiers={{ assigned: Array.from(eventDays).map((day) => parseISO(day)) }}
          modifiersClassNames={{ assigned: "bg-primary/15 font-semibold" }}
          className="mx-auto"
        />
        <Typography variant="small" className="mt-3 text-center text-muted-foreground">
          Highlighted days have assignments
        </Typography>
      </div>

      <div className="space-y-4 min-w-0">
        <div>
          <Typography variant="h6">{format(selectedDate, "EEEE, MMM d, yyyy")}</Typography>
          <Typography variant="small" className="text-muted-foreground">
            {selectedDayAllocations.length} assignment(s) on this day
          </Typography>
        </div>

        {selectedDayAllocations.length === 0 ? (
          <Typography variant="p" className="text-sm text-muted-foreground">
            No assignments scheduled for this day.
          </Typography>
        ) : (
          <div className="grid gap-3">
            {selectedDayAllocations.map((allocation) => (
              <AssignmentCard key={allocation.name} allocation={allocation} highlightDue />
            ))}
          </div>
        )}

        <div className="space-y-3 pt-2 border-t">
          <Typography variant="p" className="font-medium">
            This Month
          </Typography>
          {monthAllocations.length === 0 ? (
            <Typography variant="small" className="text-muted-foreground">
              No assignments this month.
            </Typography>
          ) : (
            <div className="grid gap-3">
              {monthAllocations.map((allocation) => (
                <AssignmentCard key={`month-${allocation.name}`} allocation={allocation} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
