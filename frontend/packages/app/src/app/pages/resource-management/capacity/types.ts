export type CapacityPeriodType = "week" | "month";

export type CapacityGapStatus = "surplus" | "shortage" | "balanced";

export type CapacityProjectDemand = {
  project: string;
  project_name: string;
  hours: number;
};

export type CapacityPeriodMetrics = {
  capacity_hours: number;
  demand_hours: number;
  gap_hours: number;
  status: CapacityGapStatus;
  projects: CapacityProjectDemand[];
};

export type CapacityPeriod = {
  key: string;
  label: string;
  start_date: string;
  end_date: string;
};

export type CapacityDemandRow = {
  id: string;
  label: string;
  group_by: string;
  periods: Record<string, CapacityPeriodMetrics>;
};

export type CapacityDemandResponse = {
  periods: CapacityPeriod[];
  rows: CapacityDemandRow[];
  summary: Record<string, Omit<CapacityPeriodMetrics, "projects">>;
  start_date: string;
  end_date: string;
  period: CapacityPeriodType;
  horizon_months: number;
  group_by: string;
};

export type CapacityDemandFilters = {
  period: CapacityPeriodType;
  groupBy: string;
  department?: string[];
  userGroup?: string[];
  branch?: string[];
  roles?: string[];
  skillSearch?: Array<{ name: string; proficiency: number; operator: string }>;
};

export type CapacityDrilldownState = {
  rowLabel: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  metrics: CapacityPeriodMetrics;
};
