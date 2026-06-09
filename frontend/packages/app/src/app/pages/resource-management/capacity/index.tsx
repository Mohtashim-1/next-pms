/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
import { Spinner, Typography } from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";

/**
 * Internal dependencies.
 */
import { Header as RootHeader } from "@/app/layout/root";
import { CapacityDemandHeader } from "./components/capacityDemandHeader";
import { CapacityGapGrid } from "./components/capacityGapGrid";
import { ProjectDemandDrilldown } from "./components/projectDemandDrilldown";
import type {
  CapacityDemandFilters,
  CapacityDemandResponse,
  CapacityDrilldownState,
  CapacityPeriod,
  CapacityPeriodMetrics,
  CapacityDemandRow,
} from "./types";
import { getGapStatusLabel } from "./utils/gapColors";

const defaultFilters: CapacityDemandFilters = {
  period: "week",
  groupBy: "employee",
  department: [],
  userGroup: [],
  branch: [],
  roles: [],
};

const normalizeFilterValue = (value: string | string[] | undefined, fallback: string) => {
  if (Array.isArray(value)) {
    return value[0] || fallback;
  }
  return value || fallback;
};

const CapacityDemandView = () => {
  const [filters, setFilters] = useState<CapacityDemandFilters>(defaultFilters);
  const [drilldown, setDrilldown] = useState<CapacityDrilldownState | null>(null);

  const apiArgs = useMemo(
    () => ({
      period: normalizeFilterValue(filters.period, "week"),
      horizon_months: 12,
      group_by: normalizeFilterValue(filters.groupBy, "employee"),
      department: JSON.stringify(filters.department ?? []),
      user_group: JSON.stringify(filters.userGroup ?? []),
      branch: JSON.stringify(filters.branch ?? []),
      roles: JSON.stringify(filters.roles ?? []),
      skills:
        filters.skillSearch && filters.skillSearch.length > 0
          ? JSON.stringify(filters.skillSearch)
          : "[]",
    }),
    [filters]
  );

  const { data, isLoading, error, mutate } = useFrappeGetCall(
    "next_pms.resource_management.api.capacity_demand.get_capacity_demand_view",
    apiArgs
  );

  const response = data?.message as CapacityDemandResponse | undefined;

  const handleCellClick = (
    row: CapacityDemandRow,
    period: CapacityPeriod,
    metrics: CapacityPeriodMetrics
  ) => {
    setDrilldown({
      rowLabel: row.label,
      periodLabel: period.label,
      periodStart: period.start_date,
      periodEnd: period.end_date,
      metrics,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Typography variant="h5">Capacity Planning</Typography>
            <Typography variant="small" className="text-muted-foreground">
              12-month forward view · gap = capacity − demand
            </Typography>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded px-2 py-1 bg-sky-100/90 dark:bg-sky-950/50">Surplus</span>
            <span className="rounded px-2 py-1 bg-success/15">Balanced</span>
            <span className="rounded px-2 py-1 bg-destructive/20">Shortage</span>
          </div>
        </div>
      </RootHeader>

      <CapacityDemandHeader
        filters={filters}
        onChange={(updated) => setFilters((prev) => ({ ...prev, ...updated }))}
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {isLoading ? (
          <Spinner isFull />
        ) : error ? (
          <Typography variant="p" className="text-destructive">
            Unable to load capacity planning data.
          </Typography>
        ) : response ? (
          <>
            <Typography variant="small" className="text-muted-foreground">
              {response.rows.length} rows · {response.periods.length}{" "}
              {response.period === "week" ? "weeks" : "months"} through {response.end_date}
            </Typography>
            <CapacityGapGrid
              periods={response.periods}
              rows={response.rows}
              summary={response.summary}
              onCellClick={handleCellClick}
            />
            {drilldown && (
              <Typography variant="small" className="text-muted-foreground sm:hidden">
                Tap a cell to drill into {getGapStatusLabel(drilldown.metrics.status).toLowerCase()} demand by
                project.
              </Typography>
            )}
          </>
        ) : null}
      </div>

      <ProjectDemandDrilldown drilldown={drilldown} onClose={() => setDrilldown(null)} />

      {!isLoading && (
        <button
          type="button"
          className="sr-only"
          onClick={() => mutate()}
          aria-label="Refresh capacity data"
        />
      )}
    </div>
  );
};

export default CapacityDemandView;
