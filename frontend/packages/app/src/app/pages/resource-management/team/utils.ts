/**
 * Internal dependencies.
 */

import { ResourceTeam, RollupPeriod } from "../store/types";
import { normalizeRollupPeriod } from "../utils/rollup";

export const createFilter = (teamContextState: ResourceTeam) => {
  return {
    employeeName: teamContextState?.filters?.employeeName ?? "",
    businessUnit: teamContextState?.filters?.businessUnit ?? [],
    department: teamContextState?.filters?.department ?? [],
    reportingManager: teamContextState?.filters?.reportingManager ?? "",
    designation: teamContextState?.filters?.designation ?? [],
    userGroup: teamContextState?.filters?.userGroup ?? [],
    branch: teamContextState?.filters?.branch ?? [],
    roles: teamContextState?.filters?.roles ?? [],
    allocationType: teamContextState?.filters?.allocationType ?? [],
    skillSearch: teamContextState?.filters?.skillSearch ?? [],
    groupBy: teamContextState?.filters?.groupBy ?? "employee",
    view: teamContextState?.tableView?.view ?? "planned-vs-capacity",
    combineWeekHours: teamContextState?.tableView?.combineWeekHours ?? false,
    rollupPeriod: normalizeRollupPeriod(
      teamContextState?.tableView?.rollupPeriod,
      teamContextState?.tableView?.combineWeekHours
    ) as RollupPeriod,
  };
};
