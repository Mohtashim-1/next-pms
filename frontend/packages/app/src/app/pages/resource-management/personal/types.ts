export type PersonalAllocation = {
  name: string;
  employee: string;
  employee_name: string;
  project: string;
  project_name: string;
  customer: string;
  allocation_start_date: string;
  allocation_end_date: string;
  hours_allocated_per_day: number;
  total_allocated_hours?: number;
  is_billable: number;
  status?: string;
  note?: string;
};

export type PersonalAllocationsResponse = {
  employee: string | null;
  employee_name: string;
  is_admin_view?: boolean;
  allocations: PersonalAllocation[];
  upcoming: PersonalAllocation[];
  start_date: string;
  end_date: string;
};

export type CalendarFeedSettings = {
  feed_url: string | null;
  webcal_url: string | null;
  has_token: boolean;
  disabled?: boolean;
  message?: string;
};
