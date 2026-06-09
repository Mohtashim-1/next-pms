/**
 * External dependencies
 */
import { TableCell, TableRow, Typography } from "@next-pms/design-system/components";
import { getDateFromDateAndTimeString } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { Clock } from "lucide-react";
/**
 * Internal dependencies
 */
import { BillableIndicator } from "@/app/components/timesheet-billable/billableIndicator";
import { isDayFullyBooked } from "@/lib/timesheetDayCapacity";
import { isDatePeriodLocked } from "@/lib/timesheetPeriodLock";
import { mergeClassNames } from "@/lib/utils";
import type { TaskDataItemProps, TaskDataProps } from "@/types/timesheet";
import { GridCell } from "../gridCell";
import { TaskHoverCard } from "../taskHoverCard";
import type { RowProps } from "./types";

const Row = ({
  dates,
  tasks,
  holidays,
  onCellClick,
  disabled,
  likedTaskData,
  getLikedTaskData,
  setSelectedTask,
  setIsTaskLogDialogBoxOpen,
  rowClassName,
  taskCellClassName,
  cellClassName,
  totalCellClassName,
  showEmptyCell,
  hideLikeButton,
  runningTimer,
  runningTimerDate,
  runningTimerElapsed,
  gridRow: rowOffset = 0,
  enableInlineEdit,
  employee,
  onSaved,
  isFocused,
  isEditing,
  onFocusCell,
  onStartEditing,
  onStopEditing,
  onMoveFocus,
  periodLocks = [],
  dayTotals = {},
}: RowProps) => {
  return (
    <>
      {Object.keys(tasks).length > 0 &&
        Object.entries(tasks).map(([task, taskData]: [string, TaskDataProps], rowIndex: number) => {
          const gridRow = rowOffset + rowIndex;
          const isRunningTask = runningTimer?.task === taskData.name;
          let totalHours = 0;
          return (
            <TableRow key={task} className={mergeClassNames("border-b ", rowClassName)}>
              <TableCell className={mergeClassNames("cursor-pointer max-w-sm", taskCellClassName)}>
                <TaskHoverCard
                  name={task}
                  hideLikeButton={hideLikeButton}
                  taskData={taskData}
                  setSelectedTask={setSelectedTask}
                  setIsTaskLogDialogBoxOpen={setIsTaskLogDialogBoxOpen}
                  likedTaskData={likedTaskData as TaskDataProps[]}
                  getLikedTaskData={getLikedTaskData ?? (() => {})}
                />
                {isRunningTask && (
                  <div className="mt-1 flex items-center gap-1 text-xs font-medium text-success">
                    <Clock className="h-3 w-3" />
                    Running {runningTimerElapsed}
                  </div>
                )}
              </TableCell>
              {dates.map((date: string, colIndex: number) => {
                let data = taskData.data.filter(
                  (data: TaskDataItemProps) => getDateFromDateAndTimeString(data.from_time) === date
                );
                data.forEach((item: TaskDataItemProps) => {
                  totalHours += item.hours;
                });

                if (data.length === 0) {
                  data = [
                    {
                      hours: 0,
                      description: "",
                      name: "",
                      parent: "",
                      task: taskData.name,
                      from_time: date,
                      input_mode: "duration",
                      docstatus: 0,
                      project: taskData.project,
                      is_billable: false,
                    },
                  ];
                }
                const matchingHoliday = holidays.find((item) => item.holiday_date === date);

                const result = matchingHoliday
                  ? { isHoliday: true, weekly_off: matchingHoliday.weekly_off }
                  : { isHoliday: false, weekly_off: false };
                const cellHours = data.reduce((sum, item) => sum + (item.hours || 0), 0);
                const dayFullyBooked = cellHours === 0 && isDayFullyBooked(dayTotals[date] ?? 0);
                return (
                  <GridCell
                    key={date}
                    className={cellClassName}
                    date={date}
                    data={data}
                    isHoliday={result.isHoliday && !result.weekly_off}
                    onCellClick={onCellClick}
                    disabled={disabled || isDatePeriodLocked(date, periodLocks)}
                    dayFullyBooked={dayFullyBooked}
                    runningTimerElapsed={
                      isRunningTask && runningTimerDate === date ? runningTimerElapsed : undefined
                    }
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
              <TableCell className={mergeClassNames("text-center", totalCellClassName)}>
                <Typography
                  variant="p"
                  className="font-medium text-right flex justify-between items-center gap-1"
                >
                  <BillableIndicator
                    projectDefault={taskData.project_default_is_billable ?? taskData.is_billable}
                    compact
                  />
                  {floatToTime(totalHours)}
                </Typography>
              </TableCell>
              {showEmptyCell && (
                <TableCell className={mergeClassNames("flex max-w-20 w-full justify-center items-center")}></TableCell>
              )}
            </TableRow>
          );
        })}
    </>
  );
};

export { Row };
