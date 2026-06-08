/**
 * External dependencies.
 */
import { useState } from "react";
import {
  Button,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
} from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import { CalendarDays, List } from "lucide-react";

/**
 * Internal dependencies.
 */
import { Header as RootHeader } from "@/app/layout/root";
import { AssignmentCalendarView } from "./components/assignmentCalendarView";
import { AssignmentListView } from "./components/assignmentListView";
import { CalendarFeedCard } from "./components/calendarFeedCard";
import type { CalendarFeedSettings, PersonalAllocationsResponse } from "./types";

const PersonalAssignmentsView = () => {
  const [activeTab, setActiveTab] = useState("list");

  const { data, isLoading, error, mutate } = useFrappeGetCall(
    "next_pms.resource_management.api.personal.get_my_allocations"
  );

  const {
    data: feedData,
    isLoading: feedLoading,
    mutate: mutateFeed,
  } = useFrappeGetCall("next_pms.resource_management.api.personal.get_calendar_feed_settings");

  const response = data?.message as PersonalAllocationsResponse | undefined;
  const feedSettings = feedData?.message as CalendarFeedSettings | undefined;

  return (
    <div className="flex h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Typography variant="h5">My Assignments</Typography>
            <Typography variant="small" className="text-muted-foreground">
              Read-only personal view
              {response?.employee_name ? ` · ${response.employee_name}` : ""}
            </Typography>
          </div>
          <Button variant="outline" size="sm" className="mt-2 sm:mt-0" onClick={() => mutate()}>
            Refresh
          </Button>
        </div>
      </RootHeader>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-6xl mx-auto w-full">
        {isLoading || feedLoading ? (
          <Spinner isFull />
        ) : error ? (
          <Typography variant="p" className="text-destructive">
            Unable to load assignments. Make sure your user is linked to an Employee record.
          </Typography>
        ) : (
          <>
            {feedSettings && (
              <CalendarFeedCard settings={feedSettings} onRefresh={() => mutateFeed()} />
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 max-w-md">
                <TabsTrigger value="list" className="gap-2">
                  <List className="h-4 w-4" />
                  List
                </TabsTrigger>
                <TabsTrigger value="calendar" className="gap-2">
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="mt-4">
                <AssignmentListView
                  upcoming={response?.upcoming ?? []}
                  allocations={response?.allocations ?? []}
                />
              </TabsContent>

              <TabsContent value="calendar" className="mt-4">
                <AssignmentCalendarView allocations={response?.allocations ?? []} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
};

export default PersonalAssignmentsView;
