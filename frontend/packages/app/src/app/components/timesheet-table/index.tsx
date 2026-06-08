/**
 * External dependencies
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorFallback, Table, TableBody, Typography } from "@next-pms/design-system/components";
/**
 * Internal dependencies
 */
import { TaskLog } from "@/app/pages/task/components/taskLog";
import { LIKED_TASK_KEY } from "@/lib/constant";
import { getLocalStorage, hasKeyInLocalStorage, removeFromLikedTask, setLikedTask } from "@/lib/storage";
import { expectatedHours, getHolidayList } from "@/lib/utils";
import { TaskDataProps } from "@/types/timesheet";
import { Header } from "./components/header";
import { Row } from "./components/row";
import { EmptyRow } from "./components/row/emptyRow";
import { LeaveRow } from "./components/row/leaveRow";
import { TotalHourRow } from "./components/row/totalRow";
import type { timesheetTableProps } from "./components/types";
import { useGridNavigation } from "./hooks/useGridNavigation";

export const TimesheetTable = ({
  dates,
  holidays,
  tasks,
  leaves,
  onCellClick,
  showHeading = true,
  workingHour,
  workingFrequency,
  disabled,
  weeklyStatus,
  importTasks = false,
  loadingLikedTasks,
  likedTaskData,
  getLikedTaskData,
  hideLikeButton,
  employee,
  onSaved,
  enableInlineEdit = true,
}: timesheetTableProps) => {
  const holidayList = getHolidayList(holidays);
  const [isTaskLogDialogBoxOpen, setIsTaskLogDialogBoxOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string>("");
  const task_date_range_key = dates[0] + "-" + dates[dates.length - 1];
  const has_liked_task = hasKeyInLocalStorage(LIKED_TASK_KEY);
  const isWeekLocked = ["Approval Pending", "Processing Timesheet", "Approved", "Partially Approved"].includes(
    weeklyStatus ?? ""
  );

  const setTaskInLocalStorage = () => {
    setLikedTask(LIKED_TASK_KEY, task_date_range_key, likedTaskData!);
    setFilteredLikedTasks(
      likedTaskData?.filter((likedTask: { name: string }) => !Object.keys(tasks).includes(likedTask.name))
    );
  };

  const liked_tasks = has_liked_task ? getLocalStorage(LIKED_TASK_KEY)[task_date_range_key] ?? [] : [];

  const [filteredLikedTasks, setFilteredLikedTasks] = useState(
    liked_tasks.filter((likedTask: { name: string }) => !Object.keys(tasks).includes(likedTask.name))
  );
  useEffect(() => {
    const filteredLikedTasks = liked_tasks.filter(
      (likedTask: { name: string }) => !Object.keys(tasks).includes(likedTask.name)
    );
    setFilteredLikedTasks(filteredLikedTasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const deleteTaskFromLocalStorage = useCallback(() => {
    removeFromLikedTask(LIKED_TASK_KEY, task_date_range_key);
  }, [task_date_range_key]);

  useEffect(() => {
    if (isWeekLocked) {
      deleteTaskFromLocalStorage();
    }
  }, [deleteTaskFromLocalStorage, isWeekLocked]);

  const editableRowCount = useMemo(() => {
    let count = 0;
    if (!isWeekLocked) {
      count += 1;
      count += filteredLikedTasks.length;
    }
    count += Object.keys(tasks).length;
    return count;
  }, [filteredLikedTasks.length, isWeekLocked, tasks]);

  const gridRef = useRef<HTMLDivElement>(null);

  const {
    focusedCell,
    editingCell,
    handleContainerKeyDown,
    isFocused,
    isEditing,
    focusCell,
    startEditing,
    stopEditing,
    moveFocus,
  } = useGridNavigation({
    rowCount: editableRowCount,
    colCount: dates.length,
  });

  const gridBindings = {
    enableInlineEdit: enableInlineEdit && Boolean(employee) && !disabled,
    employee,
    onSaved,
    isFocused,
    isEditing,
    onFocusCell: focusCell,
    onStartEditing: startEditing,
    onStopEditing: stopEditing,
    onMoveFocus: moveFocus,
  };

  useEffect(() => {
    if (editingCell || !gridRef.current || editableRowCount === 0 || dates.length === 0) return;

    const cell = gridRef.current.querySelector<HTMLElement>(
      `[data-grid-row="${focusedCell.row}"][data-grid-col="${focusedCell.col}"]`
    );
    if (!cell || cell === document.activeElement) return;

    cell.focus();
  }, [focusedCell.row, focusedCell.col, editingCell, editableRowCount, dates.length]);

  let nextGridRow = 0;

  if (!dates?.length) {
    return null;
  }

  return (
    <ErrorFallback>
      {isTaskLogDialogBoxOpen && (
        <TaskLog task={selectedTask} isOpen={isTaskLogDialogBoxOpen} onOpenChange={setIsTaskLogDialogBoxOpen} />
      )}
      <div
        ref={gridRef}
        data-timesheet-grid
        tabIndex={-1}
        onKeyDown={handleContainerKeyDown}
        className="outline-none"
      >
      <Table>
        <Header
          showHeading={showHeading}
          dates={dates}
          importTasks={importTasks}
          holidays={holidays}
          loadingLikedTasks={loadingLikedTasks}
          setTaskInLocalStorage={setTaskInLocalStorage}
        />
        <TableBody>
          <TotalHourRow
            leaves={leaves}
            dates={dates}
            tasks={tasks}
            holidays={holidays}
            workingHour={workingHour}
            workingFrequency={workingFrequency}
          />
          <LeaveRow
            dates={dates}
            holidayList={holidayList}
            leaves={leaves}
            expectedHours={expectatedHours(workingHour, workingFrequency)}
          />

          {!isWeekLocked && (
            <EmptyRow
              dates={dates}
              holidayList={holidayList}
              onCellClick={onCellClick}
              setSelectedTask={setSelectedTask}
              disabled={disabled}
              setIsTaskLogDialogBoxOpen={setIsTaskLogDialogBoxOpen}
              likedTaskData={likedTaskData!}
              getLikedTaskData={getLikedTaskData}
              gridRow={nextGridRow++}
              {...gridBindings}
            />
          )}
          {!isWeekLocked &&
            filteredLikedTasks.length > 0 &&
            importTasks &&
            filteredLikedTasks.map((task: TaskDataProps) => {
              const gridRow = nextGridRow++;
              return (
                <EmptyRow
                  key={task.name}
                  dates={dates}
                  holidayList={holidayList}
                  onCellClick={onCellClick}
                  setSelectedTask={setSelectedTask}
                  disabled={disabled}
                  setIsTaskLogDialogBoxOpen={setIsTaskLogDialogBoxOpen}
                  name={task.name}
                  taskData={task}
                  likedTaskData={likedTaskData}
                  getLikedTaskData={getLikedTaskData}
                  gridRow={gridRow}
                  {...gridBindings}
                />
              );
            })}
          <Row
            dates={dates}
            tasks={tasks}
            holidays={holidays}
            onCellClick={onCellClick}
            disabled={disabled}
            likedTaskData={likedTaskData}
            getLikedTaskData={getLikedTaskData}
            setSelectedTask={setSelectedTask}
            setIsTaskLogDialogBoxOpen={setIsTaskLogDialogBoxOpen}
            workingFrequency={workingFrequency}
            workingHour={workingHour}
            hideLikeButton={hideLikeButton}
            gridRow={nextGridRow}
            {...gridBindings}
          />
        </TableBody>
      </Table>
      {gridBindings.enableInlineEdit && (
        <Typography variant="small" className="text-muted-foreground px-1 py-2">
          Arrow keys move between cells · Enter or type a digit to edit · Tab / Shift+Tab next cell · Esc cancel
        </Typography>
      )}
      </div>
    </ErrorFallback>
  );
};
