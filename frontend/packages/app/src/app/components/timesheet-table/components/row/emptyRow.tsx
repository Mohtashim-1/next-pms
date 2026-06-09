/**
 * External dependencies
 */
import { TableCell, TableRow } from "@next-pms/design-system/components";
import { Clock } from "lucide-react";

/**
 * Internal dependencies
 */
import { isDayFullyBooked } from "@/lib/timesheetDayCapacity";
import { isDatePeriodLocked } from "@/lib/timesheetPeriodLock";
import { mergeClassNames } from "@/lib/utils";
import type { TaskDataProps } from "@/types/timesheet";
import { GridCell } from "../gridCell";
import { TaskHoverCard } from "../taskHoverCard";
import type { emptyRowProps } from "./types";

/**
 * Empty Row
 * @description The component shows table row with empty cells in timesheet grid,
 * which onClick event opens the dialog box to add time.
 *
 * @param {Array} props.dates - Array of dates in the timesheet
 * @param {Array} props.holidays - Array of holidays in the timesheet
 * @param {Function} props.onCellClick - Function to call when the cell is clicked
 * @param {boolean} props.disabled - If the timesheet is disabled
 * @param {string} props.rowClassName - Class name for the row
 * @param {string} props.headingCellClassName - Class name for the heading cell
 * @param {string} props.totalCellClassName - Class name for the total cell
 * @param {string} props.cellClassName - Class name for the cell
 */
export const EmptyRow = ({
  dates,
  holidayList,
  onCellClick,
  disabled,
  rowClassName,
  headingCellClassName,
  totalCellClassName,
  cellClassName,
  setSelectedTask,
  setIsTaskLogDialogBoxOpen,
  taskData,
  name,
  likedTaskData,
  getLikedTaskData,
  runningTimer,
  runningTimerDate,
  runningTimerElapsed,
  gridRow = 0,
  enableInlineEdit,
  employee,
  onSaved,
  isFocused = () => false,
  isEditing = () => false,
  onFocusCell = () => {},
  onStartEditing = () => {},
  onStopEditing = () => {},
  onMoveFocus,
  periodLocks = [],
  dayTotals = {},
}: emptyRowProps) => {
  const isRunningTask = Boolean(taskData?.name && runningTimer?.task === taskData.name);

  return (
    <TableRow className={mergeClassNames(rowClassName)}>
      <TableCell className={mergeClassNames("max-w-sm", headingCellClassName)}>
        {name && (
          <TaskHoverCard
            taskData={taskData}
            name={name}
            setIsTaskLogDialogBoxOpen={setIsTaskLogDialogBoxOpen ?? (() => {})}
            setSelectedTask={setSelectedTask ?? (() => {})}
            likedTaskData={likedTaskData as TaskDataProps[]}
            getLikedTaskData={getLikedTaskData ?? (() => {})}
          />
        )}
        {isRunningTask && (
          <div className="mt-1 flex items-center gap-1 text-xs font-medium text-success">
            <Clock className="h-3 w-3" />
            Running {runningTimerElapsed}
          </div>
        )}
      </TableCell>
      {dates.map((date: string, colIndex: number) => {
        const isHoliday = holidayList.includes(date);
        const value = [
          {
            hours: 0,
            description: "",
            name: "",
            docstatus: 0 as 0 | 1,
            is_billable: false,
            from_time: date,
            input_mode: "duration" as const,
            task: taskData?.name ?? "",
            parent: "",
            project: taskData?.project ?? "",
          },
        ];
        return (
          <GridCell
            key={date}
            date={date}
            data={value}
            isHoliday={isHoliday}
            onCellClick={onCellClick}
            disabled={disabled || isDatePeriodLocked(date, periodLocks)}
            dayFullyBooked={isDayFullyBooked(dayTotals[date] ?? 0)}
            className={cellClassName}
            runningTimerElapsed={isRunningTask && runningTimerDate === date ? runningTimerElapsed : undefined}
            gridRow={gridRow}
            gridCol={colIndex}
            enableInlineEdit={enableInlineEdit}
            employee={employee}
            onSaved={onSaved}
            isFocused={isFocused}
            isEditing={isEditing}
            onFocusCell={onFocusCell}
            onStartEditing={onStartEditing}
            onStopEditing={onStopEditing}
            onMoveFocus={onMoveFocus}
          />
        );
      })}
      <TableCell className={mergeClassNames(totalCellClassName)}></TableCell>
    </TableRow>
  );
};
