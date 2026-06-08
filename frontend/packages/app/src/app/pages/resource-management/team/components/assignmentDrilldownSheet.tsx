/**
 * External dependencies.
 */
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Typography,
} from "@next-pms/design-system/components";
import { prettyDate } from "@next-pms/design-system/date";
import { Plus } from "lucide-react";
import { useContextSelector } from "use-context-selector";

/**
 * Internal dependencies.
 */
import { ResourceAllocationList } from "../../components/resource-allocation-list/resourceAllocationList";
import { ResourceFormContext } from "../../store/resourceFormContext";
import { TeamContext } from "../../store/teamContext";
import type { AllocationDataProps } from "../../store/types";
import { getIsBillableValue } from "../../utils/helper";

type AssignmentDrilldownSheetProps = {
  onSubmit: (oldData: AllocationDataProps, data: AllocationDataProps) => void;
};

export const AssignmentDrilldownSheet = ({ onSubmit }: AssignmentDrilldownSheetProps) => {
  const { drilldown, teamData, filters } = useContextSelector(TeamContext, (value) => value.state);
  const { closeAssignmentDrilldown } = useContextSelector(TeamContext, (value) => value.actions);
  const { updateAllocationData, updateDialogState } = useContextSelector(ResourceFormContext, (value) => value.actions);
  const { permission: resourceAllocationPermission } = useContextSelector(ResourceFormContext, (value) => value.state);

  if (!drilldown) {
    return null;
  }

  const periodLabel =
    drilldown.dateStart === drilldown.dateEnd
      ? prettyDate(drilldown.dateStart).date
      : `${prettyDate(drilldown.dateStart).date} – ${prettyDate(drilldown.dateEnd).date}`;

  const handleAddAllocation = () => {
    updateDialogState({ isShowDialog: true, isNeedToEdit: false });
    updateAllocationData({
      employee: drilldown.employee,
      employee_name: drilldown.employee_name,
      allocation_start_date: drilldown.dateStart,
      allocation_end_date: drilldown.dateEnd,
      is_billable: getIsBillableValue(filters.allocationType as string[]) !== "0",
      total_allocated_hours: "0",
      hours_allocated_per_day: "0",
      note: "",
      project: "",
      project_name: "",
      customer: "",
      customer_name: "",
      name: "",
      is_tentative: false,
    });
  };

  return (
    <Sheet open onOpenChange={(open) => !open && closeAssignmentDrilldown()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{drilldown.employee_name}</SheetTitle>
          <SheetDescription>{periodLabel}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="rounded-md border p-3 text-sm">
            <Typography variant="p" className="text-muted-foreground">
              Allocated / Capacity
            </Typography>
            <Typography variant="p" className="font-medium">
              {drilldown.allocatedHours}h / {drilldown.capacityHours}h
            </Typography>
          </div>

          {drilldown.allocations.length === 0 ? (
            <Typography variant="p" className="text-sm text-muted-foreground">
              No assignments in this period.
            </Typography>
          ) : (
            <ResourceAllocationList
              resourceAllocationList={drilldown.allocations}
              employeeAllocations={drilldown.employeeAllocations}
              customer={teamData.customer}
              onSubmit={onSubmit}
            />
          )}

          {resourceAllocationPermission.write && (
            <Button className="w-full" onClick={handleAddAllocation}>
              <Plus className="h-4 w-4 mr-2" />
              Add Assignment
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
