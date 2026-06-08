/**
 * External dependencies
 */
import { useMemo, useCallback } from "react";
import {
  HoverCard,
  TableCell,
  HoverCardTrigger,
  Typography,
  HoverCardContent,
} from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";
import { CirclePlus, PencilLine, Timer } from "lucide-react";
/**
 * Internal dependencies
 */
import { BillableIndicator } from "@/app/components/timesheet-billable/billableIndicator";
import { MarkdownContent } from "@/app/components/timesheet-description/markdownContent";
import { mergeClassNames, getBgCsssForToday } from "@/lib/utils";
import type { cellProps } from "./types";

/**
 * @description This is the main component for the timesheet table cell.
 * It is responsible for rendering the data in the grid, show tooltip on hover and
 * open the dialog box to add/edit time on click.
 *
 * @param {string} props.date - The date of the cell
 * @param {Array} props.data - The data for the cell
 * @param {boolean} props.isHoliday - If the date is a holiday
 * @param {Function} props.onCellClick - Function to call when the cell is clicked
 * @param {boolean} props.disabled - If the timesheet is disabled
 * @param {string} props.className - Class name for the cell
 */

export const Cell = ({ date, data, isHoliday, onCellClick, disabled, className, runningTimerElapsed }: cellProps) => {
  const { hours, description, rejectionNotes } = useMemo(() => {
    let hours = 0;
    let description = "";
    let rejectionNotes = "";

    if (data) {
      hours = data.reduce((sum, item) => sum + (item.hours || 0), 0);
      description = data.reduce((desc, item) => desc + (item.description ? item.description + "\n" : ""), "").trim();
      rejectionNotes = data
        .filter((item) => item.rejection_comment)
        .map((item) => item.rejection_comment)
        .join("\n");
    }

    return { hours, description, rejectionNotes };
  }, [data]);

  const periodLockReason = data?.[0]?.period_lock_reason;
  const isDisabled = useMemo(
    () => disabled || data?.[0]?.docstatus === 1 || Boolean(data?.[0]?.is_period_locked),
    [disabled, data]
  );

  const handleClick = useCallback(() => {
    if (isDisabled) return;
    const value = {
      date,
      hours,
      description: "",
      name: "",
      task: data?.[0]?.task ?? "",
      project: data?.[0]?.project ?? "",
    };
    onCellClick?.(value);
  }, [isDisabled, date, hours, data, onCellClick]);

  return (
    <HoverCard openDelay={500} closeDelay={500}>
      <TableCell
        key={date}
        onClick={handleClick}
        className={mergeClassNames(
          "text-center group px-2",
          isDisabled && "cursor-default",
          "hover:h-full hover:bg-muted/60 dark:hover:bg-muted/40 hover:cursor-pointer",
          runningTimerElapsed && "bg-success/10 text-success ring-1 ring-success/40 ring-inset",
          getBgCsssForToday(date),
          className
        )}
      >
        <HoverCardTrigger className={mergeClassNames(isDisabled && "cursor-default")}>
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
                !hours && !isDisabled && "group-hover:hidden"
              )}
            >
              {hours > 0 ? floatToTime(hours) : "-"}
            </Typography>
            {hours > 0 && <BillableIndicator entries={data} compact />}
            {rejectionNotes && (
              <Typography variant="small" className="text-[0.62rem] font-semibold text-destructive">
                Rejected
              </Typography>
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
        </HoverCardTrigger>
        {(description || rejectionNotes || periodLockReason) && (
          <HoverCardContent
            className="text-left whitespace-pre text-wrap w-full max-w-96 max-h-52 overflow-auto hover-content p-3"
            onClick={(e) => e.stopPropagation()}
          >
            {periodLockReason && (
              <Typography variant="small" className="mb-2 block font-medium text-amber-700">
                Period locked: {periodLockReason}
              </Typography>
            )}
            {rejectionNotes && (
              <Typography variant="small" className="mb-2 block font-medium text-destructive">
                Rejection: {rejectionNotes}
              </Typography>
            )}
            {description && <MarkdownContent value={description} />}
          </HoverCardContent>
        )}
      </TableCell>
    </HoverCard>
  );
};
