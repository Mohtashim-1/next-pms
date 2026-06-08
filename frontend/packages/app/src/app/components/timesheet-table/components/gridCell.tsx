/**
 * Internal dependencies
 */
import type { TaskDataItemProps } from "@/types/timesheet";
import { Cell } from "./dataCell";
import { EditableCell } from "./editableCell";
import type { cellProps } from "./types";
import type { GridCellBindings } from "./row/types";

type GridCellProps = cellProps &
  GridCellBindings & {
    gridCol: number;
  };

export const GridCell = ({
  date,
  data,
  isHoliday,
  onCellClick,
  disabled,
  className,
  gridRow,
  gridCol,
  enableInlineEdit,
  employee,
  onSaved,
  isFocused,
  isEditing,
  onFocusCell,
  onStartEditing,
  onStopEditing,
  onMoveFocus,
}: GridCellProps) => {
  if (enableInlineEdit && employee && gridRow !== undefined) {
    return (
      <EditableCell
        date={date}
        data={data as TaskDataItemProps[]}
        isHoliday={isHoliday}
        onCellClick={onCellClick}
        disabled={disabled}
        className={className}
        employee={employee}
        gridRow={gridRow}
        gridCol={gridCol}
        isFocused={isFocused?.(gridRow, gridCol) ?? false}
        isEditing={isEditing?.(gridRow, gridCol) ?? false}
        onFocusCell={onFocusCell ?? (() => {})}
        onStartEditing={onStartEditing ?? (() => {})}
        onStopEditing={onStopEditing ?? (() => {})}
        onMoveFocus={onMoveFocus}
        onSaved={onSaved}
      />
    );
  }

  return (
    <Cell
      date={date}
      data={data}
      isHoliday={isHoliday}
      onCellClick={onCellClick}
      disabled={disabled}
      className={className}
    />
  );
};
