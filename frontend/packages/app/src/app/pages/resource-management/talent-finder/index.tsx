/**
 * External dependencies.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Spinner, Typography } from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Search } from "lucide-react";

/**
 * Internal dependencies.
 */
import CustomViewWrapper from "@/app/components/customViewWrapper";
import { Header as RootHeader } from "@/app/layout/root";
import type { ViewData } from "@/store/view";
import { BooleanSkillQueryBuilder } from "./components/booleanSkillQueryBuilder";
import { TalentFinderHeader } from "./components/talentFinderHeader";
import { TalentResultsTable } from "./components/talentResultsTable";
import type { TalentFinderFilters, TalentSearchResponse } from "./types";
import { createFilter } from "./utils";

const TalentFinderView = () => (
  <CustomViewWrapper label="ResourceTalentFinder" createFilter={createFilter()}>
    {({ viewData }) => <TalentFinderViewComponent viewData={viewData} />}
  </CustomViewWrapper>
);

const TalentFinderViewComponent = ({ viewData }: { viewData: ViewData }) => {
  const [filters, setFilters] = useState<TalentFinderFilters>(() => createFilter(viewData.filters));
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    setFilters(createFilter(viewData.filters));
  }, [viewData]);

  const apiArgs = useMemo(
    () => ({
      skill_query: JSON.stringify(filters.skillQuery),
      branch: JSON.stringify(filters.branch ?? []),
      languages: JSON.stringify(filters.languages ?? []),
      timezones: JSON.stringify(filters.timezones ?? []),
      min_bill_rate: filters.minBillRate ?? 0,
      max_bill_rate: filters.maxBillRate ?? 0,
      availability_from: filters.availabilityFrom,
      availability_to: filters.availabilityTo,
      min_available_hours: filters.minAvailableHours ?? 0,
      min_availability_pct: filters.minAvailabilityPct ?? 0,
      department: JSON.stringify(filters.department ?? []),
      designation: JSON.stringify(filters.designation ?? []),
      user_group: JSON.stringify(filters.userGroup ?? []),
      roles: JSON.stringify(filters.roles ?? []),
      employee_name: filters.employeeName ?? "",
      page_length: 100,
      start: 0,
    }),
    [filters]
  );

  const { data, isLoading, isValidating, mutate } = useFrappeGetCall(
    hasSearched ? "next_pms.resource_management.api.talent_search.search_talent" : null,
    hasSearched ? apiArgs : undefined
  );

  const response = data?.message as TalentSearchResponse | undefined;

  const runSearch = () => {
    setHasSearched(true);
    mutate();
  };

  return (
    <div className="flex h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Typography variant="h5">Talent Finder</Typography>
            <Typography variant="small" className="text-muted-foreground">
              Boolean skill search with availability and fit scoring
            </Typography>
          </div>
          <Button onClick={runSearch} disabled={isLoading || isValidating}>
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </div>
      </RootHeader>

      <TalentFinderHeader
        filters={filters}
        viewData={viewData}
        onChange={(updated) => setFilters((prev) => ({ ...prev, ...updated }))}
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        <div className="rounded-lg border p-4">
          <Typography variant="p" className="font-medium mb-3">
            Skill query
          </Typography>
          <BooleanSkillQueryBuilder
            value={filters.skillQuery}
            onChange={(skillQuery) => setFilters((prev) => ({ ...prev, skillQuery }))}
          />
        </div>

        {!hasSearched ? (
          <Typography variant="p" className="text-muted-foreground">
            Configure filters and skill groups, then run search. Results are ranked by fit score.
          </Typography>
        ) : isLoading || isValidating ? (
          <Spinner isFull />
        ) : response ? (
          <>
            <Typography variant="small" className="text-muted-foreground">
              {response.total_count} matches · availability {response.availability_from} to {response.availability_to}
            </Typography>
            <TalentResultsTable results={response.results} />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default TalentFinderView;
