/**
 * Internal dependencies.
 */
import { WorkingFrequency } from "@/types";

export interface TaskProps {
  [key: string]: TaskDataProps;
}

export interface TaskDataProps {
  name: string;
  subject: string;
  project_name: string | null;
  is_billable: boolean;
  project_default_is_billable?: boolean | number;
  project: string;
  expected_time: number;
  actual_time: number;
  status: string;
  data: Array<TaskDataItemProps>;
}

export interface TaskDataItemProps {
  hours: number;
  description: string;
  name: string;
  parent: string;
  is_billable: boolean | number;
  project_default_is_billable?: boolean | number;
  is_billable_override?: boolean;
  billable_override_reason?: string | null;
  description_required?: boolean;
  show_description_in_approval?: boolean;
  include_description_on_invoice?: boolean;
  entry_approval_status?: string;
  rejection_comment?: string | null;
  rejected_by?: string | null;
  rejected_on?: string | null;
  was_rejected?: boolean;
  is_period_locked?: boolean;
  period_lock_reason?: string | null;
  period_lock_name?: string | null;
  task: string;
  from_time: string;
  to_time?: string;
  input_mode?: "duration" | "range";
  docstatus: 0 | 1 | 2;
  subject?: string;
  project?: string;
  project_name?: string | null;
}

export interface LeaveProps {
  name: string;
  from_date: string;
  to_date: string;
  status: string;
  half_day: boolean;
  half_day_date: string;
  leave_type: string;
  is_lwp: boolean;
}

export interface DynamicKey {
  [key: string]: timesheet;
}

export interface PeriodLockProp {
  name: string;
  from_date: string;
  to_date: string;
  lock_reason: string;
  locked_by?: string;
  locked_on?: string;
}

export interface DataProp {
  working_hour: number;
  working_frequency: WorkingFrequency;
  data: DynamicKey;
  leaves: Array<LeaveProps>;
  holidays: Array<HolidayProp>;
  period_locks?: Array<PeriodLockProp>;
}

export interface HolidayProp {
  description: string;
  holiday_date: string;
  weekly_off: boolean;
}

export interface timesheet {
  start_date: string;
  end_date: string;
  key: string;
  dates: string[];
  total_hours: number;
  tasks: TaskProps;
  status: string;
}

export interface NewTimesheetProps {
  name: string;
  parent?: string;
  task: string;
  date: string;
  description: string;
  hours: number;
  employee: string;
}

export type RunningTimer = {
  employee: string;
  task: string;
  task_subject: string;
  project?: string;
  project_name?: string;
  description?: string;
  started_at: string;
};
