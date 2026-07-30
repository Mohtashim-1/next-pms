/**
 * External dependencies
 */
import { Button, Checkbox, Typography } from "@next-pms/design-system/components";
import { getDateFromDateAndTimeString, prettyDate } from "@next-pms/design-system/date";
import { floatToTime, preProcessLink } from "@next-pms/design-system/utils";
import { CircleDollarSign, PencilIcon } from "lucide-react";
/**
 * Internal dependencies
 */
import { MarkdownContent } from "@/app/components/timesheet-description/markdownContent";
import { extractTextFromHTML, mergeClassNames } from "@/lib/utils";
import type { TaskDataItemProps } from "@/types/timesheet";
import { HourInput } from "../hourInput";
import type { EmployeeTimesheetListItemProps } from "./types";

/** "2026-07-22 09:30:00" -> "09:30" */
const getClockTime = (dateTimeString?: string) => {
  if (!dateTimeString) return "";
  const time = dateTimeString.split(" ")[1];
  if (!time) return "";
  return time.slice(0, 5);
};

export const EmployeeTimesheetListItem = ({
  showCheckbox,
  isCheckboxChecked,
  isCheckboxDisabled,
  onCheckedChange,
  index,
  className,
  checkboxClassName,
  date,
  totalHours,
  isTimeExtended,
  isHoliday,
  holidayDescription,
  hasLeave,
  isHalfDayLeave,
  dailyWorkingHour,
  employee,
  tasks,
  handleTimeChange,
  onTaskClick,
  hourInputClassName,
  taskClassName,
  setIsAddTimeOpen,
  setTask,
  hideEdit = true,
}: EmployeeTimesheetListItemProps) => {
  return (
    <div key={index} className="flex flex-col">
      <div className={mergeClassNames("bg-muted rounded p-1  flex items-center gap-x-2", className)}>
        {showCheckbox && (
          <Checkbox
            checked={isCheckboxChecked}
            disabled={isCheckboxDisabled}
            className={mergeClassNames(checkboxClassName)}
            onCheckedChange={(checked) => onCheckedChange?.(date, checked)}
          />
        )}
        <Typography
          variant="p"
          className={mergeClassNames(
            "max-md:text-wrap",
            isTimeExtended == 0 && "text-destructive",
            isTimeExtended && "text-success",
            isTimeExtended == 2 && "text-warning"
          )}
        >
          {floatToTime(totalHours)}h
        </Typography>
        <Typography variant="p" className="max-md:text-wrap">
          {prettyDate(date).date}
        </Typography>
        {isHoliday && (
          <Typography variant="p" className="max-md:text-wrap text-muted-foreground">
            {extractTextFromHTML(holidayDescription ?? "")}
          </Typography>
        )}
        {hasLeave && !isHoliday && (
          <Typography variant="p" className="max-md:text-wrap text-muted-foreground">
            ({isHalfDayLeave && totalHours != dailyWorkingHour ? "Half day leave" : "Full Day Leave"})
          </Typography>
        )}
      </div>
      {tasks?.map((task: TaskDataItemProps) => {
        const data = {
          name: task.name,
          parent: task.parent,
          task: task.task,
          employee: employee,
          date: getDateFromDateAndTimeString(task.from_time),
          description: task.description,
          hours: task.hours,
          is_billable: task.is_billable,
        };
        return (
          <div
            className="flex flex-col gap-x-2 p-1 mb-2 last:mb-0 border-b w-full max-w-full last:border-b-0"
            key={task.name}
          >
            <div className="flex gap-x-3">
              <HourInput
                disabled={task.docstatus == 1}
                data={data}
                className={mergeClassNames("w-10 p-1 h-8", hourInputClassName)}
                callback={handleTimeChange}
                employee={employee}
              />
              <div className="flex gap-x-2 justify-between items-start lg:flex-row w-full ">
                <div className="items-start flex gap-1 min-w-0">
                  <div className={mergeClassNames("flex flex-col min-w-0 max-w-full", taskClassName)}>
                    <div className="flex items-center gap-1 min-w-0">
                      <Typography
                        variant="p"
                        className="max-md:text-wrap truncate text-base font-medium"
                        onClick={() => onTaskClick?.(task.name)}
                      >
                        {task.subject || task.activity_type || "-"}
                      </Typography>
                      <div
                        title={task.is_billable ? "Billable" : "Non-billable"}
                        className="flex items-center gap-1 flex-none"
                      >
                        <CircleDollarSign
                          className={mergeClassNames(
                            "size-4",
                            task.is_billable ? "stroke-success" : "stroke-muted-foreground"
                          )}
                        />
                        <Typography
                          variant="small"
                          className={mergeClassNames(
                            "font-medium",
                            task.is_billable ? "text-success" : "text-muted-foreground"
                          )}
                        >
                          {task.is_billable ? "Billable" : "Non-billable"}
                        </Typography>
                      </div>
                    </div>
                    <Typography
                      variant="small"
                      className="max-md:text-wrap shrink-0 font-medium truncate text-slate-500"
                    >
                      {[task.project_name, task.activity_type !== task.subject ? task.activity_type : null]
                        .filter(Boolean)
                        .join(" • ") || "No project"}
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      {getClockTime(task.from_time) && task.to_time
                        ? `${getClockTime(task.from_time)} - ${getClockTime(task.to_time)} • ${floatToTime(task.hours)}h`
                        : `${floatToTime(task.hours)}h`}
                    </Typography>
                  </div>
                </div>
                {/* actions */}
                <Button
                  onClick={() => {
                    setIsAddTimeOpen?.(true);
                    setTask(task);
                  }}
                  title="Edit Timesheet"
                  variant="ghost"
                  className={mergeClassNames("size-7 group", hideEdit && "hidden")}
                >
                  <PencilIcon className="size-3 text-slate-500 group-hover:text-foreground" />
                </Button>
              </div>
            </div>
            {task.description && task.description !== "-" && (
              <div
                className="text-sm font-normal max-md:text-wrap col-span-2 my-1 p-0 hover-content pl-14"
                onClick={(e) => e.stopPropagation()}
              >
                <MarkdownContent value={preProcessLink(task.description ?? "")} />
              </div>
            )}
            {task.is_billable_override && task.billable_override_reason && (
              <Typography variant="small" className="text-muted-foreground pl-14">
                Billability override: {task.billable_override_reason}
              </Typography>
            )}
          </div>
        );
      })}
      {tasks.length == 0 && (
        <Typography variant="p" className="text-center p-3 text-gray-400">
          No data
        </Typography>
      )}
    </div>
  );
};
