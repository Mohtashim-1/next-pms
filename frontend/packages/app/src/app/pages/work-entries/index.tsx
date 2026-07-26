/**
 * List of the current user's individual time log entries.
 */
import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  Badge,
  Button,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { getFormatedDate, getTodayDate, getUTCDateTime, normalizeDate, prettyDate } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { addDays } from "date-fns";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Download, FileSpreadsheet, FileText, ListChecks, LoaderCircle, Search } from "lucide-react";

import { Header, Main } from "@/app/layout/root";
import { formatRangeLabel, getEntryDate } from "@/lib/timesheetTime";
import { parseFrappeErrorMsg } from "@/lib/utils";
import type { RootState } from "@/store";
import {
  exportWorkEntriesCsv,
  exportWorkEntriesExcel,
  type WorkEntryRow,
} from "./exportWorkEntries";

type WorkEntry = WorkEntryRow;

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
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageStart, setPageStart] = useState(0);
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [exporting, setExporting] = useState(false);
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

  const { call: fetchEntries } = useFrappePostCall("next_pms.timesheet.api.work_entries.get_work_entries");

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

  const rangeLabel = `${startDate}_to_${endDate}`;

  const handleExport = async (format: "excel" | "csv") => {
    if (!user.employee) {
      toast({ variant: "destructive", description: "No employee linked to your user." });
      return;
    }
    setExporting(true);
    try {
      const res = await fetchEntries({
        employee: user.employee,
        start_date: startDate,
        end_date: endDate,
        search: debouncedSearch || undefined,
        page_length: 5000,
        start: 0,
      });
      const rows = (res?.message?.data || []) as WorkEntry[];
      if (!rows.length) {
        toast({ variant: "destructive", description: "Nothing to export for this filter." });
        return;
      }
      if (format === "excel") {
        exportWorkEntriesExcel(rows, rangeLabel);
      } else {
        exportWorkEntriesCsv(rows, rangeLabel);
      }
      toast({
        variant: "success",
        description: `Exported ${rows.length} work entr${rows.length === 1 ? "y" : "ies"} as ${
          format === "excel" ? "Excel" : "CSV"
        }.`,
      });
    } catch (err) {
      toast({ variant: "destructive", description: parseFrappeErrorMsg(err as Error) });
    } finally {
      setExporting(false);
    }
  };

  const rows = entries;
  const canExport = Boolean(user.employee) && (totalCount > 0 || rows.length > 0) && !exporting;

  return (
    <>
      <Header className="justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-primary" />
          <Typography variant="h5">Work Entries</Typography>
        </div>
        <div className="flex items-center gap-3">
          <Typography variant="small" className="text-muted-foreground">
            {totalCount} entries
          </Typography>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!canExport}>
                {exporting ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                disabled={exporting}
                onClick={() => void handleExport("excel")}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export as Excel
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                disabled={exporting}
                onClick={() => void handleExport("csv")}
              >
                <FileText className="h-4 w-4" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
