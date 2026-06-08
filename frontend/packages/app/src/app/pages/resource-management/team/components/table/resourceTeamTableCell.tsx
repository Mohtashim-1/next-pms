/**
 * External dependencies.
 */
import { useMemo, useCallback, memo } from "react";
import { prettyDate } from "@next-pms/design-system/date";
import { ResourceTableCell } from "@next-pms/resource-management/components";
import { TableContext } from "@next-pms/resource-management/store";
import { getTableCellClass, getTodayDateCellClass } from "@next-pms/resource-management/utils";
import { useContextSelector } from "use-context-selector";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import type { ResourceAllocationObjectProps } from "@/types/resource_management";
import { EmptyTableCell } from "../../../components/empty";
import { ResourceFormContext } from "../../../store/resourceFormContext";
import { TeamContext } from "../../../store/teamContext";
import type {
  AllocationDataProps,
  EmployeeAllWeekDataProps,
  EmployeeResourceProps,
  UtilizationThresholds,
} from "../../../store/types";
import { DEFAULT_UTILIZATION_THRESHOLDS, getUtilizationHeatClass } from "../../../utils/utilization";
import { normalizeRollupPeriod } from "../../../utils/rollup";

type ResourceTeamTableCellProps = {
  employeeSingleDay: EmployeeResourceProps;
  weekData: EmployeeAllWeekDataProps;
  rowCount: number;
  employee: string;
  employee_name: string;
  midIndex: number;
  employeeAllocations: ResourceAllocationObjectProps;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  columnSpan?: number;
  utilizationThresholds?: UtilizationThresholds;
  onSubmit: (oldData: AllocationDataProps, data: AllocationDataProps) => void;
};

const ResourceTeamTableCellComponent = ({
  employeeSingleDay,
  weekData,
  rowCount,
  employee_name,
  employee,
  midIndex,
  employeeAllocations,
  periodLabel,
  periodStart,
  periodEnd,
  columnSpan = 1,
  utilizationThresholds,
}: ResourceTeamTableCellProps) => {
  const { tableView } = useContextSelector(TeamContext, (value) => value.state);
  const { tableProperties } = useContextSelector(TableContext, (value) => value.state);
  const { getCellWidthString } = useContextSelector(TableContext, (value) => value.actions);
  const { openAssignmentDrilldown } = useContextSelector(TeamContext, (value) => value.actions);
  const { permission: resourceAllocationPermission } = useContextSelector(ResourceFormContext, (value) => value.state);

  const rollupPeriod = normalizeRollupPeriod(tableView.rollupPeriod, tableView.combineWeekHours);
  const thresholds = utilizationThresholds ?? DEFAULT_UTILIZATION_THRESHOLDS;
  const cellWidthStyle = {
    width: getCellWidthString(tableProperties.cellWidth * columnSpan),
  };

  const allocatedHours = rollupPeriod === "week" ? weekData.total_allocated_hours : employeeSingleDay.total_allocated_hours;
  const capacityHours =
    rollupPeriod === "week" ? weekData.total_working_hours : employeeSingleDay.total_working_hours;
  const workedHours = rollupPeriod === "week" ? weekData.total_worked_hours : employeeSingleDay.total_worked_hours;

  const title = `${employee_name} (${periodLabel})`;

  const cellBackGroundColor = useMemo(
    () => getUtilizationHeatClass(allocatedHours, capacityHours, thresholds),
    [allocatedHours, capacityHours, thresholds]
  );

  const hasTentativeAllocation = useMemo(
    () => employeeSingleDay.employee_resource_allocation_for_given_date?.some((alloc) => alloc.is_tentative),
    [employeeSingleDay.employee_resource_allocation_for_given_date]
  );

  const openDrilldown = useCallback(() => {
    openAssignmentDrilldown({
      employee,
      employee_name,
      dateStart: periodStart,
      dateEnd: periodEnd,
      allocatedHours,
      capacityHours,
      allocations: employeeSingleDay.employee_resource_allocation_for_given_date ?? [],
      employeeAllocations,
    });
  }, [
    allocatedHours,
    capacityHours,
    employee,
    employeeAllocations,
    employeeSingleDay.employee_resource_allocation_for_given_date,
    employee_name,
    openAssignmentDrilldown,
    periodEnd,
    periodStart,
  ]);

  const displayValue = useMemo(() => {
    if (rollupPeriod !== "day" && rowCount !== 2) {
      return "";
    }

    if (employeeSingleDay.is_on_leave && rollupPeriod === "day") {
      return employeeSingleDay.total_leave_hours;
    }

    if (tableView.view === "planned-vs-capacity") {
      if (rollupPeriod === "day") {
        return allocatedHours;
      }
      return `${allocatedHours} / ${capacityHours}`;
    }

    if (rollupPeriod === "day") {
      return `${workedHours} / ${allocatedHours}`;
    }

    return `${workedHours} / ${allocatedHours}`;
  }, [
    allocatedHours,
    capacityHours,
    employeeSingleDay.is_on_leave,
    employeeSingleDay.total_leave_hours,
    rollupPeriod,
    rowCount,
    tableView.view,
    workedHours,
  ]);

  if (rollupPeriod !== "day" && rowCount !== 2) {
    return null;
  }

  if (employeeSingleDay.is_on_leave && rollupPeriod === "day") {
    return (
      <ResourceTableCell
        type="default"
        title={title}
        cellClassName={mergeClassNames(
          getTableCellClass(rowCount),
          cellBackGroundColor,
          getTodayDateCellClass(employeeSingleDay.date)
        )}
        value={displayValue}
        onCellClick={openDrilldown}
        style={cellWidthStyle}
      />
    );
  }

  if (allocatedHours === 0 && !employeeSingleDay.is_on_leave) {
    if (resourceAllocationPermission.write) {
      return (
        <EmptyTableCell
          title={title}
          cellClassName={mergeClassNames(
            getTableCellClass(rowCount, midIndex),
            cellBackGroundColor,
            getTodayDateCellClass(periodStart)
          )}
          onCellClick={openDrilldown}
          style={cellWidthStyle}
        />
      );
    }

    return (
      <ResourceTableCell
        type="default"
        title={title}
        cellClassName={mergeClassNames(
          getTableCellClass(rowCount, midIndex),
          cellBackGroundColor,
          getTodayDateCellClass(periodStart)
        )}
        value="-"
        onCellClick={openDrilldown}
        style={cellWidthStyle}
      />
    );
  }

  return (
    <ResourceTableCell
      type="default"
      title={title}
      cellClassName={mergeClassNames(
        getTableCellClass(rowCount, midIndex),
        cellBackGroundColor,
        getTodayDateCellClass(periodStart),
        hasTentativeAllocation && "italic"
      )}
      value={displayValue}
      onCellClick={openDrilldown}
      style={cellWidthStyle}
    />
  );
};

const ResourceTeamTableCell = memo(ResourceTeamTableCellComponent);
export { ResourceTeamTableCell };
