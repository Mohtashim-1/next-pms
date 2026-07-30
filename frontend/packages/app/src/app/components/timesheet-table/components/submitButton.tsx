/**
 * External dependencies
 */
import type { MouseEvent } from "react";
import { Button } from "@next-pms/design-system/components";
import { CalendarClock, CircleCheck, CircleX, Clock3, FilePenLine, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
/**
 * Internal dependencies
 */
import { getTimesheetStatusLabel, isDraftTimesheetStatus, isWeekPartiallyLogged } from "@/lib/timesheetStatus";
import { floatToTime } from "@next-pms/design-system/utils";
import { mergeClassNames } from "@/lib/utils";
import type { submitButtonProps } from "./types";

/**
 * Submit Button
 * @description Button to show the status of the timesheet & to submit the timesheet.
 */
export const SubmitButton = ({
  start_date,
  end_date,
  onApproval,
  onRecall,
  onAbandonDraft,
  status,
  totalHours,
  expectedWeeklyHours,
}: submitButtonProps) => {
  const statusLabel = getTimesheetStatusLabel(status);
  const isDraft = isDraftTimesheetStatus(status);

  const handleClick = () => {
    onApproval?.(start_date, end_date);
  };
  const handleRecall = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRecall?.(start_date, end_date);
  };
  const handleAbandonDraft = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onAbandonDraft?.(start_date, end_date);
  };
  const partiallyLogged = isWeekPartiallyLogged({ status, totalHours, expectedWeeklyHours });
  const canRecall = [
    "Approval Pending",
    "Pending HR Approval",
    "Processing Timesheet",
    "Approved",
    "Partially Approved",
  ].includes(status);
  const canAbandonDraft = isDraft && totalHours > 0 && onAbandonDraft;

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        variant="ghost"
        asChild
        className={mergeClassNames(
          (status == "Approved" || status == "Partially Approved") &&
            "bg-success/20 text-success hover:bg-success/20 hover:text-success border border-success/30",
          (status == "Rejected" || status == "Partially Rejected") &&
            "bg-destructive/20 text-destructive hover:bg-destructive/20 hover:text-destructive border border-destructive/30",
          (status == "Approval Pending" || status === "Pending HR Approval") &&
            "bg-warning/20 text-warning hover:bg-warning/20 hover:text-warning  border border-warning/30",
          status === "Processing Timesheet" &&
            "bg-warning/20 text-warning hover:bg-warning/20 hover:text-warning  border border-warning/30",
          isDraft &&
            "bg-sky-500/10 text-sky-700 hover:bg-sky-500/10 hover:text-sky-700 dark:text-sky-300 border border-sky-500/30"
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!canRecall) {
            handleClick();
          }
        }}
      >
        <span>
          {(status == "Approved" || status == "Partially Approved") && <CircleCheck className="stroke-success" />}
          {(status == "Rejected" || status == "Partially Rejected") && <CircleX className="stroke-destructive" />}
          {(status == "Approval Pending" || status === "Pending HR Approval") && (
            <Clock3 className="stroke-warning" />
          )}
          {isDraft && <FilePenLine className="stroke-current" />}
          {status == "Processing Timesheet" && <LoaderCircle className="stroke-warning animate-spin" />}
          {statusLabel}
        </span>
      </Button>
      {partiallyLogged && (
        <span
          className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
          title={`Approved for the time logged. ${floatToTime(totalHours)} of ${floatToTime(
            expectedWeeklyHours ?? 0
          )} logged this week.`}
        >
          <CalendarClock className="w-3.5 h-3.5" />
          Partially logged
        </span>
      )}
      {canAbandonDraft && (
        <Button variant="outline" className="h-9 px-3" onClick={handleAbandonDraft} title="Discard draft">
          <Trash2 className="w-4 h-4" />
          Discard
        </Button>
      )}
      {canRecall && onRecall && (
        <Button variant="outline" className="h-9 px-3" onClick={handleRecall}>
          <RotateCcw className="w-4 h-4" />
          Recall
        </Button>
      )}
    </div>
  );
};
