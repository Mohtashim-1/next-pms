/**
 * Internal dependencies.
 */

import { TimeLineContextState } from "../store/types";

export const createFilter = (timelineState: TimeLineContextState) => {
  return {
    employeeName: timelineState?.filters?.employeeName ?? "",
    businessUnit: timelineState?.filters?.businessUnit ?? [],
    department: timelineState?.filters?.department ?? [],
    reportingManager: timelineState?.filters?.reportingManager ?? "",
    designation: timelineState?.filters?.designation ?? [],
    userGroup: timelineState?.filters?.userGroup ?? [],
    branch: timelineState?.filters?.branch ?? [],
    roles: timelineState?.filters?.roles ?? [],
    allocationType: timelineState?.filters?.allocationType ?? [],
    skillSearch: timelineState?.filters?.skillSearch ?? [],
    groupBy: timelineState?.filters?.groupBy ?? "employee",
    isShowMonth: timelineState?.filters?.isShowMonth ?? false,
    zoomLevel: timelineState?.filters?.zoomLevel ?? (timelineState?.filters?.isShowMonth ? "month" : "week"),
    colorMode: timelineState?.filters?.colorMode ?? "project",
  };
};
