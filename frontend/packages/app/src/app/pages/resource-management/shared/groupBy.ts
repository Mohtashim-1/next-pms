import type { ResourceAllocationEmployeeProps } from "../timeline/types";

export type ResourceGroupByDimension =
  | "employee"
  | "department"
  | "designation"
  | "business_unit"
  | "team"
  | "location"
  | "role"
  | "skill"
  | "project";

export type TimelineDisplayGroup = ResourceAllocationEmployeeProps & {
  id: string;
  title: string;
  isGroupHeader?: boolean;
  parent?: string;
  root?: boolean;
};

const GROUP_LABELS: Record<ResourceGroupByDimension, string> = {
  employee: "Employee",
  department: "Department",
  designation: "Designation",
  business_unit: "Business Unit",
  team: "Team",
  location: "Location",
  role: "Role",
  skill: "Skill",
  project: "Project",
};

export const getGroupByLabel = (dimension: ResourceGroupByDimension) => GROUP_LABELS[dimension] ?? "Employee";

const getGroupKey = (employee: ResourceAllocationEmployeeProps, dimension: ResourceGroupByDimension) => {
  switch (dimension) {
    case "department":
      return employee.department || "Unassigned";
    case "designation":
      return employee.designation || "Unassigned";
    case "business_unit":
      return employee.business_unit || "Unassigned";
    case "team":
      return employee.user_group || "Unassigned";
    case "location":
      return employee.branch || "Unassigned";
    case "role":
      return employee.primary_role || "Unassigned";
    case "skill":
      return employee.primary_skill || "Unassigned";
    default:
      return employee.name;
  }
};

export const buildTimelineDisplayGroups = (
  employees: ResourceAllocationEmployeeProps[],
  groupBy: ResourceGroupByDimension = "employee"
): TimelineDisplayGroup[] => {
  if (!employees.length || groupBy === "employee") {
    return employees.map((employee) => ({
      ...employee,
      id: employee.name,
      title: employee.employee_name,
    }));
  }

  const grouped = new Map<string, ResourceAllocationEmployeeProps[]>();

  employees.forEach((employee) => {
    const key = getGroupKey(employee, groupBy);
    const bucket = grouped.get(key) ?? [];
    bucket.push(employee);
    grouped.set(key, bucket);
  });

  const displayGroups: TimelineDisplayGroup[] = [];

  Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([groupKey, members]) => {
      const parentId = `group::${groupBy}::${groupKey}`;
      displayGroups.push({
        id: parentId,
        name: parentId,
        title: groupKey,
        employee_name: groupKey,
        image: "",
        department: "",
        designation: "",
        isGroupHeader: true,
        root: true,
      });

      members
        .sort((left, right) => left.employee_name.localeCompare(right.employee_name))
        .forEach((employee) => {
          displayGroups.push({
            ...employee,
            id: employee.name,
            title: employee.employee_name,
            parent: parentId,
          });
        });
    });

  return displayGroups;
};

export const isLeafTimelineGroup = (group: TimelineDisplayGroup) => !group.isGroupHeader;
