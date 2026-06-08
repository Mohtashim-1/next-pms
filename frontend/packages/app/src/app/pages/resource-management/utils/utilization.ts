export type UtilizationThresholds = {
  under_utilized_max: number;
  over_capacity_min: number;
};

export type UtilizationBand = "under_utilized" | "target" | "over_capacity";

export const DEFAULT_UTILIZATION_THRESHOLDS: UtilizationThresholds = {
  under_utilized_max: 0.7,
  over_capacity_min: 1,
};

export const getAllocationUtilization = (allocatedHours: number, capacityHours: number) => {
  if (capacityHours <= 0) {
    return allocatedHours > 0 ? 2 : 0;
  }
  return allocatedHours / capacityHours;
};

export const getUtilizationBand = (
  utilization: number,
  thresholds: UtilizationThresholds = DEFAULT_UTILIZATION_THRESHOLDS
): UtilizationBand => {
  if (utilization > thresholds.over_capacity_min) {
    return "over_capacity";
  }
  if (utilization >= thresholds.under_utilized_max) {
    return "target";
  }
  return "under_utilized";
};

export const getUtilizationBandClass = (band: UtilizationBand) => {
  switch (band) {
    case "over_capacity":
      return "bg-destructive/35 ring-2 ring-destructive/50";
    case "target":
      return "bg-success/25";
    case "under_utilized":
    default:
      return "bg-sky-100/80 dark:bg-sky-950/40";
  }
};

export const getUtilizationHeatClass = (
  allocatedHours: number,
  capacityHours: number,
  thresholds: UtilizationThresholds = DEFAULT_UTILIZATION_THRESHOLDS
) => {
  const utilization = getAllocationUtilization(allocatedHours, capacityHours);
  return getUtilizationBandClass(getUtilizationBand(utilization, thresholds));
};
