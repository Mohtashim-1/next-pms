import {
  DEFAULT_UTILIZATION_THRESHOLDS,
  getAllocationUtilization,
  getUtilizationBandClass,
  getUtilizationBand,
  getUtilizationHeatClass,
  type UtilizationThresholds,
} from "./utilization";

export { getAllocationUtilization, getUtilizationHeatClass };

export const getAllocationHeatClass = (
  allocatedHours: number,
  capacityHours: number,
  thresholds: UtilizationThresholds = DEFAULT_UTILIZATION_THRESHOLDS
) => getUtilizationHeatClass(allocatedHours, capacityHours, thresholds);

export const getRemainingCapacityClass = (
  remainingPercentage: number,
  thresholds: UtilizationThresholds = DEFAULT_UTILIZATION_THRESHOLDS
) => {
  const utilization = remainingPercentage < 0 ? 2 : 1 - remainingPercentage / 100;
  return getUtilizationBandClass(getUtilizationBand(utilization, thresholds));
};
