/**
 * External dependencies
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Spinner,
  Typography,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  useToast,
} from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";
import { useFrappeGetCall, useFrappePostCall, type FrappeError } from "frappe-react-sdk";
import { LoaderCircle, Plus, Save, Timer, Briefcase } from "lucide-react";
import { z } from "zod";
/**
 * Internal dependencies
 */
import { InputModeToggle } from "@/app/components/timesheet-input/inputModeToggle";
import { TIMESHEET_INPUT_MODE_KEY } from "@/lib/constant";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { isBillableValue } from "@/lib/timesheetBillable";
import { extractTimeFromDatetime, isRangeEntry, type TimesheetInputMode } from "@/lib/timesheetTime";
import { parseFrappeErrorMsg } from "@/lib/utils";
import { TimesheetDraftUpdateSchema, serializeTimesheetUpdateRow, timeStringToFloat } from "@/schema/timesheet";
import { EditTimeEntryCard } from "./editTimeEntryCard";
import type { EditTimeProps, TimesheetDetail } from "./types";

function sumEntryHours(rows: z.infer<typeof TimesheetDraftUpdateSchema>["data"], mode: TimesheetInputMode): number {
  return rows.reduce((total, row) => {
    if (mode === "duration") {
      const hours = timeStringToFloat(String(row.hours ?? ""));
      return total + (Number.isNaN(hours) ? 0 : hours);
    }
    const from = timeStringToFloat(row.from_time ?? "");
    const to = timeStringToFloat(row.to_time ?? "");
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return total;
    return total + (to - from);
  }, 0);
}

export const EditTime = ({
  employee,
  date,
  task,
  activity_type = "",
  open,
  onClose,
  onChanged,
}: EditTimeProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const loadedDialogKeyRef = useRef<string | null>(null);

  const form = useForm<z.infer<typeof TimesheetDraftUpdateSchema>>({
    resolver: zodResolver(TimesheetDraftUpdateSchema),
    defaultValues: {
      data: [],
    },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "data",
  });

  const savedInputMode = (getLocalStorage(TIMESHEET_INPUT_MODE_KEY) as TimesheetInputMode) || "duration";
  const [inputMode, setInputMode] = useState<TimesheetInputMode>(savedInputMode);
  const watchedRows = useWatch({ control: form.control, name: "data" });
  const totalHours = useMemo(
    () => sumEntryHours(watchedRows ?? [], inputMode),
    [watchedRows, inputMode]
  );
  const { toast } = useToast();
  const { call: updateTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.bulk_update_timesheet_detail");
  const { call: deleteTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.delete");
  const resolvedActivityType = activity_type || (task?.startsWith("activity::") ? task.replace(/^activity::/, "") : "");
  const resolvedTask = task?.startsWith("activity::") ? "" : task || "";
  const { data, isLoading, mutate } = useFrappeGetCall("next_pms.timesheet.api.timesheet.get_timesheet_details", {
    employee: employee,
    date: date,
    task: resolvedTask,
    activity_type: resolvedActivityType || undefined,
  });
  const projectDefaultIsBillable = data?.message?.project_default_is_billable;
  const descriptionRequired = Boolean(data?.message?.description_required);
  const entryLabel = data?.message?.task || resolvedActivityType || "Time entry";
  const isActivityRow = Boolean(data?.message?.is_activity_row || resolvedActivityType);

  const updatedData = useMemo(() => {
    if (!data) return [];
    const updatedData = data.message.data.map((item: TimesheetDetail) => {
      const rangeMode = item.input_mode ? item.input_mode === "range" : isRangeEntry(item.from_time, item.to_time);
      return {
        ...item,
        hours: floatToTime(item.hours),
        input_mode: rangeMode ? "range" : "duration",
        from_time: extractTimeFromDatetime(item.from_time),
        to_time: extractTimeFromDatetime(item.to_time),
        is_billable: isBillableValue(item.is_billable),
        project_default_is_billable: data.message.project_default_is_billable,
        billable_override_reason: item.billable_override_reason || "",
        activity_type: item.activity_type || resolvedActivityType || data.message.activity_type || "",
        task: item.task || resolvedTask || "",
      };
    });
    return updatedData;
  }, [data, resolvedActivityType, resolvedTask]);

  useEffect(() => {
    if (!open) {
      loadedDialogKeyRef.current = null;
      return;
    }
    if (!data) return;

    const dialogKey = `${employee}-${date}-${resolvedTask}-${resolvedActivityType}`;
    if (loadedDialogKeyRef.current === dialogKey) return;

    loadedDialogKeyRef.current = dialogKey;
    form.reset({ data: updatedData });
    const firstRangeRow = updatedData.find((item: TimesheetDetail & { input_mode?: string }) => item.input_mode === "range");
    if (firstRangeRow) {
      setInputMode("range");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, employee, date, resolvedTask, resolvedActivityType]);

  const handleInputModeChange = (mode: TimesheetInputMode) => {
    setInputMode(mode);
    setLocalStorage(TIMESHEET_INPUT_MODE_KEY, mode);
    fields.forEach((_, index) => {
      form.setValue(`data.${index}.input_mode`, mode, { shouldDirty: true, shouldValidate: true });
    });
  };

  const addEmptyFormRow = () => {
    const parent = fields[0]?.parent || "";
    const newRow = {
      hours: "0:00",
      description: "",
      name: "",
      parent: parent,
      task: resolvedTask,
      date: date,
      input_mode: inputMode,
      from_time: "",
      to_time: "",
      activity_type: resolvedActivityType || data?.message?.activity_type || "",
      is_billable: isBillableValue(projectDefaultIsBillable),
      project_default_is_billable: projectDefaultIsBillable,
      billable_override_reason: "",
    };
    append(newRow);
  };

  const buildUpdatePayload = (formData: z.infer<typeof TimesheetDraftUpdateSchema>) => ({
    data: formData.data
      .filter((row) => row.name || row.hours || row.from_time || row.to_time)
      .map(serializeTimesheetUpdateRow),
  });

  const persistDraft = useCallback(
    async (formData: z.infer<typeof TimesheetDraftUpdateSchema>, showToast = false) => {
      const parsed = TimesheetDraftUpdateSchema.safeParse(formData);
      if (!parsed.success || parsed.data.data.length === 0) {
        return false;
      }

      try {
        const res = await updateTimesheet(buildUpdatePayload(parsed.data));
        // Re-load server rows so newly created entries get real names, then
        // refresh the grid behind the dialog.
        loadedDialogKeyRef.current = null;
        await mutate();
        onChanged?.();
        if (showToast) {
          toast({
            variant: "success",
            description: res.message,
          });
        }
        return true;
      } catch (err) {
        if (showToast) {
          const error = parseFrappeErrorMsg(err as FrappeError);
          toast({
            variant: "destructive",
            description: error,
          });
        }
        return false;
      }
    },
    [toast, updateTimesheet, mutate, onChanged]
  );

  const handleUpdate = async (formData: z.infer<typeof TimesheetDraftUpdateSchema>) => {
    if (!form.formState.isDirty) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    const saved = await persistDraft(formData, true);
    setIsSubmitting(false);
    if (saved) {
      onClose();
    }
  };

  const removeFormRow = (index: number) => {
    if (isDeleting) return;
    const currentData = form.getValues().data || [];
    const rowToDelete = currentData[index];
    if (!rowToDelete?.name) {
      remove(index);
      return;
    }
    setIsDeleting(true);
    deleteTimesheet({ parent: rowToDelete.parent, name: rowToDelete.name })
      .then(async (res) => {
        // Update the open dialog immediately — waiting on mutate alone left the
        // card on screen because the load effect only runs once per dialog key.
        remove(index);
        loadedDialogKeyRef.current = null;
        await mutate();
        onChanged?.();
        toast({
          variant: "success",
          description: res.message,
        });
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err as FrappeError);
        toast({
          variant: "destructive",
          description: error,
        });
      })
      .finally(() => {
        setIsDeleting(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-0 border-b bg-gradient-to-b from-muted/40 to-background px-6 pb-5 pt-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Timer className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="text-xl font-semibold tracking-tight">Edit time</DialogTitle>
                  <Typography
                    title={entryLabel}
                    variant="p"
                    className="mt-1 truncate text-base font-medium"
                  >
                    {entryLabel}
                    {isActivityRow ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">Work type</span>
                    ) : null}
                  </Typography>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data?.message?.project && (
                  <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground ring-1 ring-border/50">
                    <Briefcase className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{data.message.project}</span>
                  </span>
                )}
                {projectDefaultIsBillable !== undefined && (
                  <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground ring-1 ring-border/50">
                    Default: {isBillableValue(projectDefaultIsBillable) ? "Billable" : "Non-billable"}
                  </span>
                )}
                {fields.length > 0 && (
                  <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground ring-1 ring-border/50">
                    {fields.length} {fields.length === 1 ? "entry" : "entries"} · {floatToTime(totalHours)} total
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <InputModeToggle value={inputMode} onChange={handleInputModeChange} />
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleUpdate)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto overscroll-contain bg-muted/10 px-6 py-5">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                  <Spinner />
                  <Typography variant="small" className="text-muted-foreground">
                    Loading entries…
                  </Typography>
                </div>
              ) : fields.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
                  <Timer className="mb-3 h-10 w-10 text-muted-foreground/50" />
                  <Typography variant="p" className="font-medium">
                    No time logged yet
                  </Typography>
                  <Typography variant="small" className="mt-1 max-w-xs text-muted-foreground">
                    {isActivityRow
                      ? "Add your first entry for this work type."
                      : "Add your first entry for this task."}
                  </Typography>
                  <Button type="button" variant="outline" size="sm" className="mt-4" onClick={addEmptyFormRow}>
                    <Plus className="h-4 w-4" />
                    Add entry
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {fields.map((item, index) => (
                    <EditTimeEntryCard
                      key={item.id}
                      index={index}
                      entryNumber={index + 1}
                      control={form.control}
                      form={form}
                      inputMode={inputMode}
                      descriptionRequired={descriptionRequired}
                      projectDefaultIsBillable={projectDefaultIsBillable}
                      onRemove={() => removeFormRow(index)}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full border-dashed bg-background/60 hover:bg-background"
                    onClick={addEmptyFormRow}
                  >
                    <Plus className="h-4 w-4" />
                    Add another entry
                  </Button>
                </div>
              )}
            </div>

            <DialogFooter className="gap-3 border-t bg-background px-6 py-4 sm:justify-between">
              <div className="hidden sm:block">
                {fields.length > 0 && (
                  <Typography variant="small" className="font-medium tabular-nums text-muted-foreground">
                    Total: <span className="text-foreground">{floatToTime(totalHours)}</span>
                  </Typography>
                )}
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="success" size="sm" disabled={!form.formState.isValid || isSubmitting}>
                  {isSubmitting ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {form.formState.isDirty ? "Save & close" : "Close"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
