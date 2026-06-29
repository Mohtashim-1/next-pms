/**
 * External dependencies
 */
import { TableCell, TableRow, Typography } from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";

/**
 * Internal dependencies
 */
import { calculateDayCapacityUsed } from "@/lib/timesheetDayTotals";
import { expectatedHours, getTimesheetColumnBg, mergeClassNames } from "@/lib/utils";
import type { TotalHourRowProps } from "./types";

export const RemainingHourRow = ({
  leaves,
  dates,
  tasks,
  holidays,
  workingHour,
  workingFrequency,
}: TotalHourRowProps) => {
  const dailyWorkingHours = expectatedHours(workingHour, workingFrequency);

  return (
    <TableRow className="bg-muted/20">
      <TableCell className="max-w-sm">
        <Typography variant="p" className="text-muted-foreground font-medium">
          Remaining
        </Typography>
      </TableCell>
      {dates.map((date) => {
        const holiday = holidays.find((item) => item.holiday_date === date);
        if (holiday?.weekly_off) {
          return (
            <TableCell
              key={date}
              className={mergeClassNames("text-center px-2", getTimesheetColumnBg(date, holidays))}
            >
              <Typography variant="p" className="text-muted-foreground/50">
                —
              </Typography>
            </TableCell>
          );
        }

        const usedHours = calculateDayCapacityUsed(tasks, leaves, date, dailyWorkingHours, holiday);
        const remaining = dailyWorkingHours - usedHours;
        const isExtended = remaining < 0;

        return (
          <TableCell
            key={date}
            className={mergeClassNames("text-center px-2", getTimesheetColumnBg(date, holidays))}
          >
            <Typography
              variant="p"
              className={mergeClassNames(
                isExtended ? "text-destructive" : remaining > 0 ? "text-success" : "text-muted-foreground"
              )}
            >
              {floatToTime(Math.abs(remaining))}
              {isExtended ? "+" : ""}
            </Typography>
          </TableCell>
        );
      })}
      <TableCell />
    </TableRow>
  );
};
