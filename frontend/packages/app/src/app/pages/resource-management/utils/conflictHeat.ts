export const getAllocationUtilization = (allocatedHours: number, capacityHours: number) => {
  if (capacityHours <= 0) {
    return allocatedHours > 0 ? 2 : 0;
  }
  return allocatedHours / capacityHours;
};

export const getAllocationHeatClass = (allocatedHours: number, capacityHours: number) => {
  const utilization = getAllocationUtilization(allocatedHours, capacityHours);

  if (capacityHours <= 0 && allocatedHours > 0) {
    return "bg-destructive/35 ring-2 ring-destructive/50";
  }

  if (utilization > 1) {
    return "bg-destructive/35 ring-2 ring-destructive/50";
  }

  if (utilization >= 0.85) {
    return "bg-orange-400/30";
  }

  if (utilization >= 0.65) {
    return "bg-customYellow";
  }

  if (utilization >= 0.35) {
    return "bg-success/20";
  }

  if (utilization > 0) {
    return "bg-success/10";
  }

  return "";
};

export const getRemainingCapacityClass = (remainingPercentage: number) => {
  const utilization = 1 - remainingPercentage / 100;

  if (remainingPercentage < 0) {
    return "bg-destructive/35 ring-2 ring-destructive/50";
  }

  if (utilization >= 0.85) {
    return "bg-orange-400/30";
  }

  if (utilization >= 0.65) {
    return "bg-customYellow";
  }

  if (utilization >= 0.35) {
    return "bg-success/20";
  }

  if (utilization > 0) {
    return "bg-success/10";
  }

  return "bg-muted/40";
};
