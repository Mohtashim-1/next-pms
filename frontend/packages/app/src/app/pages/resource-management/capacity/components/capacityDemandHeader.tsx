/**
 * Internal dependencies.
 */
import { Header } from "@/app/components/list-view/header";
import SkillSearch from "../../team/components/skillSearch";
import { getGroupByLabel, type ResourceGroupByDimension } from "../../shared/groupBy";
import type { CapacityDemandFilters, CapacityPeriodType } from "../types";

type CapacityDemandHeaderProps = {
  filters: CapacityDemandFilters;
  onChange: (filters: Partial<CapacityDemandFilters>) => void;
};

const firstSelectValue = (value: string | string[], fallback: string) => {
  if (Array.isArray(value)) {
    return value[0] || fallback;
  }
  return value || fallback;
};

export const CapacityDemandHeader = ({ filters, onChange }: CapacityDemandHeaderProps) => {
  const sectionFilters = [
    {
      queryParameterName: "capacity-period",
      handleChange: (value: string | string[]) => {
        onChange({ period: firstSelectValue(value, "week") as CapacityPeriodType });
      },
      handleDelete: () => onChange({ period: "week" }),
      type: "select-list",
      value: [filters.period],
      shouldFilterComboBox: false,
      isMultiComboBox: false,
      label: "View",
      data: [
        { label: "Weekly", value: "week" },
        { label: "Monthly", value: "month" },
      ],
      queryParameterDefault: ["week"],
    },
    {
      queryParameterName: "capacity-group-by",
      handleChange: (value: string | string[]) => {
        onChange({ groupBy: firstSelectValue(value, "employee") });
      },
      handleDelete: () => onChange({ groupBy: "employee" }),
      type: "select-list",
      value: [filters.groupBy],
      shouldFilterComboBox: false,
      isMultiComboBox: false,
      label: "Group By",
      data: (["employee", "role", "skill", "team", "location", "department"] as ResourceGroupByDimension[]).map(
        (dimension) => ({
          label: getGroupByLabel(dimension),
          value: dimension,
        })
      ),
      queryParameterDefault: ["employee"],
    },
    {
      queryParameterName: "capacity-team",
      handleChange: (value: string | string[]) => onChange({ userGroup: value as string[] }),
      handleDelete: (value: string[] | undefined) => onChange({ userGroup: value }),
      type: "select-search",
      value: filters.userGroup,
      label: "Team",
      shouldFilterComboBox: true,
      isMultiComboBox: true,
      apiCall: {
        url: "frappe.client.get_list",
        filters: { doctype: "User Group", fields: ["name"], limit_page_length: 0 },
        options: { revalidateOnFocus: false, revalidateIfStale: false },
      },
      queryParameterDefault: filters.userGroup,
    },
    {
      queryParameterName: "capacity-location",
      handleChange: (value: string | string[]) => onChange({ branch: value as string[] }),
      handleDelete: (value: string[] | undefined) => onChange({ branch: value }),
      type: "select-search",
      value: filters.branch,
      label: "Location",
      shouldFilterComboBox: true,
      isMultiComboBox: true,
      apiCall: {
        url: "frappe.client.get_list",
        filters: { doctype: "Branch", fields: ["name"], limit_page_length: 0 },
        options: { revalidateOnFocus: false, revalidateIfStale: false },
      },
      queryParameterDefault: filters.branch,
    },
    {
      queryParameterName: "capacity-role",
      handleChange: (value: string | string[]) => onChange({ roles: value as string[] }),
      handleDelete: (value: string[] | undefined) => onChange({ roles: value }),
      type: "select-search",
      value: filters.roles,
      label: "Role",
      shouldFilterComboBox: true,
      isMultiComboBox: true,
      apiCall: {
        url: "frappe.client.get_list",
        filters: { doctype: "Role", fields: ["name"], limit_page_length: 0 },
        options: { revalidateOnFocus: false, revalidateIfStale: false },
      },
      queryParameterDefault: filters.roles,
    },
    {
      queryParameterName: "capacity-department",
      handleChange: (value: string | string[]) => onChange({ department: value as string[] }),
      handleDelete: (value: string[] | undefined) => onChange({ department: value }),
      type: "select-search",
      value: filters.department,
      label: "Department",
      shouldFilterComboBox: true,
      isMultiComboBox: true,
      apiCall: {
        url: "frappe.client.get_list",
        filters: { doctype: "Department", fields: ["name"], limit_page_length: 0 },
        options: { revalidateOnFocus: false, revalidateIfStale: false },
      },
      queryParameterDefault: filters.department,
    },
    {
      type: "custom-filter",
      queryParameterDefault: [],
      label: "Skill",
      handleDelete: (value: string[]) => {
        const operators = [">", "<", ">=", "<=", "="];
        const skillNames = value.map((entry) => {
          for (const operator of operators) {
            if (entry.includes(` ${operator} `)) {
              return entry.split(` ${operator} `)[0].trim();
            }
          }
          return entry.trim();
        });
        onChange({
          skillSearch: (filters.skillSearch ?? []).filter((obj) => skillNames.includes(obj.name)),
        });
      },
      value: filters.skillSearch?.map((obj) => obj.name + " " + obj.operator + " " + obj.proficiency * 5),
      customFilterComponent: (
        <SkillSearch
          onSubmit={(skills) => onChange({ skillSearch: skills })}
          setSkillSearchParam={(skills) => onChange({ skillSearch: skills })}
          skillSearch={filters.skillSearch ?? []}
        />
      ),
    },
  ];

  return <Header filters={sectionFilters} showFilterValue />;
};
