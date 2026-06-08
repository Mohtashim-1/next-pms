import type { Skill } from "../store/types";

export type BooleanOperator = "AND" | "OR";

export type SkillQueryGroup = {
  operator: BooleanOperator;
  skills: Skill[];
};

export type SkillBooleanQuery = {
  operator: BooleanOperator;
  groups: SkillQueryGroup[];
};

export type TalentFinderFilters = {
  skillQuery: SkillBooleanQuery;
  branch: string[];
  languages: string[];
  timezones: string[];
  minBillRate?: number;
  maxBillRate?: number;
  availabilityFrom: string;
  availabilityTo: string;
  minAvailableHours?: number;
  minAvailabilityPct?: number;
  department: string[];
  designation: string[];
  userGroup: string[];
  roles: string[];
  employeeName?: string;
};

export type TalentAvailability = {
  capacity_hours: number;
  allocated_hours: number;
  available_hours: number;
  availability_pct: number;
};

export type TalentSkillMatch = {
  skill: string;
  proficiency: number;
};

export type TalentSearchResult = {
  employee: string;
  employee_name: string;
  image?: string;
  department?: string;
  designation?: string;
  branch?: string;
  language?: string;
  time_zone?: string;
  bill_rate: number;
  primary_skill?: string;
  primary_role?: string;
  user_group?: string;
  fit_score: number;
  availability: TalentAvailability;
  skills: TalentSkillMatch[];
};

export type TalentSearchResponse = {
  results: TalentSearchResult[];
  total_count: number;
  availability_from: string;
  availability_to: string;
};
