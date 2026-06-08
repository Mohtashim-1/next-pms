/**
 * External dependencies.
 */
import { useEffect, useMemo, useState } from "react";
import Timeline, { DateHeader, SidebarHeader, TimelineHeaders } from "react-calendar-timeline";
import {
  mergeClassNames,
  getDayDiff,
  getMonthYearKey,
  getTodayDate,
  getUTCDateTime,
  prettyDate,
} from "@next-pms/design-system";
import { TableHead, useToast } from "@next-pms/design-system/components";
import { TableContext } from "@next-pms/resource-management/store";
import { getFormatedStringValue } from "@next-pms/resource-management/utils";
import { startOfWeek } from "date-fns";
import { useFrappeCreateDoc, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import moment from "moment";
import { useContextSelector } from "use-context-selector";

/**
 * Internal dependencies.
 */
import type { ResourceAllocationProps } from "@/types/resource_management";
import ResourceTimeLineGroup from "./group";
import type { ResourceAllocationEmployeeProps, ResourceAllocationTimeLineProps, ResourceTimeLineProps } from "../types";
import { TimeLineDateHeader, TimeLineIntervalHeader } from "./header";
import { ResourceTimeLineItem, ItemAllocationActionDialog } from "./item";
import { ResourceFormContext } from "../../store/resourceFormContext";
import { TimeLineContext } from "../../store/timeLineContext";
import { getDayKeyOfMoment } from "../../utils/dates";
import {
  getTimelineZoomConfig,
  isWideZoom,
  normalizeColorMode,
  normalizeZoomLevel,
} from "../timelineZoom";
import { buildTimelineDisplayGroups } from "../../shared/groupBy";
import { useTimelineCanvasDrag } from "../useTimelineCanvasDrag";
import { TimelineConflictOverlay } from "./timelineConflictOverlay";
import type { AllocationConflictResult } from "../../components/allocationConflictAlert";

const DRAFT_ITEM_ID = "__timeline_draft__";

const ResourceTimeLine = ({ handleFormSubmit }: ResourceTimeLineProps) => {
  const { tableProperties } = useContextSelector(TableContext, (value) => value.state);
  const { getCellWidthString } = useContextSelector(TableContext, (value) => value.actions);
  const { employees, allocations, allocationData, filters } = useContextSelector(
    TimeLineContext,
    (value) => value.state
  );
  const { getAllocationWithID, updateAllocation, getEmployeeWithIndex, setAllocationData, getEmployeeWithID } =
    useContextSelector(TimeLineContext, (value) => value.actions);
  const { permission: resourceAllocationPermission } = useContextSelector(ResourceFormContext, (value) => value.state);

  const { updateDialogState, updateAllocationData } = useContextSelector(ResourceFormContext, (value) => value.actions);

  const [showItemAllocationActionDialog, setShowItemAllocationActionDialog] = useState(false);

  const zoomLevel = normalizeZoomLevel(filters);
  const colorMode = normalizeColorMode(filters);
  const zoomConfig = getTimelineZoomConfig(zoomLevel);
  const displayGroups = useMemo(
    () => buildTimelineDisplayGroups(employees, filters.groupBy ?? "employee"),
    [employees, filters.groupBy]
  );

  const start = startOfWeek(getTodayDate(), {
    weekStartsOn: 1,
  });

  const [visibleTimeStart, setVisibleTimeStart] = useState(start.getTime());
  const [visibleTimeEnd, setVisibleTimeEnd] = useState(start.getTime() + zoomConfig.visibleDurationMs);

  useEffect(() => {
    setVisibleTimeStart(start.getTime());
    setVisibleTimeEnd(start.getTime() + zoomConfig.visibleDurationMs);
  }, [start, zoomConfig.visibleDurationMs, zoomLevel]);

  const { createDoc: createAllocations } = useFrappeCreateDoc();
  const { updateDoc: updateAllocations } = useFrappeUpdateDoc();
  const { call: checkConflicts } = useFrappePostCall(
    "next_pms.resource_management.api.conflicts.check_allocation_conflicts"
  );

  const { toast } = useToast();

  const confirmAllocationChange = async (allocation: ResourceAllocationTimeLineProps) => {
    try {
      const response = await checkConflicts({
        employee: allocation.employee,
        allocation_start_date: allocation.allocation_start_date,
        allocation_end_date: allocation.allocation_end_date,
        hours_allocated_per_day: allocation.hours_allocated_per_day || 0,
        exclude_name: allocation.name,
      });
      const result = response.message as AllocationConflictResult;
      if (!result?.has_conflicts) {
        return true;
      }
      if (result.action === "Block") {
        toast({
          variant: "destructive",
          description: `Allocation blocked on ${result.conflicts[0]?.date}: exceeds daily capacity.`,
        });
        return false;
      }
      return window.confirm(
        `This change conflicts with existing assignments on ${result.conflicts.length} day(s). Continue anyway?`
      );
    } catch {
      return true;
    }
  };

  const openAllocationDialog = (resourceAllocation: ResourceAllocationProps) => {
    if (!resourceAllocationPermission.write) {
      return;
    }

    updateDialogState({ isShowDialog: true, isNeedToEdit: resourceAllocation.name ? true : false });

    updateAllocationData({
      employee: resourceAllocation.employee,
      employee_name: resourceAllocation.employee_name,
      project: resourceAllocation.project,
      allocation_start_date: resourceAllocation.allocation_start_date,
      allocation_end_date: resourceAllocation.allocation_end_date,
      is_billable: resourceAllocation.is_billable == 1,
      customer: resourceAllocation.customer,
      total_allocated_hours: getFormatedStringValue(resourceAllocation.total_allocated_hours),
      hours_allocated_per_day: getFormatedStringValue(resourceAllocation.hours_allocated_per_day),
      note: getFormatedStringValue(resourceAllocation.note),
      project_name: resourceAllocation.project_name,
      customer_name: resourceAllocation?.customerData ? resourceAllocation?.customerData?.name : "",
      name: resourceAllocation.name,
    });
  };

  const dragPreview = useTimelineCanvasDrag({
    enabled: resourceAllocationPermission.write,
    employees: displayGroups,
    visibleTimeStart,
    visibleTimeEnd,
    onComplete: (groupId, startDate, endDate) => {
      const employee = getEmployeeWithID(groupId);
      if (!employee) {
        return;
      }

      openAllocationDialog({
        name: "",
        employee: employee.name,
        employee_name: employee.employee_name,
        allocation_start_date: startDate,
        allocation_end_date: endDate,
        hours_allocated_per_day: 0,
        total_allocated_hours: 0,
        project: "",
        project_name: "",
        customer: "",
        is_billable: 0,
        note: "",
      });
    },
  });

  const timelineItems = useMemo(() => {
    if (!dragPreview) {
      return allocations;
    }

    const draftItem: ResourceAllocationTimeLineProps = {
      id: DRAFT_ITEM_ID,
      name: DRAFT_ITEM_ID,
      group: dragPreview.groupId,
      title: "New allocation",
      employee: dragPreview.groupId,
      employee_name: "",
      allocation_start_date: getDayKeyOfMoment(moment(Math.min(dragPreview.startTime, dragPreview.endTime))),
      allocation_end_date: getDayKeyOfMoment(moment(Math.max(dragPreview.startTime, dragPreview.endTime))),
      hours_allocated_per_day: 0,
      total_allocated_hours: 0,
      project: "",
      project_name: "",
      customer: "",
      is_billable: 0,
      note: "",
      start_time: Math.min(dragPreview.startTime, dragPreview.endTime),
      end_time: Math.max(dragPreview.startTime, dragPreview.endTime),
      customerData: { name: "", abbr: "", image: "" },
      itemProps: {
        style: {
          padding: "1px",
          background: "rgba(59, 130, 246, 0.35)",
          borderRadius: "4px",
          border: "1px dashed #3b82f6",
          width: "100%",
          left: 0,
        },
      },
      type: "draft",
      zoomLevel,
      colorMode,
    };

    return [...allocations, draftItem];
  }, [allocations, colorMode, dragPreview, zoomLevel]);

  const getVerticalLineClassNamesForTime = (startTime: number) => {
    const today = getTodayDate();
    const currentDay = getDayKeyOfMoment(moment(startTime));
    const { day } = prettyDate(getDayKeyOfMoment(moment(startTime)));

    let classNames = ["border-0"];

    if (isWideZoom(zoomLevel)) {
      const currentMonth = getMonthYearKey(getDayKeyOfMoment(moment(startTime)));
      const nextMonth = getMonthYearKey(getDayKeyOfMoment(moment(startTime).add(-1, "days")));

      if (currentMonth !== nextMonth) {
        return [" border-0 border-r border-border opacity-80"];
      }

      return classNames;
    }

    if (day == "Sun") {
      classNames = ["border-r border-border opacity-80"];
    }

    if (currentDay == today) {
      if (day == "Sat") {
        classNames = ["border-l border-border bg-accent/40 opacity-80 rct-day-6-today"];
      } else if (day == "Sun") {
        classNames = ["border-l border-border bg-accent/40 opacity-80 rct-day-0-today"];
      } else {
        classNames = ["border-l border-r border-border bg-accent/40 opacity-80"];
      }
    }

    return classNames;
  };

  const getAllocationApi = (data: ResourceAllocationTimeLineProps) => {
    const doctypeDoc = {
      employee: data.employee,
      project: data.project,
      customer: data.customer,
      total_allocated_hours: data.total_allocated_hours,
      hours_allocated_per_day: data.hours_allocated_per_day,
      allocation_start_date: data.allocation_start_date,
      allocation_end_date: data.allocation_end_date,
      is_billable: data.is_billable ? 1 : 0,
      note: data.note,
    };
    if (data.name) {
      return updateAllocations("Resource Allocation", data.name, doctypeDoc);
    }
    return createAllocations("Resource Allocation", doctypeDoc);
  };

  const updateAllocationApi = async (
    allocation: ResourceAllocationTimeLineProps,
    needsStateRefresh: boolean = true
  ) => {
    const canProceed = await confirmAllocationChange(allocation);
    if (!canProceed) {
      return;
    }

    let updatedAllocation = allocation;

    if (needsStateRefresh) {
      updatedAllocation = updateAllocation({
        ...allocation,
      });
    }

    getAllocationApi(updatedAllocation)
      .then(() => {
        if (!needsStateRefresh) {
          handleFormSubmit(
            allocationData.old as ResourceAllocationTimeLineProps,
            allocationData.new as ResourceAllocationTimeLineProps
          );
        }
        toast({
          variant: "success",
          description: "Resouce allocation updated successfully",
        });
      })
      .catch(() => {
        toast({
          variant: "destructive",
          description: "Failed to updated resource allocation",
        });
      });
  };

  const onItemMove = (itemId: string, dragTime: number, newGroupOrder: number) => {
    if (!resourceAllocationPermission.write || itemId === DRAFT_ITEM_ID) {
      return;
    }

    const allocation: ResourceAllocationTimeLineProps | undefined = getAllocationWithID(itemId);
    if (!allocation) {
      return;
    }
    const newStartData: string = getDayKeyOfMoment(moment(dragTime));
    const diffOfDays = getDayDiff(allocation.allocation_start_date, allocation.allocation_end_date);
    const newEndData: string = getDayKeyOfMoment(moment(dragTime).add(diffOfDays, "days"));
    const employee: ResourceAllocationEmployeeProps | -1 = getEmployeeWithIndex(newGroupOrder);

    if (employee == -1) {
      return;
    }

    const updatedAllocation = {
      ...allocation,
      allocation_start_date: newStartData,
      allocation_end_date: newEndData,
      start_time: getUTCDateTime(newStartData).getTime(),
      end_time: getUTCDateTime(newEndData).setDate(getUTCDateTime(newEndData).getDate() + 1),
      employee: employee.name,
      employee_name: employee.employee_name,
      group: employee.name,
    };

    if (employee.name !== allocation.employee) {
      setAllocationData({ old: allocation, new: updatedAllocation, isNeedToDelete: false });
      setShowItemAllocationActionDialog(true);
      return;
    }

    updateAllocationApi(updatedAllocation);
  };

  const onCanvasClick = (groupId: string, time: number) => {
    const employee = getEmployeeWithID(groupId);
    if (!employee) {
      return;
    }

    const date: string = getDayKeyOfMoment(moment(time));

    openAllocationDialog({
      name: "",
      employee: employee.name,
      employee_name: employee.employee_name,
      allocation_start_date: date,
      allocation_end_date: date,
      hours_allocated_per_day: 0,
      total_allocated_hours: 0,
      project: "",
      project_name: "",
      customer: "",
      is_billable: 0,
      note: "",
    });
  };

  const onItemResize = (itemId: string, time: number, edge: "left" | "right") => {
    if (!resourceAllocationPermission.write || itemId === DRAFT_ITEM_ID) {
      return;
    }

    const allocation: ResourceAllocationTimeLineProps | undefined = getAllocationWithID(itemId);

    if (!allocation) {
      return;
    }

    let newStartData = "",
      newEndData = "";

    if (edge === "left") {
      newStartData = getDayKeyOfMoment(moment(time));
      newEndData = allocation.allocation_end_date;
    } else {
      newEndData = getDayKeyOfMoment(moment(time));
      newStartData = allocation.allocation_start_date;
    }

    updateAllocationApi({
      ...allocation,
      allocation_start_date: newStartData,
      allocation_end_date: newEndData,
      start_time: getUTCDateTime(newStartData).getTime(),
      end_time: getUTCDateTime(newEndData).setDate(getUTCDateTime(newEndData).getDate() + 1),
    });
  };

  const onItemDoubleClick = (itemId: string) => {
    if (!resourceAllocationPermission.write || itemId === DRAFT_ITEM_ID) {
      return;
    }
    const allocation = getAllocationWithID(itemId);
    openAllocationDialog(allocation as ResourceAllocationProps);
  };

  const renderTimelineHeaders = () => {
    if (zoomLevel === "quarter") {
      return (
        <>
          <DateHeader
            unit="year"
            intervalRenderer={TimeLineIntervalHeader}
            headerData={{ unit: "year", showYear: true }}
          />
          <DateHeader unit="month" intervalRenderer={TimeLineIntervalHeader} headerData={{ unit: "quarter" }} />
        </>
      );
    }

    if (zoomLevel === "month") {
      return (
        <>
          <DateHeader
            unit="month"
            intervalRenderer={TimeLineIntervalHeader}
            headerData={{ unit: "month", showYear: true }}
          />
          <DateHeader unit="month" intervalRenderer={TimeLineIntervalHeader} headerData={{ unit: "month" }} />
        </>
      );
    }

    if (zoomLevel === "week") {
      return (
        <DateHeader unit="week" height={50} intervalRenderer={TimeLineIntervalHeader} headerData={{ unit: "week" }} />
      );
    }

    return (
      <>
        <DateHeader unit="week" height={30} intervalRenderer={TimeLineIntervalHeader} headerData={{ unit: "week" }} />
        <DateHeader
          style={{ width: tableProperties.cellWidth }}
          unit="day"
          height={50}
          intervalRenderer={TimeLineDateHeader}
          headerData={{ unit: "day" }}
        />
      </>
    );
  };

  if (employees.length == 0) {
    return <></>;
  }

  return (
    <>
      <TimelineConflictOverlay
        employees={employees}
        allocations={allocations}
        visibleTimeStart={visibleTimeStart}
        visibleTimeEnd={visibleTimeEnd}
      />
      <Timeline
        groups={displayGroups}
        items={timelineItems}
        sidebarWidth={tableProperties.firstCellWidth * 16}
        visibleTimeStart={visibleTimeStart}
        visibleTimeEnd={visibleTimeEnd}
        onTimeChange={(nextStart, nextEnd) => {
          setVisibleTimeStart(nextStart);
          setVisibleTimeEnd(nextEnd);
        }}
        minZoom={zoomConfig.minZoomMs}
        maxZoom={zoomConfig.maxZoomMs}
        lineHeight={50}
        itemHeightRatio={0.75}
        canMove={resourceAllocationPermission.write}
        canChangeGroup={resourceAllocationPermission.write}
        itemTouchSendsClick={false}
        stackItems={true}
        showCursorLine
        canResize={resourceAllocationPermission.write ? "both" : undefined}
        groupRenderer={ResourceTimeLineGroup}
        itemRenderer={ResourceTimeLineItem}
        verticalLineClassNamesForTime={getVerticalLineClassNamesForTime}
        onItemMove={onItemMove}
        onItemResize={onItemResize}
        onItemDoubleClick={onItemDoubleClick}
        onCanvasClick={onCanvasClick}
        className="overflow-x-auto"
      >
        <TimelineHeaders
          className="bg-muted text-foreground text-[14px] sticky z-[1000] top-0"
          calendarHeaderClassName="border-0 border-l border-inherit"
        >
          <SidebarHeader>
            {() => {
              return (
                <TableHead
                  className={mergeClassNames("flex items-center ")}
                  style={{ width: getCellWidthString(tableProperties.firstCellWidth - 0.05) }}
                >
                  Members
                </TableHead>
              );
            }}
          </SidebarHeader>
          {renderTimelineHeaders()}
        </TimelineHeaders>
      </Timeline>

      {showItemAllocationActionDialog && (
        <ItemAllocationActionDialog
          handleMove={() => {
            updateAllocationApi(allocationData.new as ResourceAllocationTimeLineProps, false);
            setShowItemAllocationActionDialog(false);
          }}
          handleCopy={() => {
            updateAllocationApi({ ...allocationData.new, name: "" } as ResourceAllocationTimeLineProps, false);
            setShowItemAllocationActionDialog(false);
          }}
          handleCancel={() => {
            setShowItemAllocationActionDialog(false);
          }}
        />
      )}
    </>
  );
};

export { ResourceTimeLine };
