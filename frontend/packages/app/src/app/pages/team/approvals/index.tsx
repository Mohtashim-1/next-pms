/**
 * External dependencies
 */
import { useCallback, useMemo, useState } from "react";
import { addDays, subDays } from "date-fns";
import {
  Button,
  ComboBox,
  Input,
  Spinner,
  Typography,
  useToast,
  Separator,
  TextArea,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@next-pms/design-system/components";
import { getFormatedDate, prettyDate } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Search, X } from "lucide-react";
/**
 * Internal dependencies
 */
import { BillableIndicator } from "@/app/components/timesheet-billable/billableIndicator";
import { MarkdownContent } from "@/app/components/timesheet-description/markdownContent";
import { NavLink } from "react-router-dom";
import { TEAM } from "@/lib/constant";
import { parseFrappeErrorMsg } from "@/lib/utils";

type QueueEntry = {
  name: string;
  parent: string;
  task_subject: string;
  project_name?: string | null;
  date: string;
  hours: number;
  description?: string;
  is_billable?: boolean | number;
  entry_status: string;
};

type QueueSheet = {
  employee: string;
  employee_name: string;
  week_start: string;
  week_end: string;
  weekly_status: string;
  total_hours: number;
  pending_entry_count: number;
  timesheets: Array<{
    name: string;
    date: string;
    status: string;
    total_hours: number;
    entries: QueueEntry[];
  }>;
};

const ApprovalQueue = () => {
  const { toast } = useToast();
  const [weekDate, setWeekDate] = useState(getFormatedDate(new Date()));
  const [employeeName, setEmployeeName] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<
    | { type: "entry"; name: string }
    | { type: "sheet"; employee: string; week_start: string }
    | null
  >(null);
  const [rejectComment, setRejectComment] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { call: approveEntry } = useFrappePostCall("next_pms.timesheet.api.approval_queue.approve_or_reject_entry");
  const { call: approveSheet } = useFrappePostCall("next_pms.timesheet.api.approval_queue.approve_or_reject_sheet");

  const { data, isLoading, mutate } = useFrappeGetCall("next_pms.timesheet.api.approval_queue.get_approval_queue", {
    week_start: weekDate,
    employee_name: employeeName || undefined,
    project: selectedProjects.length ? selectedProjects : undefined,
  });

  const { data: projects } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Project",
    fields: ["name", "project_name"],
    filters: window.frappe?.boot?.global_filters?.project,
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

  const weekLabel = useMemo(() => {
    if (!queue) return "";
    return `${prettyDate(queue.week_start).date} - ${prettyDate(queue.week_end).date}`;
  }, [queue]);

  const runEntryAction = useCallback(
    async (entryName: string, status: "Approved" | "Rejected", note = "") => {
      setActionLoading(entryName);
      try {
        const res = await approveEntry({ name: entryName, status, note });
        toast({ variant: "success", description: res.message });
        mutate();
      } catch (err) {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(err as Error) });
      } finally {
        setActionLoading(null);
      }
    },
    [approveEntry, mutate, toast]
  );

  const runSheetAction = useCallback(
    async (employee: string, weekStart: string, status: "Approved" | "Rejected", note = "") => {
      const key = `${employee}-${weekStart}`;
      setActionLoading(key);
      try {
        const res = await approveSheet({
          employee,
          week_start: weekStart,
          status,
          note,
          project: selectedProjects.length ? selectedProjects : undefined,
        });
        toast({ variant: "success", description: res.message });
        mutate();
      } catch (err) {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(err as Error) });
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
    if (rejectTarget.type === "entry") {
      await runEntryAction(rejectTarget.name, "Rejected", rejectComment.trim());
    } else {
      await runSheetAction(rejectTarget.employee, rejectTarget.week_start, "Rejected", rejectComment.trim());
    }
    setRejectTarget(null);
    setRejectComment("");
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Typography variant="h4">Approval Queue</Typography>
          <Typography variant="small" className="text-muted-foreground">
            {queue?.total_pending_entries ?? 0} pending entries across {queue?.total_count ?? 0} sheets
          </Typography>
        </div>
        <NavLink to={TEAM} className="text-sm text-primary underline">
          Back to Team
        </NavLink>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekDate(getFormatedDate(subDays(new Date(weekDate), 7)))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Typography variant="p" className="min-w-40 text-center font-medium">
            {weekLabel || prettyDate(weekDate).date}
          </Typography>
          <Button variant="outline" size="icon" onClick={() => setWeekDate(getFormatedDate(addDays(new Date(weekDate), 7)))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Input
          placeholder="Filter by person"
          value={employeeName}
          onChange={(event) => setEmployeeName(event.target.value)}
          className="max-w-xs"
        />
        <ComboBox
          label="Filter by project"
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
          rightIcon={<Search className="h-4 w-4 stroke-slate-400" />}
          className="min-w-56"
        />
      </div>

      {isLoading ? (
        <Spinner isFull />
      ) : !queue?.items?.length ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border p-8">
          <Typography variant="p" className="text-muted-foreground">
            No pending approvals for this week and filter selection.
          </Typography>
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {queue.items.map((sheet) => {
            const sheetKey = `${sheet.employee}-${sheet.week_start}`;
            return (
              <div key={sheetKey} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Typography variant="p" className="font-semibold">
                      {sheet.employee_name}
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      Week {prettyDate(sheet.week_start).date} - {prettyDate(sheet.week_end).date} ·{" "}
                      {floatToTime(sheet.total_hours)} · {sheet.pending_entry_count} pending
                    </Typography>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      disabled={actionLoading === sheetKey}
                      onClick={() => runSheetAction(sheet.employee, sheet.week_start, "Approved")}
                    >
                      {actionLoading === sheetKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Approve sheet
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRejectTarget({ type: "sheet", employee: sheet.employee, week_start: sheet.week_start })}
                    >
                      <X className="h-4 w-4" />
                      Reject sheet
                    </Button>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="space-y-4">
                  {sheet.timesheets.map((timesheet) => (
                    <div key={timesheet.name} className="space-y-2">
                      <Typography variant="small" className="font-medium text-muted-foreground">
                        {prettyDate(timesheet.date).date} · {floatToTime(timesheet.total_hours)}
                      </Typography>
                      {timesheet.entries.map((entry) => (
                        <div
                          key={entry.name}
                          className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/10 p-3 md:flex-row md:items-start md:justify-between"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Typography variant="p" className="font-medium">
                                {entry.task_subject}
                              </Typography>
                              <BillableIndicator
                                entries={[{ is_billable: entry.is_billable }]}
                                compact
                              />
                              <Typography variant="small" className="text-muted-foreground">
                                {entry.project_name} · {floatToTime(entry.hours)}
                              </Typography>
                            </div>
                            {entry.description && entry.description !== "-" && (
                              <MarkdownContent value={entry.description} />
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              variant="success"
                              size="sm"
                              disabled={actionLoading === entry.name}
                              onClick={() => runEntryAction(entry.name, "Approved")}
                            >
                              {actionLoading === entry.name ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setRejectTarget({ type: "entry", name: entry.name })}
                            >
                              <X className="h-4 w-4" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject with comment</DialogTitle>
          </DialogHeader>
          <TextArea
            rows={4}
            placeholder="Explain why this is being rejected"
            value={rejectComment}
            onChange={(event) => setRejectComment(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleRejectConfirm()} disabled={!rejectComment.trim()}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ApprovalQueue;
