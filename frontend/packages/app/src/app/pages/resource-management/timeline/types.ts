/**
 * External dependencies.
 */
import { ItemContext } from "react-calendar-timeline";
import { Moment } from "moment";

/**
 * Internal dependencies.
 */
import type { ViewData } from "@/store/view";
import { ResourceAllocationProps } from "@/types/resource_management";
import { AllocationDataProps, Skill } from "../store/types";
import type { ResourceGroupByDimension } from "../shared/groupBy";
import type { TimelineColorMode, TimelineZoomLevel } from "./timelineZoom";

interface ResourceAllocationItemProps {
  style: {
    padding: string;
    background: string;
    borderRadius: string;
    border: string;
    width: number | string;
    left: number;
    borderWidth?: number;
    borderRightWidth?: number;
    overflow?: string;
  };
}

interface ResourceAllocationTimeLineFilterProps {
  employeeName?: string;
  businessUnit?: string[];
  department?: string[];
  reportingManager?: string;
  designation?: string[];
  userGroup?: string[];
  branch?: string[];
  roles?: string[];
  allocationType?: string[];
  skillSearch?: Skill[];
  groupBy?: ResourceGroupByDimension;
  start?: number;
  page_length?: number;
  weekDate?: string;
  isShowMonth?: boolean;
  zoomLevel?: TimelineZoomLevel;
  colorMode?: TimelineColorMode;
}

interface ResourceAllocationEmployeeProps {
  name: string;
  image: string;
  employee_name: string;
  department: string;
  designation: string;
  primary_skill?: string;
  daily_working_hours?: number;
  business_unit?: string;
  user_group?: string;
  branch?: string;
  primary_role?: string;
  id?: string;
  title?: string;
  isGroupHeader?: boolean;
  parent?: string;
  root?: boolean;
}

interface ResourceAllocationCustomerProps {
  [key: string]: {
    name: string;
    abbr: string;
    image: string;
  };
}

interface ResourceAllocationTimeLineProps extends ResourceAllocationProps {
  id?: string;
  customerData: {
    name: string;
    abbr: string;
    image: string;
  };
  itemProps: ResourceAllocationItemProps;
  from_date?: string;
  to_date?: string;
  total_leave_days?: number;
  group: string;
  start_time: number;
  end_time: number;
  canDelete?: boolean;
  isShowMonth?: boolean;
  zoomLevel?: TimelineZoomLevel;
  colorMode?: TimelineColorMode;
  status?: string;
  primary_skill?: string;
  onDelete?: (
    oldData: AllocationDataProps,
    newData: AllocationDataProps
  ) => void;
  type: "allocation" | "leave" | "draft";
}

interface ResourceTimeLineDataProps {
  resource_allocations: ResourceAllocationTimeLineProps[];
  employees: ResourceAllocationEmployeeProps[];
  customer: ResourceAllocationCustomerProps;
  leaves: ResourceAllocationTimeLineProps[];
}

interface ResourceTeamAPIBodyProps {
  date?: string;
  max_week?: number;
  start?: number;
  employee_name?: string;
  page_length?: number;
  business_unit?: string;
  department?: string;
  reports_to?: string;
  designation?: string;
  user_group?: string;
  branch?: string;
  roles?: string;
  is_billable?: string;
  skills?: string;
  need_hours_summary?: boolean;
}

interface ResourceTimeLineGroupProps {
  group: ResourceAllocationEmployeeProps;
}

interface TimeLineHeaderFunctionProps {
  getIntervalProps: () => ResourceAllocationItemProps;
  intervalContext: { interval: { startTime: Moment; endTime: Moment } };
  data: { unit: string; showYear?: boolean };
}

interface ResourceTimeLineItemProps {
  item: ResourceAllocationTimeLineProps;
  itemContext: ItemContext;
  getItemProps: (
    itemProps: ResourceAllocationItemProps
  ) => ResourceAllocationItemProps;
  getResizeProps: () => { left: object; right: object };
}

interface ResourceTimeLineProps {
  handleFormSubmit: (
    oldData: ResourceAllocationTimeLineProps,
    newData: ResourceAllocationTimeLineProps
  ) => void;
}

interface ResourceTimeLineViewComponentProps {
  viewData: ViewData;
}

export type {
  ResourceAllocationCustomerProps,
  ResourceAllocationEmployeeProps,
  ResourceAllocationItemProps,
  ResourceAllocationTimeLineFilterProps,
  ResourceAllocationTimeLineProps,
  ResourceTeamAPIBodyProps,
  ResourceTimeLineDataProps,
  ResourceTimeLineGroupProps,
  TimeLineHeaderFunctionProps,
  ResourceTimeLineItemProps,
  ResourceTimeLineProps,
  ResourceTimeLineViewComponentProps,
};
