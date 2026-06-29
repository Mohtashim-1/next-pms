/**
 * List of the current user's individual time log entries.
 */
import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  Badge,
  Button,
  DatePicker,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from "@next-pms/design-system/components";
import { getFormatedDate, getTodayDate, getUTCDateTime, normalizeDate, prettyDate } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { addDays } from "date-fns";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ListChecks, Search } from "lucide-react";

import { Header, Main } from "@/app/layout/root";
import { formatRangeLabel, getEntryDate } from "@/lib/timesheetTime";
import { parseFrappeErrorMsg } from "@/lib/utils";
import type { RootState } from "@/store";

type WorkEntry = {
  name: string;
  parent: string;
  date: string;
  from_time?: string;
  to_time?: string;
  hours: number;
  activity_type?: string;
  task?: string;
  task_subject?: string;
  project?: string;
  project_name?: string;
  description?: string;
  is_billable?: boolean;
  entry_approval_status?: string;
  timesheet_status?: string;
};

const today = getTodayDate();
const defaultStart = getFormatedDate(addDays(getUTCDateTime(today), -90));

function formatEntryDate(row: WorkEntry) {
  const isoDate = getEntryDate(row.from_time, row.date);
  if (!isoDate) return "-";
  try {
    return prettyDate(normalizeDate(isoDate)).date;
  } catch {
    return isoDate;
  }
}

function statusVariant(status?: string) {
  const value = (status || "").toLowerCase();
  if (value.includes("approved")) return "default";
  if (value.includes("reject") || value.includes("draft")) return "destructive";
  if (value.includes("pending") || value.includes("processing")) return "secondary";
  return "outline";
}

function WorkEntries() {
  const user = useSelector((state: RootState) => state.user);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageStart, setPageStart] = useState(0);
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const pageLength = 50;

  const queryKey = useMemo(
    () => `${user.employee}-${startDate}-${endDate}-${debouncedSearch}-${pageStart}`,
    [user.employee, startDate, endDate, debouncedSearch, pageStart]
  );

  const { data, isLoading, error, mutate } = useFrappeGetCall(
    "next_pms.timesheet.api.work_entries.get_work_entries",
    {
      employee: user.employee,
      start_date: startDate,
      end_date: endDate,
      search: debouncedSearch || undefined,
      page_length: pageLength,
      start: pageStart,
    },
    user.employee ? queryKey : null
  );

  const response = data?.message;
  const totalCount = response?.total_count ?? 0;
  const hasMore = response?.has_more ?? false;

  useEffect(() => {
    if (!response?.data) return;
    if (pageStart === 0) {
      setEntries(response.data);
      return;
    }
    setEntries((prev) => {
      const existing = new Set(prev.map((row) => row.name));
      const next = response.data.filter((row: WorkEntry) => !existing.has(row.name));
      return [...prev, ...next];
    });
  }, [response, pageStart]);

  const applyFilters = () => {
    setDebouncedSearch(search.trim());
    setPageStart(0);
    setEntries([]);
    mutate();
  };

  const loadMore = () => {
    setPageStart((prev) => prev + pageLength);
  };

  const resetFilters = () => {
    setStartDate(defaultStart);
    setEndDate(today);
    setSearch("");
    setDebouncedSearch("");
    setPageStart(0);
    setEntries([]);
  };

  const rows = entries;

  return (
    <>
      <Header className="justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-primary" />
          <Typography variant="h5">Work Entries</Typography>
        </div>
        <Typography variant="small" className="text-muted-foreground">
          {totalCount} entries
        </Typography>
      </Header>

      <Main className="py-4 gap-4">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="space-y-1 min-w-[150px]">
            <Typography variant="small">From</Typography>
            <DatePicker
              date={startDate}
              onDateChange={(date) => {
                if (!date) return;
                setStartDate(getFormatedDate(date));
                setPageStart(0);
                setEntries([]);
              }}
            />
          </div>
          <div className="space-y-1 min-w-[150px]">
            <Typography variant="small">To</Typography>
            <DatePicker
              date={endDate}
              onDateChange={(date) => {
                if (!date) return;
                setEndDate(getFormatedDate(date));
                setPageStart(0);
                setEntries([]);
              }}
            />
          </div>
          <div className="space-y-1 min-w-[220px] flex-1">
            <Typography variant="small">Search</Typography>
            <div className="flex gap-2">
              <Input
                placeholder="Task, project, remarks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
              <Button variant="outline" onClick={applyFilters} title="Search">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button variant="ghost" onClick={resetFilters}>
            Reset
          </Button>
        </div>

        {error && (
          <Typography className="text-destructive mb-4">{parseFrappeErrorMsg(error)}</Typography>
        )}

        {isLoading && rows.length === 0 ? (
          <Spinner isFull />
        ) : rows.length === 0 ? (
          <Typography className="text-muted-foreground py-8 text-center">
            No work entries found for this period.
          </Typography>
        ) : (
          <div className="border rounded-md overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row: WorkEntry) => (
                  <TableRow key={row.name}>
                    <TableCell className="whitespace-nowrap">{formatEntryDate(row)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatRangeLabel(row.from_time, row.to_time) || "-"}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {floatToTime(row.hours)}
                    </TableCell>
                    <TableCell>{row.activity_type || "-"}</TableCell>
                    <TableCell className="max-w-[180px] truncate" title={row.task_subject}>
                      {row.task_subject || row.task || "-"}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate" title={row.project_name}>
                      {row.project_name || "-"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={row.description}>
                      {row.description || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.entry_approval_status)} className="whitespace-nowrap">
                        {row.entry_approval_status || "Pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center pt-4">
            <Button variant="outline" onClick={loadMore} disabled={isLoading}>
              {isLoading ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </Main>
    </>
  );
}

export default WorkEntries;
