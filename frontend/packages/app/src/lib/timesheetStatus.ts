export const DRAFT_TIMESHEET_STATUS = "Not Submitted";

const LOCKED_TIMESHEET_STATUSES = new Set([
  "Approval Pending",
  "Pending HR Approval",
  "Processing Timesheet",
  "Approved",
  "Partially Approved",
]);

export const getTimesheetStatusLabel = (status: string) => {
  if (status === DRAFT_TIMESHEET_STATUS) return "Draft";
  if (status === "Rejected" || status === "Partially Rejected") return `${status} — fix and resubmit`;
  return status;
};

const APPROVAL_PROGRESS_STATUSES = new Set([
  "Approval Pending",
  "Pending HR Approval",
  "Approved",
  "Partially Approved",
  "Partially Rejected",
]);

/**
 * A week can be fully approved and still cover only part of the week. That gap
 * is about logging, not approval, so it is reported separately from the status.
 */
export const isWeekPartiallyLogged = (options: {
  status: string;
  totalHours: number;
  expectedWeeklyHours?: number;
}) => {
  const { status, totalHours, expectedWeeklyHours } = options;
  if (!expectedWeeklyHours || expectedWeeklyHours <= 0) return false;
  if (!APPROVAL_PROGRESS_STATUSES.has(status)) return false;
  if (totalHours <= 0) return false;
  // Tolerance keeps rounded minutes from reading as a missing hour.
  return totalHours < expectedWeeklyHours - 0.01;
};

export const isDraftTimesheetStatus = (status: string) => status === DRAFT_TIMESHEET_STATUS;

export const isWeekLocked = (status: string) => LOCKED_TIMESHEET_STATUSES.has(status);

export const isEntryReadOnly = (options: {
  weekStatus?: string;
  isPeriodLocked?: boolean;
}) => isWeekLocked(options.weekStatus ?? "") || Boolean(options.isPeriodLocked);
