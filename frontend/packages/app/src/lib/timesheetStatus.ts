export const DRAFT_TIMESHEET_STATUS = "Not Submitted";

const LOCKED_TIMESHEET_STATUSES = new Set([
  "Approval Pending",
  "Processing Timesheet",
  "Approved",
  "Partially Approved",
]);

export const getTimesheetStatusLabel = (status: string) => {
  if (status === DRAFT_TIMESHEET_STATUS) return "Draft";
  if (status === "Rejected" || status === "Partially Rejected") return `${status} — fix and resubmit`;
  return status;
};

export const isDraftTimesheetStatus = (status: string) => status === DRAFT_TIMESHEET_STATUS;

export const isWeekLocked = (status: string) => LOCKED_TIMESHEET_STATUSES.has(status);

export const isEntryReadOnly = (options: {
  weekStatus?: string;
  isPeriodLocked?: boolean;
}) => isWeekLocked(options.weekStatus ?? "") || Boolean(options.isPeriodLocked);
