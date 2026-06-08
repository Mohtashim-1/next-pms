import type { CapacityGapStatus } from "../types";

export const getGapStatusLabel = (status: CapacityGapStatus) => {
  switch (status) {
    case "surplus":
      return "Surplus";
    case "shortage":
      return "Shortage";
    default:
      return "Balanced";
  }
};

export const getGapCellClass = (status: CapacityGapStatus) => {
  switch (status) {
    case "surplus":
      return "bg-sky-100/90 dark:bg-sky-950/50 text-sky-950 dark:text-sky-100";
    case "shortage":
      return "bg-destructive/20 text-destructive ring-1 ring-destructive/30";
    default:
      return "bg-success/15 text-foreground";
  }
};

export const formatGapHours = (gapHours: number) => {
  const rounded = Math.round(gapHours);
  if (rounded > 0) return `+${rounded}h`;
  return `${rounded}h`;
};
