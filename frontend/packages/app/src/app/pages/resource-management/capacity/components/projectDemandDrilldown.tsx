/**
 * External dependencies.
 */
import {
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Typography,
} from "@next-pms/design-system/components";

/**
 * Internal dependencies.
 */
import { formatGapHours, getGapStatusLabel } from "../utils/gapColors";
import type { CapacityDrilldownState } from "../types";

export const ProjectDemandDrilldown = ({
  drilldown,
  onClose,
}: {
  drilldown: CapacityDrilldownState | null;
  onClose: () => void;
}) => {
  if (!drilldown) {
    return null;
  }

  const { metrics } = drilldown;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{drilldown.rowLabel}</SheetTitle>
          <SheetDescription>{drilldown.periodLabel}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground">
                Capacity
              </Typography>
              <Typography variant="p" className="font-semibold">
                {metrics.capacity_hours}h
              </Typography>
            </div>
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground">
                Demand
              </Typography>
              <Typography variant="p" className="font-semibold">
                {metrics.demand_hours}h
              </Typography>
            </div>
            <div className="rounded-md border p-3 col-span-2">
              <Typography variant="small" className="text-muted-foreground">
                Gap
              </Typography>
              <div className="flex items-center gap-2">
                <Typography variant="p" className="font-semibold">
                  {formatGapHours(metrics.gap_hours)}
                </Typography>
                <Badge variant="outline">{getGapStatusLabel(metrics.status)}</Badge>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Typography variant="p" className="font-medium">
              Projects Driving Demand
            </Typography>
            {metrics.projects.length === 0 ? (
              <Typography variant="small" className="text-muted-foreground">
                No project allocations in this period.
              </Typography>
            ) : (
              <div className="space-y-2">
                {metrics.projects.map((project) => (
                  <div
                    key={project.project}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate pr-3">{project.project_name}</span>
                    <span className="font-medium shrink-0">{project.hours}h</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
