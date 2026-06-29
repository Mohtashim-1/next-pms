/**
 * External dependencies
 */
import { TableCell, TableRow, Typography } from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";

/**
 * Internal dependencies
 */
import { expectatedHours, mergeClassNames, getTimesheetColumnBg } from "@/lib/utils";
import { calculateLeaveHoursForDate, calculateTaskHoursForDate } from "@/lib/timesheetDayTotals";
import { WeekTotal } from "../weekTotal";
import type { TotalHourRowProps } from "./types";

/**
 * @description This component calculates the total working hours for the perticular
 * day including the leaves, holidays and tasks, and uses the `Cell` component to
 * show the total hours worked for the day.
 *
 * @param {Array} props.leaves - Array of leaves in the timesheet
 * @param {Array} props.dates - Array of dates in the timesheet
 * @param {Array} props.tasks - Array of tasks in the timesheet
 * @param {Array} props.holidays - Array of holidays in the timesheet
 * @param {number} props.workingHour - The working hours for the day
 * @param {WorkingFrequency} props.workingFrequency - The working frequency
 */

export const TotalHourRow = ({ leaves, dates, tasks, holidays, workingHour, workingFrequency }: TotalHourRowProps) => {
  let total = 0;
  const dailyWorkingHours = expectatedHours(workingHour, workingFrequency);

  return (
    <TableRow className="bg-muted/40 font-medium">
      <TableCell className="max-w-sm">
        <Typography variant="p" className="text-muted-foreground font-medium">
          Daily total
        </Typography>
      </TableCell>
      {dates.map((date) => {
        const holiday = holidays.find((holiday) => holiday.holiday_date === date);
        const totalHours =
          calculateTaskHoursForDate(tasks, date) +
          calculateLeaveHoursForDate(leaves, date, dailyWorkingHours, holiday);

        total += totalHours;

        if (holiday) {
          if (!holiday.weekly_off) {
            total += workingHour;
          }
          return (
            <TableCell
              key={date}
              className={mergeClassNames("text-center", getTimesheetColumnBg(date, holidays))}
            >
              <Typography
                variant="p"
                className={mergeClassNames(!holiday.weekly_off && "text-slate-400 dark:text-muted-foreground/60")}
              >
                {holiday.weekly_off ? floatToTime(totalHours) : floatToTime(workingHour)}
              </Typography>
            </TableCell>
          );
        }

        return (
          <TableCell key={date} className={mergeClassNames("text-center px-2", getTimesheetColumnBg(date, holidays))}>
            <Typography variant="p">{floatToTime(totalHours)}</Typography>
          </TableCell>
        );
      })}
      <WeekTotal total={total} expected_hour={workingHour} frequency={workingFrequency} />
    </TableRow>
  );
};
