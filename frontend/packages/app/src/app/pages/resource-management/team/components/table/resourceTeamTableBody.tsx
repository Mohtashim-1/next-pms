/**
 * External dependencies.
 */
import { memo, useCallback, useMemo } from "react";
import { TableBody } from "@next-pms/design-system/components";
import { ResourceTableRow } from "@next-pms/resource-management/components";
import { prettyDate } from "@next-pms/design-system/date";
import { useContextSelector } from "use-context-selector";

/**
 * Internal dependencies.
 */
import { EmptyTableBody } from "../../../components/empty";
import { TeamContext } from "../../../store/teamContext";
import type { AllocationDataProps, EmployeeDataProps } from "../../../store/types";
import { aggregateEmployeePeriod, getRollupColumns, normalizeRollupPeriod } from "../../../utils/rollup";
import { ResourceExpandView } from "../expand-view";
import { ResourceTeamTableCell } from "./resourceTeamTableCell";

const ResourceTeamTableBody = ({
  onSubmit,
}: {
  onSubmit: (oldData: AllocationDataProps, data: AllocationDataProps) => void;
}) => {
  const { teamData, tableView } = useContextSelector(TeamContext, (value) => value.state);

  const data = teamData.data;
  const dates = teamData.dates;
  const rollupPeriod = normalizeRollupPeriod(tableView.rollupPeriod, tableView.combineWeekHours);
  const rollupColumns = useMemo(() => getRollupColumns(dates, rollupPeriod), [dates, rollupPeriod]);

  if (data.length === 0) {
    return <EmptyTableBody />;
  }

  return (
    <TableBody>
      {data.map((employeeData) => (
        <MemoizedRow
          key={employeeData.employee_name}
          employeeData={employeeData}
          rollupColumns={rollupColumns}
          rollupPeriod={rollupPeriod}
          onSubmit={onSubmit}
        />
      ))}
    </TableBody>
  );
};

const MemoizedRow = memo(function MemoizedRow({
  employeeData,
  rollupColumns,
  rollupPeriod,
  onSubmit,
}: {
  employeeData: EmployeeDataProps;
  rollupColumns: ReturnType<typeof getRollupColumns>;
  rollupPeriod: ReturnType<typeof normalizeRollupPeriod>;
  onSubmit: (oldData: AllocationDataProps, data: AllocationDataProps) => void;
}) {
  const RowComponent = () => (
    <>
      {rollupColumns.map((column, columnIndex) => {
        const periodData = aggregateEmployeePeriod(
          employeeData.all_dates_data,
          column.dates,
          employeeData.employee_daily_working_hours
        );

        const weekData = employeeData.all_week_data[column.weekKey ?? column.key] ?? {
          total_allocated_hours: periodData.total_allocated_hours,
          total_working_hours: periodData.total_working_hours,
          total_worked_hours: periodData.total_worked_hours,
        };

        const periodStart = column.dates[0];
        const periodEnd = column.dates[column.dates.length - 1];
        const periodLabel =
          column.dates.length === 1
            ? `${prettyDate(periodStart).date} - ${prettyDate(periodStart).day}`
            : column.label;
        const columnSpan =
          rollupPeriod === "week" ? 5 : rollupPeriod === "month" ? column.dates.length : 1;

        return (
          <ResourceTeamTableCell
            key={`${employeeData.name}-${column.key}`}
            employeeSingleDay={periodData}
            weekData={weekData}
            employee={employeeData.name}
            employee_name={employeeData.employee_name}
            rowCount={rollupPeriod === "day" ? (column.dateIndex ?? 0) : 2}
            midIndex={rollupPeriod === "day" ? (column.weekIndex ?? 0) : columnIndex}
            employeeAllocations={employeeData.employee_allocations}
            periodLabel={periodLabel}
            periodStart={periodStart}
            periodEnd={periodEnd}
            columnSpan={columnSpan}
            utilizationThresholds={
              employeeData.utilization_thresholds ?? undefined
            }
            onSubmit={onSubmit}
          />
        );
      })}
    </>
  );

  const RowExpandView = useCallback(() => {
    return <ResourceExpandView employeeData={employeeData} onSubmit={onSubmit} />;
  }, [employeeData, onSubmit]);

  return (
    <ResourceTableRow
      key={employeeData?.name}
      name={employeeData?.name}
      avatar={employeeData?.image}
      avatar_abbr={employeeData?.employee_name}
      avatar_name={employeeData?.employee_name}
      RowComponent={RowComponent}
      RowExpandView={RowExpandView}
    />
  );
});

export { ResourceTeamTableBody };
