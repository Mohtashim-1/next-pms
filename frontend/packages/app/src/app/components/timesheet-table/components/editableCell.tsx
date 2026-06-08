/**
 * External dependencies
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  TableCell,
  TextEditor,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";
import { useFrappePostCall } from "frappe-react-sdk";
import { CircleDollarSign, CirclePlus, PencilLine } from "lucide-react";

/**
 * Internal dependencies
 */
import { DEFAULT_INLINE_DESCRIPTION, formatRangeLabel, isRangeEntry } from "@/lib/timesheetTime";
import { mergeClassNames, getBgCsssForToday, parseFrappeErrorMsg } from "@/lib/utils";
import { timeStringToFloat } from "@/schema/timesheet";
import type { cellProps } from "./types";

type EditableCellProps = cellProps & {
  employee: string;
  gridRow: number;
  gridCol: number;
  isFocused: boolean;
  isEditing: boolean;
  onFocusCell: (row: number, col: number) => void;
  onStartEditing: (row: number, col: number) => void;
  onStopEditing: () => void;
  onMoveFocus?: (rowDelta: number, colDelta: number) => void;
  onSaved?: () => void;
};

export const EditableCell = ({
  date,
  data,
  isHoliday,
  onCellClick,
  disabled,
  className,
  employee,
  gridRow,
  gridCol,
  isFocused,
  isEditing,
  onFocusCell,
  onStartEditing,
  onStopEditing,
  onMoveFocus,
  onSaved,
}: EditableCellProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { call: updateTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.update_timesheet_detail");
  const { call: saveTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.save");

  const realEntries = useMemo(() => (data ?? []).filter((item) => item.name), [data]);
  const primaryEntry = realEntries[0];
  const hasMultipleEntries = realEntries.length > 1;

  const { hours, description, isTimeBothBillableAndNonBillable, isTimeBillable, rangeLabel } = useMemo(() => {
    let totalHours = 0;
    let desc = "";
    let billableMixed = false;
    let billable = false;

    if (data) {
      totalHours = data.reduce((sum, item) => sum + (item.hours || 0), 0);
      desc = data.reduce((acc, item) => acc + (item.description ? item.description + "\n" : ""), "").trim();
      billableMixed =
        data.some((item) => item.is_billable === false || item.is_billable === 0) &&
        data.some((item) => item.is_billable === true || item.is_billable === 1);
      billable = data.every((item) => item.is_billable === true || item.is_billable === 1);
    }

    const label = primaryEntry ? formatRangeLabel(primaryEntry.from_time, primaryEntry.to_time) : "";

    return {
      hours: totalHours,
      description: desc,
      isTimeBothBillableAndNonBillable: billableMixed,
      isTimeBillable: billable,
      rangeLabel: label,
    };
  }, [data, primaryEntry]);

  const [draftHours, setDraftHours] = useState(floatToTime(hours));
  const isDisabled = useMemo(() => disabled || data?.[0]?.docstatus === 1, [disabled, data]);

  useEffect(() => {
    if (!isEditing) {
      setDraftHours(floatToTime(hours));
    }
  }, [hours, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const taskName = data?.[0]?.task ?? primaryEntry?.task;

  const openDetailDialog = useCallback(() => {
    if (isDisabled) return;
    const value = {
      date,
      hours,
      description: primaryEntry?.description ?? "",
      name: primaryEntry?.name ?? "",
      task: data?.[0]?.task ?? "",
      project: data?.[0]?.project ?? "",
    };
    onCellClick?.(value);
  }, [isDisabled, date, hours, primaryEntry, data, onCellClick]);

  const persistHours = useCallback(
    async (navigate?: { rowDelta: number; colDelta: number }) => {
      const parsedHours = timeStringToFloat(draftHours);
      if (Number.isNaN(parsedHours) || parsedHours <= 0) {
        setDraftHours(floatToTime(hours));
        onStopEditing();
        if (navigate) onMoveFocus?.(navigate.rowDelta, navigate.colDelta);
        return;
      }

      if (timeStringToFloat(floatToTime(hours)) === parsedHours) {
        onStopEditing();
        if (navigate) onMoveFocus?.(navigate.rowDelta, navigate.colDelta);
        return;
      }

      if (!taskName) {
        onStopEditing();
        openDetailDialog();
        return;
      }

      try {
        if (primaryEntry?.name && primaryEntry.parent) {
          await updateTimesheet({
            name: primaryEntry.name,
            parent: primaryEntry.parent,
            hours: parsedHours,
            description: primaryEntry.description || DEFAULT_INLINE_DESCRIPTION,
            task: taskName,
            date,
            input_mode: "duration",
          });
        } else {
          await saveTimesheet({
            date,
            description: DEFAULT_INLINE_DESCRIPTION,
            task: taskName,
            hours: parsedHours,
            employee,
            input_mode: "duration",
          });
        }
        onSaved?.();
      } catch (err) {
        const error = parseFrappeErrorMsg(err as Error);
        toast({ variant: "destructive", description: error });
        setDraftHours(floatToTime(hours));
      } finally {
        onStopEditing();
        if (navigate) onMoveFocus?.(navigate.rowDelta, navigate.colDelta);
      }
    },
    [
      draftHours,
      hours,
      primaryEntry,
      taskName,
      date,
      employee,
      openDetailDialog,
      updateTimesheet,
      saveTimesheet,
      onSaved,
      onStopEditing,
      onMoveFocus,
      toast,
    ]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void persistHours({ rowDelta: 0, colDelta: 1 });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraftHours(floatToTime(hours));
      onStopEditing();
    }
    if (event.key === "Tab") {
      event.preventDefault();
      void persistHours({ rowDelta: 0, colDelta: event.shiftKey ? -1 : 1 });
    }
  };

  const handleCellClick = () => {
    if (isDisabled) return;
    onFocusCell(gridRow, gridCol);
    if (!taskName || hasMultipleEntries || isRangeEntry(primaryEntry?.from_time, primaryEntry?.to_time)) {
      openDetailDialog();
      return;
    }
    onStartEditing(gridRow, gridCol);
  };

  const handleCellKeyDown = (event: React.KeyboardEvent<HTMLTableCellElement>) => {
    if (isDisabled || isEditing) return;

    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        onMoveFocus?.(0, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        onMoveFocus?.(0, -1);
        break;
      case "ArrowDown":
        event.preventDefault();
        onMoveFocus?.(1, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        onMoveFocus?.(-1, 0);
        break;
      case "Tab":
        event.preventDefault();
        onMoveFocus?.(0, event.shiftKey ? -1 : 1);
        break;
      case "Enter":
        event.preventDefault();
        handleCellClick();
        break;
      default:
        if (/^[0-9.:]$/.test(event.key) && taskName && !hasMultipleEntries) {
          event.preventDefault();
          onStartEditing(gridRow, gridCol);
          setDraftHours(event.key);
        }
        break;
    }
  };

  const displayValue = hours > 0 ? (rangeLabel || floatToTime(hours)) : "-";

  return (
    <HoverCard openDelay={500} closeDelay={500}>
      <TableCell
        key={date}
        tabIndex={isDisabled ? -1 : isFocused ? 0 : -1}
        data-grid-row={gridRow}
        data-grid-col={gridCol}
        onClick={handleCellClick}
        onFocus={() => {
          if (!isFocused) {
            onFocusCell(gridRow, gridCol);
          }
        }}
        onKeyDown={handleCellKeyDown}
        className={mergeClassNames(
          "text-center group px-2 outline-none",
          isDisabled && "cursor-default",
          !isDisabled && "hover:bg-muted/60 dark:hover:bg-muted/40 hover:cursor-pointer",
          isFocused && !isDisabled && "ring-2 ring-primary ring-inset",
          getBgCsssForToday(date),
          className
        )}
      >
        <HoverCardTrigger className={mergeClassNames(isDisabled && "cursor-default")}>
          {isEditing && !hasMultipleEntries ? (
            <Input
              ref={inputRef}
              value={draftHours}
              onChange={(event) => setDraftHours(event.target.value)}
              onBlur={() => void persistHours()}
              onKeyDown={handleKeyDown}
              className="h-8 px-1 text-center"
              placeholder="00:00"
            />
          ) : (
            <span className="flex flex-col items-center justify-center ">
              <Typography
                variant="p"
                className={mergeClassNames(
                  isHoliday || (isDisabled && "text-slate-400 dark:text-muted-foreground/60"),
                  !hours && !isDisabled && "group-hover:hidden"
                )}
              >
                {displayValue}
              </Typography>
              {(isTimeBothBillableAndNonBillable || isTimeBillable) && (
                <CircleDollarSign
                  className={mergeClassNames(!isDisabled && "group-hover:hidden", isTimeBillable && "stroke-success")}
                />
              )}
              <PencilLine
                className={mergeClassNames("text-center hidden", hours > 0 && !isDisabled && "group-hover:block")}
                size={16}
              />
              <CirclePlus
                className={mergeClassNames("text-center hidden", !hours && !isDisabled && "group-hover:block ")}
                size={16}
              />
            </span>
          )}
        </HoverCardTrigger>
        {description && (
          <HoverCardContent
            className="text-left whitespace-pre text-wrap w-full max-w-96 max-h-52 overflow-auto hover-content p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <TextEditor onChange={() => {}} hideToolbar={true} readOnly={true} value={description} />
          </HoverCardContent>
        )}
      </TableCell>
    </HoverCard>
  );
};
