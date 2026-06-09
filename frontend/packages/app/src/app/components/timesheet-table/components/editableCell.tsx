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
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";
import { useFrappePostCall } from "frappe-react-sdk";
import { CirclePlus, PencilLine, Timer } from "lucide-react";

/**
 * Internal dependencies
 */
import { BillableIndicator } from "@/app/components/timesheet-billable/billableIndicator";
import { MarkdownContent } from "@/app/components/timesheet-description/markdownContent";
import { DAY_FULLY_BOOKED_MESSAGE } from "@/lib/timesheetDayCapacity";
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
  onStopEditing: (row?: number, col?: number) => void;
  onMoveFocus?: (rowDelta: number, colDelta: number) => void;
  onSaved?: () => void;
};

const debugInlineEdit = (event: string, details?: Record<string, unknown>) => {
  console.log(`[TimesheetInlineEdit] ${event}`, details ?? {});
};

export const EditableCell = ({
  date,
  data,
  isHoliday,
  onCellClick,
  disabled,
  dayFullyBooked = false,
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
  runningTimerElapsed,
}: EditableCellProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { call: updateTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.update_timesheet_detail");
  const { call: saveTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.save");

  const realEntries = useMemo(() => (data ?? []).filter((item) => item.name), [data]);
  const primaryEntry = realEntries[0];
  const hasMultipleEntries = realEntries.length > 1;

  const { hours, description, rangeLabel } = useMemo(() => {
    let totalHours = 0;
    let desc = "";

    if (data) {
      totalHours = data.reduce((sum, item) => sum + (item.hours || 0), 0);
      desc = data.reduce((acc, item) => acc + (item.description ? item.description + "\n" : ""), "").trim();
    }

    const label =
      primaryEntry?.input_mode === "range" ? formatRangeLabel(primaryEntry.from_time, primaryEntry.to_time) : "";

    return {
      hours: totalHours,
      description: desc,
      rangeLabel: label,
    };
  }, [data, primaryEntry]);

  const [draftHours, setDraftHours] = useState(floatToTime(hours));
  const [optimisticHours, setOptimisticHours] = useState<number | null>(null);
  const isDayFullyBookedEmpty = dayFullyBooked && hours === 0;
  const isDisabled = useMemo(
    () =>
      disabled ||
      data?.[0]?.docstatus === 1 ||
      Boolean(data?.[0]?.is_period_locked) ||
      isDayFullyBookedEmpty,
    [disabled, data, isDayFullyBookedEmpty]
  );
  const displayHours = optimisticHours ?? hours;

  useEffect(() => {
    if (
      optimisticHours !== null &&
      timeStringToFloat(floatToTime(hours)) === timeStringToFloat(floatToTime(optimisticHours))
    ) {
      setOptimisticHours(null);
      return;
    }

    if (!isEditing) {
      setDraftHours(floatToTime(displayHours));
    }
  }, [displayHours, hours, isEditing, optimisticHours]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const taskName = data?.[0]?.task ?? primaryEntry?.task;

  const openDetailDialog = useCallback(() => {
    if (isDisabled) return;
    debugInlineEdit("open detail dialog", {
      date,
      displayHours,
      gridRow,
      gridCol,
      taskName,
      primaryEntryName: primaryEntry?.name,
      parent: primaryEntry?.parent,
    });
    const value = {
      date,
      hours: displayHours,
      description: primaryEntry?.description ?? "",
      name: primaryEntry?.name ?? "",
      task: data?.[0]?.task ?? "",
      project: data?.[0]?.project ?? "",
    };
    onCellClick?.(value);
  }, [isDisabled, date, displayHours, gridRow, gridCol, taskName, primaryEntry, data, onCellClick]);

  const persistHours = useCallback(
    async (
      navigate?: { rowDelta: number; colDelta: number },
      keepEditing = false,
      nextDraftHours = draftHours
    ) => {
      const parsedHours = timeStringToFloat(nextDraftHours);
      debugInlineEdit("persist requested", {
        date,
        gridRow,
        gridCol,
        draftHours,
        nextDraftHours,
        parsedHours,
        currentHours: hours,
        displayHours,
        taskName,
        employee,
        primaryEntryName: primaryEntry?.name,
        parent: primaryEntry?.parent,
        keepEditing,
        navigate,
      });

      if (Number.isNaN(parsedHours) || parsedHours <= 0) {
        debugInlineEdit("persist skipped: invalid hours", {
          date,
          nextDraftHours,
          parsedHours,
        });
        setDraftHours(floatToTime(displayHours));
        if (!keepEditing) onStopEditing(gridRow, gridCol);
        if (navigate) onMoveFocus?.(navigate.rowDelta, navigate.colDelta);
        return;
      }

      if (timeStringToFloat(floatToTime(hours)) === parsedHours) {
        debugInlineEdit("persist skipped: unchanged hours", {
          date,
          parsedHours,
          currentHours: hours,
        });
        if (!keepEditing) onStopEditing(gridRow, gridCol);
        if (navigate) onMoveFocus?.(navigate.rowDelta, navigate.colDelta);
        return;
      }

      if (!taskName) {
        debugInlineEdit("persist skipped: missing task, opening dialog", {
          date,
          parsedHours,
          data,
        });
        if (!keepEditing) onStopEditing(gridRow, gridCol);
        openDetailDialog();
        return;
      }

      try {
        if (primaryEntry?.name && primaryEntry.parent) {
          const payload = {
            name: primaryEntry.name,
            parent: primaryEntry.parent,
            hours: parsedHours,
            description: primaryEntry.description || DEFAULT_INLINE_DESCRIPTION,
            task: taskName,
            date,
            input_mode: "duration",
          };
          debugInlineEdit("update payload", payload);
          const response = await updateTimesheet(payload);
          debugInlineEdit("update success", {
            response,
            payload,
          });
        } else {
          const payload = {
            date,
            description: DEFAULT_INLINE_DESCRIPTION,
            task: taskName,
            hours: parsedHours,
            employee,
            input_mode: "duration",
          };
          debugInlineEdit("save payload", payload);
          const response = await saveTimesheet(payload);
          debugInlineEdit("save success", {
            response,
            payload,
          });
        }
        setDraftHours(floatToTime(parsedHours));
        setOptimisticHours(parsedHours);
        onSaved?.();
      } catch (err) {
        const error = parseFrappeErrorMsg(err as Error);
        debugInlineEdit("persist failed", {
          parsedError: error,
          rawError: err,
          date,
          parsedHours,
          taskName,
          employee,
          primaryEntryName: primaryEntry?.name,
          parent: primaryEntry?.parent,
        });
        toast({ variant: "destructive", description: error });
        setOptimisticHours(null);
        setDraftHours(floatToTime(hours));
      } finally {
        debugInlineEdit("persist finished", {
          date,
          gridRow,
          gridCol,
          keepEditing,
          navigate,
        });
        if (!keepEditing) onStopEditing(gridRow, gridCol);
        if (navigate) onMoveFocus?.(navigate.rowDelta, navigate.colDelta);
      }
    },
    [
      draftHours,
      displayHours,
      hours,
      primaryEntry,
      data,
      taskName,
      date,
      employee,
      gridRow,
      gridCol,
      openDetailDialog,
      updateTimesheet,
      saveTimesheet,
      onSaved,
      onStopEditing,
      onMoveFocus,
      toast,
    ]
  );

  useEffect(() => {
    if (!isEditing) return;

    const parsedHours = timeStringToFloat(draftHours);
    if (Number.isNaN(parsedHours) || parsedHours <= 0) return;
    if (timeStringToFloat(floatToTime(hours)) === parsedHours) return;

    const timer = window.setTimeout(() => {
      debugInlineEdit("autosave timer fired", {
        date,
        gridRow,
        gridCol,
        draftHours,
        parsedHours,
      });
      void persistHours(undefined, true);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [date, draftHours, gridRow, gridCol, hours, isEditing, persistHours]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      debugInlineEdit("keydown enter", { date, gridRow, gridCol, draftHours });
      void persistHours({ rowDelta: 0, colDelta: 1 });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      debugInlineEdit("keydown escape", { date, gridRow, gridCol, draftHours });
      setDraftHours(floatToTime(hours));
      onStopEditing(gridRow, gridCol);
    }
    if (event.key === "Tab") {
      event.preventDefault();
      debugInlineEdit("keydown tab", { date, gridRow, gridCol, draftHours, shiftKey: event.shiftKey });
      void persistHours({ rowDelta: 0, colDelta: event.shiftKey ? -1 : 1 });
    }
  };

  const handleCellClick = () => {
    if (isDisabled) return;
    debugInlineEdit("cell clicked", {
      date,
      gridRow,
      gridCol,
      taskName,
      hasMultipleEntries,
      primaryEntryInputMode: primaryEntry?.input_mode,
      fromTime: primaryEntry?.from_time,
      toTime: primaryEntry?.to_time,
      data,
    });
    onFocusCell(gridRow, gridCol);
    if (
      !taskName ||
      hasMultipleEntries ||
      (primaryEntry?.input_mode !== "duration" && isRangeEntry(primaryEntry?.from_time, primaryEntry?.to_time))
    ) {
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
          debugInlineEdit("typed to start editing", { date, gridRow, gridCol, key: event.key });
          onStartEditing(gridRow, gridCol);
          setDraftHours(event.key);
        }
        break;
    }
  };

  const displayValue = displayHours > 0 ? (rangeLabel || floatToTime(displayHours)) : "-";

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
          isDayFullyBookedEmpty && "bg-muted/50 dark:bg-muted/30",
          !isDisabled && "hover:bg-muted/60 dark:hover:bg-muted/40 hover:cursor-pointer",
          isFocused && !isDisabled && "ring-2 ring-primary ring-inset",
          runningTimerElapsed && "bg-success/10 text-success ring-1 ring-success/40 ring-inset",
          getBgCsssForToday(date),
          className
        )}
      >
        <HoverCardTrigger className={mergeClassNames(isDisabled && "cursor-default")}>
          {isEditing && !hasMultipleEntries ? (
            <Input
              ref={inputRef}
              value={draftHours}
              onChange={(event) => {
                debugInlineEdit("input changed", {
                  date,
                  gridRow,
                  gridCol,
                  value: event.target.value,
                });
                setDraftHours(event.target.value);
              }}
              onBlur={(event) => {
                debugInlineEdit("input blurred", {
                  date,
                  gridRow,
                  gridCol,
                  value: event.currentTarget.value,
                });
                void persistHours(undefined, false, event.currentTarget.value);
              }}
              onKeyDown={handleKeyDown}
              className="h-8 px-1 text-center"
              placeholder="00:00"
            />
          ) : (
            <span className="flex flex-col items-center justify-center ">
              {runningTimerElapsed && (
                <span className="mb-0.5 flex items-center gap-1 text-[0.68rem] font-semibold text-success">
                  <Timer className="h-3 w-3" />
                  {runningTimerElapsed}
                </span>
              )}
              <Typography
                variant="p"
                className={mergeClassNames(
                  isHoliday || (isDisabled && "text-slate-400 dark:text-muted-foreground/60"),
                  !displayHours && !isDisabled && "group-hover:hidden"
                )}
              >
                {displayValue}
              </Typography>
              {displayHours > 0 && <BillableIndicator entries={data} compact />}
              <PencilLine
                className={mergeClassNames(
                  "text-center hidden",
                  displayHours > 0 && !isDisabled && "group-hover:block"
                )}
                size={16}
              />
              <CirclePlus
                className={mergeClassNames("text-center hidden", !displayHours && !isDisabled && "group-hover:block ")}
                size={16}
              />
            </span>
          )}
        </HoverCardTrigger>
        {isDayFullyBookedEmpty && (
          <HoverCardContent className="text-left w-full max-w-80 p-3">
            <Typography variant="small" className="text-muted-foreground">
              {DAY_FULLY_BOOKED_MESSAGE}
            </Typography>
          </HoverCardContent>
        )}
        {description && (
          <HoverCardContent
            className="text-left whitespace-pre text-wrap w-full max-w-96 max-h-52 overflow-auto hover-content p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MarkdownContent value={description} className="p-3" />
          </HoverCardContent>
        )}
      </TableCell>
    </HoverCard>
  );
};
