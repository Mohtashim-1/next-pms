/**
 * External dependencies.
 */
import { Typography } from "@next-pms/design-system/components";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import { formatGapHours, getGapCellClass } from "../utils/gapColors";
import type { CapacityDemandRow, CapacityPeriod, CapacityPeriodMetrics } from "../types";

export const CapacityGapGrid = ({
  periods,
  rows,
  summary,
  onCellClick,
}: {
  periods: CapacityPeriod[];
  rows: CapacityDemandRow[];
  summary: Record<string, Omit<CapacityPeriodMetrics, "projects">>;
  onCellClick: (row: CapacityDemandRow, period: CapacityPeriod, metrics: CapacityPeriodMetrics) => void;
}) => {
  if (!rows.length) {
    return (
      <Typography variant="p" className="text-sm text-muted-foreground p-4">
        No capacity data for the selected filters.
      </Typography>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-xs sm:text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 bg-muted/90 px-3 py-2 text-left font-medium min-w-[140px] sm:min-w-[180px]">
              {rows[0]?.group_by === "employee" ? "Employee" : "Group"}
            </th>
            {periods.map((period) => (
              <th
                key={period.key}
                className="px-2 py-2 text-center font-medium min-w-[72px] sm:min-w-[88px] whitespace-nowrap"
                title={`${period.start_date} – ${period.end_date}`}
              >
                {period.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium whitespace-nowrap">
                {row.label}
              </td>
              {periods.map((period) => {
                const metrics = row.periods[period.key];
                if (!metrics) {
                  return (
                    <td key={`${row.id}-${period.key}`} className="px-2 py-2 text-center text-muted-foreground">
                      –
                    </td>
                  );
                }
                return (
                  <td key={`${row.id}-${period.key}`} className="p-1">
                    <button
                      type="button"
                      className={mergeClassNames(
                        "w-full rounded px-1.5 py-2 text-center transition hover:opacity-90",
                        getGapCellClass(metrics.status)
                      )}
                      onClick={() => onCellClick(row, period, metrics)}
                      title={`Capacity ${metrics.capacity_hours}h · Demand ${metrics.demand_hours}h`}
                    >
                      <div className="font-semibold">{formatGapHours(metrics.gap_hours)}</div>
                      <div className="text-[10px] opacity-80 hidden sm:block">
                        {metrics.demand_hours}/{metrics.capacity_hours}h
                      </div>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t bg-muted/30 font-semibold">
            <td className="sticky left-0 z-10 bg-muted/50 px-3 py-2">Total</td>
            {periods.map((period) => {
              const metrics = summary[period.key];
              if (!metrics) {
                return <td key={`summary-${period.key}`} className="px-2 py-2 text-center">–</td>;
              }
              return (
                <td key={`summary-${period.key}`} className="p-1">
                  <div
                    className={mergeClassNames(
                      "rounded px-1.5 py-2 text-center",
                      getGapCellClass(metrics.status)
                    )}
                  >
                    {formatGapHours(metrics.gap_hours)}
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
};
