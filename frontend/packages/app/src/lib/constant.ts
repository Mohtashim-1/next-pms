export const BASE_ROUTE = "/next-pms";
export const TIMESHEET = "timesheet";
export const WORK_ENTRIES = "work-entries";
export const HOME = "home";
export const DASHBOARD = "dashboard";
export const REPORTS = "reports";
export const TEAM = "/team";
export const TEAM_APPROVALS = `${TEAM}/approvals`;
export const DESK = "/desk";
export const EMPLOYEE = "/employee";
export const TASK = "task";
export const PROJECT = "/project";
export const LOCAL_STORAGE_TASK = "task_list";
export const RESOURCE_MANAGEMENT = "/resource-management";
export const LIKED_TASK_KEY = "next_pms_liked_task";
export const TIMESHEET_INPUT_MODE_KEY = "next_pms_timesheet_input_mode";
// user roles for timesheet / PM area access
export const ROLES = [
  "Projects Manager",
  "Timesheet Manager",
  "Timesheet User",
  "Team Lead",
];

// PM / manager routes: Home, Team, Project, Resource Management (NOT Timesheet User)
export const PM_ACCESS_ROLES = [
  "Projects Manager",
  "Timesheet Manager",
  "Administrator",
  "Projects User",
  "Accounts Manager",
  "System Manager",
  "Team Lead",
];

/** Roles that may use Timesheet / Work Entries / Task (self-scoped) */
export const TIMESHEET_ACCESS_ROLES = [
  ...PM_ACCESS_ROLES,
  "Timesheet User",
];

/** Desk reports hub — System Manager, Team Lead, Projects Manager only */
export const REPORT_ACCESS_ROLES = [
  "System Manager",
  "Administrator",
  "Team Lead",
  "Projects Manager",
];

export const CustomTime = [
  "00:30",
  "01:00",
  "01:30",
  "02:00",
  "02:30",
  "03:00",
  "03:30",
  "04:00",
  "04:30",
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
];
