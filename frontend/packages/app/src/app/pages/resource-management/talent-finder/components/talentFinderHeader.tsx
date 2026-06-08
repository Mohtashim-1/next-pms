/**
 * External dependencies.
 */
import { Input, Typography } from "@next-pms/design-system/components";

/**
 * Internal dependencies.
 */
import { Header } from "@/app/components/list-view/header";
import type { ViewData } from "@/store/view";
import type { TalentFinderFilters } from "../types";
import { SavedSearchActions } from "./savedSearchActions";

type TalentFinderHeaderProps = {
  filters: TalentFinderFilters;
  onChange: (filters: Partial<TalentFinderFilters>) => void;
  viewData: ViewData;
};

export const TalentFinderHeader = ({ filters, onChange, viewData }: TalentFinderHeaderProps) => {
  const sectionFilters = [
    {
      queryParameterName: "talent-location",
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
      queryParameterName: "talent-timezone",
      handleChange: (value: string | string[]) => onChange({ timezones: value as string[] }),
      handleDelete: (value: string[] | undefined) => onChange({ timezones: value }),
      type: "select-search",
      value: filters.timezones,
      label: "Timezone",
      shouldFilterComboBox: true,
      isMultiComboBox: true,
      apiCall: {
        url: "next_pms.resource_management.api.talent_search.get_timezone_options",
        options: { revalidateOnFocus: false, revalidateIfStale: false },
      },
      queryParameterDefault: filters.timezones,
    },
    {
      queryParameterName: "talent-language",
      handleChange: (value: string | string[]) => onChange({ languages: value as string[] }),
      handleDelete: (value: string[] | undefined) => onChange({ languages: value }),
      type: "select-search",
      value: filters.languages,
      label: "Language",
      shouldFilterComboBox: true,
      isMultiComboBox: true,
      apiCall: {
        url: "frappe.client.get_list",
        filters: { doctype: "Language", fields: ["name"], limit_page_length: 0 },
        options: { revalidateOnFocus: false, revalidateIfStale: false },
      },
      queryParameterDefault: filters.languages,
    },
    {
      queryParameterName: "talent-department",
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
      queryParameterName: "talent-team",
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
  ];

  return (
    <div className="space-y-3 border-b px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Header filters={sectionFilters} showFilterValue />
        <SavedSearchActions viewData={viewData} filters={filters} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <div>
          <Typography variant="small" className="text-muted-foreground mb-1">
            Availability from
          </Typography>
          <Input
            type="date"
            value={filters.availabilityFrom}
            onChange={(event) => onChange({ availabilityFrom: event.target.value })}
          />
        </div>
        <div>
          <Typography variant="small" className="text-muted-foreground mb-1">
            Availability to
          </Typography>
          <Input
            type="date"
            value={filters.availabilityTo}
            onChange={(event) => onChange({ availabilityTo: event.target.value })}
          />
        </div>
        <div>
          <Typography variant="small" className="text-muted-foreground mb-1">
            Min available hours
          </Typography>
          <Input
            type="number"
            min={0}
            value={filters.minAvailableHours ?? ""}
            onChange={(event) =>
              onChange({
                minAvailableHours: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          />
        </div>
        <div>
          <Typography variant="small" className="text-muted-foreground mb-1">
            Min availability %
          </Typography>
          <Input
            type="number"
            min={0}
            max={100}
            value={filters.minAvailabilityPct ?? ""}
            onChange={(event) =>
              onChange({
                minAvailabilityPct: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          />
        </div>
        <div>
          <Typography variant="small" className="text-muted-foreground mb-1">
            Min bill rate
          </Typography>
          <Input
            type="number"
            min={0}
            value={filters.minBillRate ?? ""}
            onChange={(event) =>
              onChange({
                minBillRate: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          />
        </div>
        <div>
          <Typography variant="small" className="text-muted-foreground mb-1">
            Max bill rate
          </Typography>
          <Input
            type="number"
            min={0}
            value={filters.maxBillRate ?? ""}
            onChange={(event) =>
              onChange({
                maxBillRate: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          />
        </div>
      </div>
    </div>
  );
};
