/**
 * External dependencies
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, startOfMonth, startOfWeek, endOfWeek, subDays } from "date-fns";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Calendar,
  Checkbox,
  ComboBox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
  useToast,
  TextArea,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@next-pms/design-system/components";
import { getFormatedDate, getUTCDateTime, prettyDate } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { useFrappeGetCall, useFrappePostCall, type FrappeError } from "frappe-react-sdk";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Inbox,
  LoaderCircle,
  AlertTriangle,
  Pencil,
  RotateCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
/**
 * Internal dependencies
 */
import { BillableIndicator } from "@/app/components/timesheet-billable/billableIndicator";
import { TimePickerField } from "@/app/components/timesheet-input/timePickerField";
import { MarkdownContent } from "@/app/components/timesheet-description/markdownContent";
import { TEAM } from "@/lib/constant";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type QueueEntry = {
  name: string;
  parent: string;
  task_subject: string;
  activity_type?: string;
  project_name?: string | null;
  date: string;
  from_time?: string | null;
  to_time?: string | null;
  hours: number;
  description?: string;
  is_billable?: boolean | number;
  entry_status: string;
  has_overlap?: boolean;
  overlaps_with?: Array<{
    name: string;
    parent: string;
    label: string;
    from_time: string;
    to_time: string;
  }>;
};

type QueueSheet = {
  employee: string;
  employee_name: string;
  employee_image?: string | null;
  designation?: string | null;
  department?: string | null;
  week_start: string;
  week_end: string;
  weekly_status: string;
  total_hours: number;
  pending_hours: number;
  pending_entry_count: number;
  timesheets: Array<{
    name: string;
    date: string;
    status: string;
    total_hours: number;
    pending_hours: number;
    entries: QueueEntry[];
  }>;
};

type RejectTarget =
  | { type: "entry"; names: string[]; label: string }
  | { type: "sheet"; employee: string; from: string; to: string; label: string };

const STAGE_LABEL: Record<string, { label: string; variant: "warning" | "secondary" | "success" }> = {
  "Approval Pending": { label: "Awaiting Line Manager", variant: "warning" },
  "Pending HR Approval": { label: "Awaiting HR", variant: "secondary" },
  "Partially Approved": { label: "Partially Approved", variant: "secondary" },
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);

const getClockTime = (value?: string | null) => {
  if (!value) return "";
  const time = value.split(" ")[1];
  return time ? time.slice(0, 5) : "";
};

/** Flatten every entry of an employee, newest date first, so they render as one table. */
const flattenEntries = (sheet: QueueSheet) =>
  sheet.timesheets
    .flatMap((timesheet) => timesheet.entries.map((entry) => ({ ...entry, date: entry.date || timesheet.date })))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.from_time ?? "").localeCompare(b.from_time ?? ""));

const StatTile = ({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string | number }) => (
  <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
      <Icon className="size-4 text-muted-foreground" />
    </span>
    <div className="min-w-0">
      <Typography variant="h5" className="leading-tight">
        {value}
      </Typography>
      <Typography variant="small" className="text-muted-foreground">
        {label}
      </Typography>
    </div>
  </div>
);

const ApprovalQueue = () => {
  const { toast } = useToast();
  const today = new Date();
  const [range, setRange] = useState<{ from: string; to: string }>({
    from: getFormatedDate(startOfWeek(today, { weekStartsOn: 1 })),
    to: getFormatedDate(endOfWeek(today, { weekStartsOn: 1 })),
  });
  const [isRangeOpen, setIsRangeOpen] = useState(false);
  const [employeeName, setEmployeeName] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [collapsedSheets, setCollapsedSheets] = useState<string[]>([]);
  const [editingEntry, setEditingEntry] = useState<QueueEntry | null>(null);
  const [editForm, setEditForm] = useState({
    date: "",
    from: "",
    to: "",
    description: "",
    reason: "",
  });

  const { call: approveEntry } = useFrappePostCall("next_pms.timesheet.api.approval_queue.approve_or_reject_entry");
  const { call: approveEntries } = useFrappePostCall("next_pms.timesheet.api.approval_queue.approve_or_reject_entries");
  const { call: approveSheet } = useFrappePostCall("next_pms.timesheet.api.approval_queue.approve_or_reject_sheet");
  const { call: updateEntry } = useFrappePostCall(
    "next_pms.timesheet.api.approval_queue.update_entry_as_approver"
  );

  const { data, isLoading, isValidating, mutate } = useFrappeGetCall(
    "next_pms.timesheet.api.approval_queue.get_approval_queue",
    {
      from_date: range.from,
      to_date: range.to,
      employee_name: employeeName || undefined,
      project: selectedProjects.length ? selectedProjects : undefined,
      user_group: selectedGroups.length ? selectedGroups : undefined,
    }
  );

  const { data: projects } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Project",
    fields: ["name", "project_name"],
    filters: window.frappe?.boot?.global_filters?.project,
    limit_page_length: "null",
  });

  const { data: userGroups } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "User Group",
    fields: ["name"],
    limit_page_length: "null",
  });

  const queue = data?.message as
    | {
        items: QueueSheet[];
        total_pending_entries: number;
        total_count: number;
        week_start: string;
        week_end: string;
      }
    | undefined;

  const rangeLabel = `${prettyDate(range.from).date} - ${prettyDate(range.to).date}`;
  const rangeDays = useMemo(
    () => Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1,
    [range]
  );

  const shiftRange = (direction: -1 | 1) => {
    const shift = direction === -1 ? subDays : addDays;
    setRange({
      from: getFormatedDate(shift(new Date(range.from), rangeDays)),
      to: getFormatedDate(shift(new Date(range.to), rangeDays)),
    });
  };

  const applyPreset = (preset: "this-week" | "last-week" | "this-month" | "last-30") => {
    const now = new Date();
    if (preset === "this-week") {
      setRange({
        from: getFormatedDate(startOfWeek(now, { weekStartsOn: 1 })),
        to: getFormatedDate(endOfWeek(now, { weekStartsOn: 1 })),
      });
    } else if (preset === "last-week") {
      const lastWeek = subDays(now, 7);
      setRange({
        from: getFormatedDate(startOfWeek(lastWeek, { weekStartsOn: 1 })),
        to: getFormatedDate(endOfWeek(lastWeek, { weekStartsOn: 1 })),
      });
    } else if (preset === "this-month") {
      setRange({ from: getFormatedDate(startOfMonth(now)), to: getFormatedDate(endOfMonth(now)) });
    } else {
      setRange({ from: getFormatedDate(subDays(now, 29)), to: getFormatedDate(now) });
    }
    setIsRangeOpen(false);
  };

  const pendingHours = useMemo(
    () => (queue?.items ?? []).reduce((sum, sheet) => sum + (sheet.pending_hours ?? 0), 0),
    [queue]
  );

  const allEntryNames = useMemo(
    () => (queue?.items ?? []).flatMap((sheet) => sheet.timesheets.flatMap((ts) => ts.entries.map((e) => e.name))),
    [queue]
  );
  const overlappingEntryNames = useMemo(
    () =>
      new Set(
        (queue?.items ?? []).flatMap((sheet) =>
          sheet.timesheets.flatMap((timesheet) =>
            timesheet.entries.filter((entry) => entry.has_overlap).map((entry) => entry.name)
          )
        )
      ),
    [queue]
  );
  const selectedHasOverlap = selectedEntries.some((name) => overlappingEntryNames.has(name));

  // Drop stale selections whenever the queue payload changes.
  useEffect(() => {
    setSelectedEntries((prev) => prev.filter((name) => allEntryNames.includes(name)));
  }, [allEntryNames]);

  const isFiltered = Boolean(employeeName) || selectedProjects.length > 0 || selectedGroups.length > 0;

  const toggleEntry = (name: string) =>
    setSelectedEntries((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));

  const toggleMany = (names: string[], checked: boolean) =>
    setSelectedEntries((prev) =>
      checked ? Array.from(new Set([...prev, ...names])) : prev.filter((name) => !names.includes(name))
    );

  const toggleSheetCollapse = (key: string) =>
    setCollapsedSheets((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));

  const runEntryAction = useCallback(
    async (entryName: string, status: "Approved" | "Rejected", note = "") => {
      setActionLoading(entryName);
      try {
        const res = await approveEntry({ name: entryName, status, note });
        toast({ variant: "success", description: res.message });
        mutate();
      } catch (err) {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(err as FrappeError) });
      } finally {
        setActionLoading(null);
      }
    },
    [approveEntry, mutate, toast]
  );

  const runBulkEntryAction = useCallback(
    async (names: string[], status: "Approved" | "Rejected", note = "") => {
      setActionLoading("bulk");
      try {
        const res = await approveEntries({ names, status, note });
        toast({ variant: "success", description: res.message });
        setSelectedEntries([]);
        mutate();
      } catch (err) {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(err as FrappeError) });
      } finally {
        setActionLoading(null);
      }
    },
    [approveEntries, mutate, toast]
  );

  const runSheetAction = useCallback(
    async (
      employee: string,
      from: string,
      to: string,
      status: "Approved" | "Rejected",
      note = ""
    ) => {
      const key = `${employee}-${from}`;
      setActionLoading(key);
      try {
        const res = await approveSheet({
          employee,
          week_start: from,
          from_date: from,
          to_date: to,
          status,
          note,
          project: selectedProjects.length ? selectedProjects : undefined,
        });
        toast({ variant: "success", description: res.message });
        mutate();
      } catch (err) {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(err as FrappeError) });
      } finally {
        setActionLoading(null);
      }
    },
    [approveSheet, mutate, selectedProjects, toast]
  );

  const handleRejectConfirm = async () => {
    if (!rejectTarget || !rejectComment.trim()) {
      toast({ variant: "destructive", description: "A rejection comment is required." });
      return;
    }
    const note = rejectComment.trim();
    if (rejectTarget.type === "entry") {
      if (rejectTarget.names.length === 1) {
        await runEntryAction(rejectTarget.names[0], "Rejected", note);
      } else {
        await runBulkEntryAction(rejectTarget.names, "Rejected", note);
      }
    } else {
      await runSheetAction(rejectTarget.employee, rejectTarget.from, rejectTarget.to, "Rejected", note);
    }
    setRejectTarget(null);
    setRejectComment("");
  };

  const openEntryEditor = (entry: QueueEntry) => {
    setEditingEntry(entry);
    setEditForm({
      date: entry.date,
      from: getClockTime(entry.from_time),
      to: getClockTime(entry.to_time),
      description: entry.description ?? "",
      reason: "",
    });
  };

  const handleEntryUpdate = async () => {
    if (!editingEntry || !editForm.date || !editForm.from || !editForm.to || !editForm.reason.trim()) {
      toast({ variant: "destructive", description: "Date, time range, and correction reason are required." });
      return;
    }
    setActionLoading("edit");
    try {
      const res = await updateEntry({
        name: editingEntry.name,
        from_time: `${editForm.date} ${editForm.from}:00`,
        to_time: `${editForm.date} ${editForm.to}:00`,
        description: editForm.description,
        edit_reason: editForm.reason.trim(),
      });
      toast({ variant: "success", description: res.message });
      setEditingEntry(null);
      mutate();
    } catch (err) {
      toast({ variant: "destructive", description: parseFrappeErrorMsg(err as FrappeError) });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Page header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" title="Back to Team">
              <NavLink to={TEAM}>
                <ArrowLeft className="size-4" />
              </NavLink>
            </Button>
            <div>
              <Typography variant="h4" className="leading-tight">
                Approval Queue
              </Typography>
              <Typography variant="small" className="text-muted-foreground">
                Review and action pending time entries
              </Typography>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isValidating} className="gap-2">
            <RotateCw className={mergeClassNames("size-4", isValidating && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Stats */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile icon={ClipboardCheck} label="Pending entries" value={queue?.total_pending_entries ?? 0} />
            <StatTile icon={Users} label="People awaiting action" value={queue?.total_count ?? 0} />
            <StatTile icon={Clock} label="Pending hours" value={`${floatToTime(pendingHours)}h`} />
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-lg border border-border bg-card">
              <Button variant="ghost" size="icon" className="rounded-r-none" title="Previous period" onClick={() => shiftRange(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Popover open={isRangeOpen} onOpenChange={setIsRangeOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="gap-2 rounded-none border-x border-border px-3">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    <Typography variant="small" className="font-medium">
                      {rangeLabel}
                    </Typography>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="z-[1000] w-auto p-0">
                  <div className="flex flex-wrap gap-1 border-b border-border p-2">
                    <Button variant="ghost" size="sm" onClick={() => applyPreset("this-week")}>
                      This week
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => applyPreset("last-week")}>
                      Last week
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => applyPreset("this-month")}>
                      This month
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => applyPreset("last-30")}>
                      Last 30 days
                    </Button>
                  </div>
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    defaultMonth={getUTCDateTime(range.from) as Date}
                    selected={{
                      from: getUTCDateTime(range.from) as Date,
                      to: getUTCDateTime(range.to) as Date,
                    }}
                    onSelect={(selected: { from?: Date; to?: Date } | undefined) => {
                      if (!selected?.from) return;
                      setRange({
                        from: getFormatedDate(selected.from),
                        to: getFormatedDate(selected.to ?? selected.from),
                      });
                      if (selected.to) setIsRangeOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="icon" className="rounded-l-none" title="Next period" onClick={() => shiftRange(1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search person"
                value={employeeName}
                onChange={(event) => setEmployeeName(event.target.value)}
                className="w-52 pl-9"
              />
            </div>
            <ComboBox
              label="Project"
              showSelected
              shouldFilter
              value={selectedProjects}
              onSelect={(value) => setSelectedProjects(value instanceof Array ? value : [value])}
              data={
                projects?.message?.map((item: { name: string; project_name: string }) => ({
                  label: item.project_name,
                  value: item.name,
                  disabled: false,
                })) ?? []
              }
              rightIcon={<Search className="size-4 stroke-slate-400" />}
              className="min-w-44"
            />
            <ComboBox
              label="Employee group"
              showSelected
              shouldFilter
              value={selectedGroups}
              onSelect={(value) => setSelectedGroups(value instanceof Array ? value : [value])}
              data={
                userGroups?.message?.map((item: { name: string }) => ({
                  label: item.name,
                  value: item.name,
                  disabled: false,
                })) ?? []
              }
              rightIcon={<Users className="size-4 stroke-slate-400" />}
              className="min-w-44"
            />
            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => {
                  setEmployeeName("");
                  setSelectedProjects([]);
                  setSelectedGroups([]);
                }}
              >
                <X className="size-3.5" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="space-y-4">
              {[0, 1].map((index) => (
                <div key={index} className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : !queue?.items?.length ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Inbox className="size-5 text-muted-foreground" />
              </span>
              <Typography variant="p" className="font-medium">
                Nothing to approve
              </Typography>
              <Typography variant="small" className="max-w-sm text-center text-muted-foreground">
                {isFiltered
                  ? "No pending entries match your filters. Try clearing them or widening the date range."
                  : "There are no pending time entries in this date range."}
              </Typography>
            </div>
          ) : (
            <div className="space-y-4 pb-16">
              {queue.items.map((sheet) => {
                const sheetKey = `${sheet.employee}-${sheet.week_start}`;
                const isCollapsed = collapsedSheets.includes(sheetKey);
                const entries = flattenEntries(sheet);
                const entryNames = entries.map((entry) => entry.name);
                const sheetHasOverlap = entries.some((entry) => entry.has_overlap);
                const allSheetSelected =
                  entryNames.length > 0 && entryNames.every((name) => selectedEntries.includes(name));
                const stage = STAGE_LABEL[sheet.weekly_status] ?? {
                  label: sheet.weekly_status,
                  variant: "secondary" as const,
                };

                return (
                  <section key={sheetKey} className="overflow-hidden rounded-xl border border-border bg-card">
                    {/* Employee header */}
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-9">
                          {sheet.employee_image && <AvatarImage src={decodeURIComponent(sheet.employee_image)} />}
                          <AvatarFallback className="text-xs">{getInitials(sheet.employee_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Typography variant="p" className="truncate font-semibold">
                              {sheet.employee_name}
                            </Typography>
                            <Badge variant={stage.variant} className="font-medium">
                              {stage.label}
                            </Badge>
                          </div>
                          <Typography variant="small" className="truncate text-muted-foreground">
                            {[sheet.designation, sheet.department].filter(Boolean).join(" • ") || sheet.employee}
                          </Typography>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="gap-1 border-border font-medium">
                          <Clock className="size-3" />
                          {floatToTime(sheet.pending_hours ?? 0)}h
                        </Badge>
                        <Badge variant="outline" className="border-border font-medium">
                          {sheet.pending_entry_count} {sheet.pending_entry_count === 1 ? "entry" : "entries"}
                        </Badge>
                        <Button
                          variant="success"
                          size="sm"
                          disabled={actionLoading === sheetKey || sheetHasOverlap}
                          title={sheetHasOverlap ? "Fix overlapping entries before approving" : "Approve all entries"}
                          onClick={() => runSheetAction(sheet.employee, sheet.week_start, sheet.week_end, "Approved")}
                        >
                          {actionLoading === sheetKey ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                          Approve all
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            setRejectTarget({
                              type: "sheet",
                              employee: sheet.employee,
                              from: sheet.week_start,
                              to: sheet.week_end,
                              label: `all of ${sheet.employee_name}'s ${sheet.pending_entry_count} entries`,
                            })
                          }
                        >
                          <X className="size-4" />
                          Reject all
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={isCollapsed ? "Expand" : "Collapse"}
                          onClick={() => toggleSheetCollapse(sheetKey)}
                        >
                          <ChevronDown
                            className={mergeClassNames("size-4 transition-transform", isCollapsed && "-rotate-90")}
                          />
                        </Button>
                      </div>
                    </header>

                    {/* Entry table */}
                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-10 pl-4">
                              <Checkbox
                                checked={allSheetSelected}
                                onCheckedChange={(checked) => toggleMany(entryNames, Boolean(checked))}
                                title="Select all"
                              />
                            </TableHead>
                            <TableHead className="w-32">Date</TableHead>
                            <TableHead className="min-w-44">Task / Activity</TableHead>
                            <TableHead className="min-w-36">Project</TableHead>
                            <TableHead className="w-28">Time</TableHead>
                            <TableHead className="w-20 text-right">Duration</TableHead>
                            <TableHead className="w-24">Billable</TableHead>
                            <TableHead className="min-w-52">Notes</TableHead>
                            <TableHead className="w-24 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entries.map((entry) => {
                            const isSelected = selectedEntries.includes(entry.name);
                            const pretty = prettyDate(entry.date);
                            const timeRange =
                              getClockTime(entry.from_time) && entry.to_time
                                ? `${getClockTime(entry.from_time)} - ${getClockTime(entry.to_time)}`
                                : "—";
                            return (
                              <TableRow
                                key={entry.name}
                                data-state={isSelected ? "selected" : undefined}
                                className={mergeClassNames(
                                  "align-top",
                                  entry.has_overlap &&
                                    "border-l-2 border-l-destructive bg-destructive/5 hover:bg-destructive/10"
                                )}
                              >
                                <TableCell className="pl-4 pt-3">
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleEntry(entry.name)}
                                  />
                                </TableCell>
                                <TableCell className="whitespace-nowrap pt-3">
                                  <Typography variant="small" className="font-medium">
                                    {pretty.day}, {pretty.date}
                                  </Typography>
                                  {entry.has_overlap && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge
                                          variant="destructive"
                                          className="mt-1 cursor-help gap-1 px-1.5 py-0 text-[0.65rem]"
                                        >
                                          <AlertTriangle className="size-3" />
                                          Overlap
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <p className="mb-1 font-medium">Conflicts with:</p>
                                        {(entry.overlaps_with ?? []).map((conflict) => (
                                          <p key={conflict.name}>
                                            {conflict.label}: {getClockTime(conflict.from_time)}–
                                            {getClockTime(conflict.to_time)}
                                          </p>
                                        ))}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </TableCell>
                                <TableCell className="pt-3">
                                  <Typography variant="small" className="font-medium">
                                    {entry.task_subject || entry.activity_type || "Untitled entry"}
                                  </Typography>
                                </TableCell>
                                <TableCell className="pt-3">
                                  <Typography variant="small" className="text-muted-foreground">
                                    {entry.project_name || "No project"}
                                  </Typography>
                                </TableCell>
                                <TableCell className="whitespace-nowrap pt-3">
                                  <Typography variant="small" className="tabular-nums text-muted-foreground">
                                    {timeRange}
                                  </Typography>
                                </TableCell>
                                <TableCell className="pt-3 text-right">
                                  <Typography variant="small" className="font-semibold tabular-nums">
                                    {floatToTime(entry.hours)}
                                  </Typography>
                                </TableCell>
                                <TableCell className="pt-3">
                                  <BillableIndicator entries={[{ is_billable: entry.is_billable }]} compact />
                                </TableCell>
                                <TableCell className="pt-2">
                                  {entry.description && entry.description !== "-" ? (
                                    <div className="text-sm text-foreground/80">
                                      <MarkdownContent value={entry.description} />
                                    </div>
                                  ) : (
                                    <Typography variant="small" className="text-muted-foreground">
                                      —
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell className="pt-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className={mergeClassNames(
                                            "size-8 text-muted-foreground hover:bg-primary/10 hover:text-primary",
                                            entry.has_overlap && "text-destructive"
                                          )}
                                          onClick={() => openEntryEditor(entry)}
                                        >
                                          <Pencil className="size-3.5" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {entry.has_overlap ? "Fix overlapping entry" : "Edit entry"}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="size-8 text-muted-foreground hover:bg-success/10 hover:text-success"
                                          disabled={actionLoading === entry.name || entry.has_overlap}
                                          onClick={() => runEntryAction(entry.name, "Approved")}
                                        >
                                          {actionLoading === entry.name ? (
                                            <LoaderCircle className="size-4 animate-spin" />
                                          ) : (
                                            <Check className="size-4" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {entry.has_overlap ? "Fix the overlap before approving" : "Approve entry"}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                          onClick={() =>
                                            setRejectTarget({
                                              type: "entry",
                                              names: [entry.name],
                                              label: entry.task_subject || "this entry",
                                            })
                                          }
                                        >
                                          <X className="size-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Reject entry</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Bulk action bar */}
        {selectedEntries.length > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
            <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-popover px-4 py-2 shadow-lg">
              <Typography variant="small" className="font-medium">
                {selectedEntries.length} selected
              </Typography>
              {selectedHasOverlap && (
                <Typography variant="small" className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="size-3.5" />
                  Fix overlap first
                </Typography>
              )}
              <Button
                variant="success"
                size="sm"
                disabled={actionLoading === "bulk" || selectedHasOverlap}
                title={selectedHasOverlap ? "Fix overlapping entries before approving" : "Approve selected entries"}
                onClick={() => runBulkEntryAction(selectedEntries, "Approved")}
              >
                {actionLoading === "bulk" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  setRejectTarget({
                    type: "entry",
                    names: selectedEntries,
                    label: `${selectedEntries.length} selected entries`,
                  })
                }
              >
                <X className="size-4" />
                Reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedEntries([])}>
                Clear
              </Button>
            </div>
          </div>
        )}

        <Dialog open={Boolean(editingEntry)} onOpenChange={(open) => !open && setEditingEntry(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingEntry?.has_overlap ? "Fix overlapping time entry" : "Edit time entry"}
              </DialogTitle>
              <DialogDescription>
                Line Manager and HR corrections are recorded in the Timesheet comments and version history.
              </DialogDescription>
            </DialogHeader>
            {editingEntry?.has_overlap && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="size-4" />
                  This entry overlaps another time entry
                </div>
                {(editingEntry.overlaps_with ?? []).map((conflict) => (
                  <p key={conflict.name} className="text-muted-foreground">
                    {conflict.label}: {getClockTime(conflict.from_time)}–{getClockTime(conflict.to_time)}
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Date</label>
                <Input
                  type="date"
                  value={editForm.date}
                  onChange={(event) => setEditForm((current) => ({ ...current, date: event.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">From Time</label>
                  <TimePickerField
                    className="h-10"
                    value={editForm.from}
                    onChange={(value) => setEditForm((current) => ({ ...current, from: value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">To Time</label>
                  <TimePickerField
                    className="h-10"
                    value={editForm.to}
                    onChange={(value) => setEditForm((current) => ({ ...current, to: value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes</label>
                <TextArea
                  rows={3}
                  value={editForm.description}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Correction reason <span className="text-destructive">*</span>
                </label>
                <TextArea
                  rows={2}
                  placeholder="Explain why this entry was corrected"
                  value={editForm.reason}
                  onChange={(event) => setEditForm((current) => ({ ...current, reason: event.target.value }))}
                />
                <Typography variant="small" className="text-muted-foreground">
                  This reason appears in the permanent audit trail.
                </Typography>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingEntry(null)} disabled={actionLoading === "edit"}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleEntryUpdate()}
                disabled={
                  actionLoading === "edit" ||
                  !editForm.date ||
                  !editForm.from ||
                  !editForm.to ||
                  !editForm.reason.trim()
                }
              >
                {actionLoading === "edit" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Pencil className="size-4" />
                )}
                Save correction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(rejectTarget)}
          onOpenChange={(open) => {
            if (!open) {
              setRejectTarget(null);
              setRejectComment("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject {rejectTarget?.label}</DialogTitle>
              <DialogDescription>
                The employee is notified with your comment and the entries return to draft so they can be fixed.
              </DialogDescription>
            </DialogHeader>
            <TextArea
              rows={4}
              autoFocus
              placeholder="What needs to change before this can be approved?"
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectComment("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleRejectConfirm()}
                disabled={!rejectComment.trim() || actionLoading !== null}
              >
                {actionLoading !== null ? <LoaderCircle className="size-4 animate-spin" /> : <X className="size-4" />}
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default ApprovalQueue;
