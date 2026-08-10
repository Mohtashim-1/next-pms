/**
 * Spreadsheet-style bulk time entry (15 rows).
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { getFormatedDate, getTodayDate, getUTCDateTime } from "@next-pms/design-system/date";
import { format } from "date-fns";
import { FrappeConfig, FrappeContext, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ClipboardPaste, Copy, Download, LoaderCircle, Save, Table2, Upload } from "lucide-react";

import { parseFrappeErrorMsg, removeHtmlString } from "@/lib/utils";
import { TimePickerField } from "@/app/components/timesheet-input/timePickerField";
import type { TaskData } from "@/types";
import {
  downloadGridCsv,
  getGridTemplateCsv,
  mergeRowsIntoGrid,
  parseGridClipboard,
  rowsToCsv,
  rowsToTsv,
  type GridRowData,
} from "./timesheetGridCsv";

const ROW_COUNT = 15;

const MANAGER_ROLES = new Set([
  "Timesheet Manager",
  "HR Manager",
  "Projects Manager",
  "System Manager",
  "Administrator",
]);

type GridRow = GridRowData;

function emptyRow(employee: string, date: string): GridRow {
  return {
    date,
    type: "",
    from_time: "",
    to_time: "",
    employee,
    project: "",
    task: "",
    remarks: "",
  };
}

type GridSaveError = {
  row: number;
  message: string;
};

function cleanErrorMessage(message: string) {
  return removeHtmlString(message).replace(/\s+/g, " ").trim();
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function isRowFilled(row: GridRow) {
  return Boolean(row.date || row.task || row.from_time || row.to_time || row.remarks || row.type);
}

interface TimesheetGridDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: string;
  employeeName?: string;
  roles?: string[];
  onSuccess?: (savedDate?: string) => void;
}

export function TimesheetGridDialog({
  open,
  onOpenChange,
  employee,
  employeeName,
  roles = [],
  onSuccess,
}: TimesheetGridDialogProps) {
  const { toast } = useToast();
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const today = getTodayDate();
  const canPickEmployee = roles.some((role) => MANAGER_ROLES.has(role));

  const [rows, setRows] = useState<GridRow[]>(() =>
    Array.from({ length: ROW_COUNT }, () => emptyRow(employee, today))
  );
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [employees, setEmployees] = useState<Array<{ name: string; employee_name: string }>>([]);
  const [saveErrors, setSaveErrors] = useState<GridSaveError[]>([]);
  const [pasteStartRow, setPasteStartRow] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const clipboardOptions = useMemo(
    () => ({
      includeEmployee: canPickEmployee,
      defaultEmployee: employee,
      defaultDate: today,
    }),
    [canPickEmployee, employee, today]
  );

  const { data: meta } = useFrappeGetCall(
    "next_pms.timesheet.api.timesheet.get_timesheet_grid_meta",
    undefined,
    open ? undefined : null
  );

  const { data: projects } = useFrappeGetCall(
    "frappe.client.get_list",
    { doctype: "Project", fields: ["name", "project_name"], limit_page_length: 500 },
    open ? undefined : null
  );

  const { call: bulkSave, loading: isSaving } = useFrappePostCall(
    "next_pms.timesheet.api.timesheet.bulk_save_grid"
  );

  const activityTypes: string[] = asArray<string>(
    meta?.message?.activity_types ?? [
      "Meeting",
      "Admin",
      "Bug",
      "Development",
      "Issue",
      "Research",
      "Support",
      "Training",
    ]
  );

  const projectOptions = useMemo(
    () => asArray<{ name: string; project_name: string }>(projects?.message),
    [projects]
  );

  const loadTasks = useCallback(
    (project?: string) => {
      call
        .get("next_pms.timesheet.api.task.get_task_list", {
          search: "",
          projects: project ? [project] : [],
          page_length: 500,
        })
        .then((res) => setTasks(asArray<TaskData>(res.message?.task)))
        .catch(() => setTasks([]));
    },
    [call]
  );

  const loadEmployees = useCallback(() => {
    if (!canPickEmployee) return;
    call
      .get("next_pms.timesheet.api.employee.get_employee_list", {
        page_length: 200,
        status: ["Active"],
        ignore_default_filters: false,
      })
      .then((res) => setEmployees(asArray<{ name: string; employee_name: string }>(res.message?.data)))
      .catch(() => setEmployees([]));
  }, [call, canPickEmployee]);

  useEffect(() => {
    if (!open) return;
    setSaveErrors([]);
    setPasteStartRow(0);
    setRows(Array.from({ length: ROW_COUNT }, () => emptyRow(employee, today)));
    loadTasks();
    loadEmployees();
    window.setTimeout(() => gridRef.current?.focus(), 150);
  }, [open, employee, today, loadTasks, loadEmployees]);

  const updateRow = (index: number, patch: Partial<GridRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const tasksForProject = (project: string) => {
    const list = asArray<TaskData>(tasks);
    if (!project) return list;
    return list.filter((task) => task.project === project);
  };

  const applyPastedRows = useCallback(
    (pasted: GridRow[], startIndex = 0) => {
      if (!pasted.length) {
        toast({
          variant: "destructive",
          description: "No rows found. Use CSV/TSV with columns: date, type, from_time, to_time, project, task, remarks.",
        });
        return;
      }

      setRows((prev) => mergeRowsIntoGrid(prev, pasted, startIndex, ROW_COUNT));
      setSaveErrors([]);

      const projectsToLoad = [...new Set(pasted.map((row) => row.project).filter(Boolean))];
      projectsToLoad.forEach((project) => loadTasks(project));

      toast({
        variant: "success",
        description: `Pasted ${Math.min(pasted.length, ROW_COUNT - startIndex)} row(s) starting at row ${startIndex + 1}.`,
      });
    },
    [loadTasks, toast]
  );

  const handleExport = () => {
    const csv = rowsToCsv(rows, canPickEmployee);
    downloadGridCsv(csv, `timesheet-grid-${today}.csv`);
    toast({ variant: "success", description: "Grid exported as CSV." });
  };

  const handleExportTemplate = () => {
    const csv = getGridTemplateCsv(canPickEmployee, employee, today);
    downloadGridCsv(csv, "timesheet-grid-template.csv");
    toast({ variant: "success", description: "Template downloaded." });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseGridClipboard(text, clipboardOptions);
      applyPastedRows(parsed, 0);
    } catch {
      toast({ variant: "destructive", description: "Could not read the selected file." });
    }
  };

  const handleCopy = async () => {
    try {
      const tsv = rowsToTsv(rows, canPickEmployee);
      await navigator.clipboard.writeText(tsv);
      toast({ variant: "success", description: "Grid copied — paste into Excel or another sheet." });
    } catch {
      toast({ variant: "destructive", description: "Could not copy to clipboard." });
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseGridClipboard(text, clipboardOptions);
      applyPastedRows(parsed, pasteStartRow);
    } catch {
      toast({
        variant: "destructive",
        description: "Could not read clipboard. Click a row first, or use Ctrl+V inside the grid.",
      });
    }
  };

  const handleGridPaste = (event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    event.preventDefault();
    const parsed = parseGridClipboard(text, clipboardOptions);
    applyPastedRows(parsed, pasteStartRow);
  };

  const handleSave = async () => {
    const payload = rows
      .filter(isRowFilled)
      .map((row) => {
        const hasRange = row.from_time && row.to_time;
        let from_datetime: string | undefined;
        let to_datetime: string | undefined;
        let hours = 0;

        if (hasRange) {
          from_datetime = `${row.date} ${row.from_time}:00`;
          to_datetime = `${row.date} ${row.to_time}:00`;
          const start = new Date(from_datetime.replace(" ", "T"));
          const end = new Date(to_datetime.replace(" ", "T"));
          hours = Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
        }

        return {
          date: row.date,
          type: row.type,
          activity_type: row.type,
          from_time: from_datetime,
          to_time: to_datetime,
          input_mode: hasRange ? "range" : "duration",
          hours,
          employee: row.employee || employee,
          task: row.task,
          project: row.project,
          description: row.remarks,
          remarks: row.remarks,
        };
      })
      .filter(
        (row) =>
          row.date &&
          row.type &&
          (row.remarks || "").trim() &&
          (row.task || row.project) &&
          (row.hours > 0 || (row.from_time && row.to_time))
      );

    if (payload.length === 0) {
      toast({
        variant: "destructive",
        description: "Add at least one row with date, work type, remarks, project/task, and time.",
      });
      return;
    }

    try {
      setSaveErrors([]);
      const res = await bulkSave({ timesheet_entries: payload });
      const errors = asArray<GridSaveError>(res.message?.errors).map((error) => ({
        row: error.row,
        message: cleanErrorMessage(error.message),
      }));
      const created = Number(res.message?.created ?? 0);
      const savedDates = asArray<string>(res.message?.saved_dates);
      const focusDate = savedDates[0];

      if (errors.length) {
        setSaveErrors(errors);
        toast({
          variant: created > 0 ? "default" : "destructive",
          description:
            created > 0
              ? `${res.message?.message ?? "Some rows saved."} Fix the rows listed below and save again.`
              : errors[0]?.message ?? "Could not save your time entries.",
        });
        if (created > 0) {
          onSuccess?.(focusDate);
        }
        return;
      }

      const dateHint = focusDate ? format(getUTCDateTime(focusDate), "MMM d, yyyy") : undefined;
      toast({
        variant: "success",
        description: dateHint
          ? `${res.message?.message ?? "Saved."} Opening week of ${dateHint}.`
          : res.message?.message ?? res.message,
      });
      onOpenChange(false);
      onSuccess?.(focusDate);
    } catch (err) {
      toast({
        variant: "destructive",
        description: parseFrappeErrorMsg(err),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(1500px,98vw)] max-w-[98vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[98vw]">
        <DialogHeader className="space-y-3 border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Table2 className="h-5 w-5" />
            Time Sheet
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Enter up to {ROW_COUNT} rows, then save. Copy from Excel and press{" "}
            <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium">Ctrl+V</kbd> in the grid,
            or use Import / Export below.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4" />
              Copy all
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handlePasteFromClipboard}>
              <ClipboardPaste className="h-4 w-4" />
              Paste
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleImportClick}>
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleExportTemplate} className="text-muted-foreground">
              Template
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </DialogHeader>

        <div
          ref={gridRef}
          className="flex-1 overflow-auto border-y bg-background px-2 py-2 focus:outline-none"
          tabIndex={0}
          onPaste={handleGridPaste}
        >
          <table className="w-full min-w-[1280px] border-collapse text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="border-b px-2 py-2 text-left font-medium w-10">#</th>
                <th className="border-b px-2 py-2 text-left font-medium min-w-[130px]">Date</th>
                <th className="border-b px-2 py-2 text-left font-medium min-w-[140px]">Type</th>
                <th className="border-b px-2 py-2 text-left font-medium min-w-[100px]">From time</th>
                <th className="border-b px-2 py-2 text-left font-medium min-w-[100px]">To time</th>
                {canPickEmployee && (
                  <th className="border-b px-2 py-2 text-left font-medium min-w-[160px]">Employee</th>
                )}
                <th className="border-b px-2 py-2 text-left font-medium min-w-[180px]">Project</th>
                <th className="border-b px-2 py-2 text-left font-medium min-w-[180px]">Task</th>
                <th className="border-b px-2 py-2 text-left font-medium min-w-[180px]">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={index}
                  className="hover:bg-muted/20"
                  onClick={() => setPasteStartRow(index)}
                >
                  <td className="border-b px-2 py-1 text-muted-foreground">{index + 1}</td>
                  <td className="border-b px-1 py-1 min-w-[130px]">
                    <div className="[&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-xs [&_p]:text-xs [&_svg]:h-3.5 [&_svg]:w-3.5">
                      <DatePicker
                        date={row.date}
                        onDateChange={(date) => {
                          if (!date) return;
                          updateRow(index, { date: getFormatedDate(date) });
                        }}
                      />
                    </div>
                  </td>
                  <td className="border-b px-1 py-1">
                    <Select
                      value={row.type || undefined}
                      onValueChange={(value) => updateRow(index, { type: value })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        {activityTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border-b px-1 py-1 min-w-[100px]">
                    <TimePickerField
                      value={row.from_time}
                      onChange={(value) => updateRow(index, { from_time: value })}
                      placeholder="9:00 AM"
                      hour12
                      ariaLabel="Start time"
                    />
                  </td>
                  <td className="border-b px-1 py-1 min-w-[100px]">
                    <TimePickerField
                      value={row.to_time}
                      onChange={(value) => updateRow(index, { to_time: value })}
                      placeholder="5:00 PM"
                      hour12
                      ariaLabel="End time"
                    />
                  </td>
                  {canPickEmployee && (
                    <td className="border-b px-1 py-1">
                      <Select
                        value={row.employee || undefined}
                        onValueChange={(value) => updateRow(index, { employee: value })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((emp) => (
                            <SelectItem key={emp.name} value={emp.name}>
                              {emp.employee_name || emp.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  )}
                  <td className="border-b px-1 py-1">
                    <Select
                      value={row.project || undefined}
                      onValueChange={(value) => {
                        updateRow(index, { project: value, task: "" });
                        loadTasks(value);
                      }}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.name} value={project.name}>
                            {project.project_name || project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border-b px-1 py-1">
                    <Select value={row.task || undefined} onValueChange={(value) => updateRow(index, { task: value })}>
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Task" />
                      </SelectTrigger>
                      <SelectContent>
                        {tasksForProject(row.project).map((task) => (
                          <SelectItem key={task.name} value={task.name}>
                            {task.subject || task.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border-b px-1 py-1">
                    <Input
                      className="h-8"
                      placeholder="Remarks"
                      value={row.remarks}
                      onChange={(e) => updateRow(index, { remarks: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {saveErrors.length > 0 && (
          <div className="mx-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <Typography variant="small" className="font-medium text-destructive">
              Some rows could not be saved
            </Typography>
            <ul className="space-y-1 text-sm text-destructive/90 list-disc pl-5">
              {saveErrors.map((error) => (
                <li key={`${error.row}-${error.message}`}>{error.message}</li>
              ))}
            </ul>
          </div>
        )}

        {!canPickEmployee && (
          <Typography variant="small" className="px-6 text-muted-foreground">
            Employee: {employeeName || employee}
          </Typography>
        )}
        {pasteStartRow > 0 && (
          <Typography variant="small" className="px-6 text-muted-foreground/80">
            Paste will start at row {pasteStartRow + 1} — click another row to change.
          </Typography>
        )}

        <DialogFooter className="gap-2 border-t bg-muted/20 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Save rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TimesheetGridDialog;
