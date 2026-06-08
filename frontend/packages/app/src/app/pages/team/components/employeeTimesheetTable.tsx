/**
 * External dependencies.
 */
import { Spinner } from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
/**
 * Internal dependencies.
 */
import { TimesheetTable } from "@/app/components/timesheet-table";
import type { WorkingFrequency } from "@/types";
import type { EmployeeTimesheerTableProps } from "./types";

export const EmployeeTimesheetTable = ({ employee, teamState }: EmployeeTimesheerTableProps) => {
  const { data, isLoading } = useFrappeGetCall("next_pms.timesheet.api.timesheet.get_timesheet_data", {
    employee: employee,
    start_date: teamState.weekDate,
    max_week: 1,
  });

  if (isLoading) {
    return <Spinner />;
  }

  const weekKey = Object.keys(data?.message.data ?? {})[0];
  const timesheetData = data?.message.data[weekKey];

  if (!timesheetData) {
    return null;
  }

  return (
    <div className="w-full">
      <TimesheetTable
        dates={timesheetData.dates}
        holidays={data?.message.holidays ?? []}
        leaves={data?.message.leaves ?? []}
        tasks={timesheetData.tasks}
        onCellClick={() => {}}
        disabled
        showHeading
        workingHour={data?.message.working_hour}
        workingFrequency={data?.message.working_frequency as WorkingFrequency}
        weeklyStatus={timesheetData.status}
        hideLikeButton
        employee={employee}
        enableInlineEdit={false}
      />
    </div>
  );
};
