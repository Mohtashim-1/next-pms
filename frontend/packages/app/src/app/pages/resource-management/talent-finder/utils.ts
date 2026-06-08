import { getFormatedDate } from "@next-pms/design-system/date";
import type { TalentFinderFilters } from "./types";

export const createDefaultSkillQuery = () => ({
  operator: "AND" as const,
  groups: [{ operator: "AND" as const, skills: [] }],
});

export const createFilter = (filters?: Partial<TalentFinderFilters>): TalentFinderFilters => {
  const today = getFormatedDate(new Date(), "yyyy-MM-dd");
  return {
    skillQuery: filters?.skillQuery ?? createDefaultSkillQuery(),
    branch: filters?.branch ?? [],
    languages: filters?.languages ?? [],
    timezones: filters?.timezones ?? [],
    minBillRate: filters?.minBillRate,
    maxBillRate: filters?.maxBillRate,
    availabilityFrom: filters?.availabilityFrom ?? today,
    availabilityTo: filters?.availabilityTo ?? today,
    minAvailableHours: filters?.minAvailableHours,
    minAvailabilityPct: filters?.minAvailabilityPct,
    department: filters?.department ?? [],
    designation: filters?.designation ?? [],
    userGroup: filters?.userGroup ?? [],
    roles: filters?.roles ?? [],
    employeeName: filters?.employeeName ?? "",
  };
};

export const getFitScoreClass = (score: number) => {
  if (score >= 80) return "bg-success/20 text-success-foreground";
  if (score >= 60) return "bg-sky-100/90 dark:bg-sky-950/50";
  if (score >= 40) return "bg-amber-100/80 dark:bg-amber-950/40";
  return "bg-destructive/15 text-destructive";
};
