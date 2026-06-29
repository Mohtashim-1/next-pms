/**
 * External dependencies
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  DatePicker,
  Spinner,
  Typography,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  useToast,
} from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { floatToTime, mergeClassNames } from "@next-pms/design-system/utils";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { z } from "zod";
/**
 * Internal dependencies
 */
import TimeSelector from "@/app/components/add-time/time-selector";
import { BillableFields } from "@/app/components/timesheet-billable/billableFields";
import { TimesheetDescriptionField } from "@/app/components/timesheet-description/descriptionField";
import { InputModeToggle } from "@/app/components/timesheet-input/inputModeToggle";
import { isBillableValue } from "@/lib/timesheetBillable";
import { TimeRangeFields } from "@/app/components/timesheet-input/timeRangeFields";
import { TIMESHEET_INPUT_MODE_KEY } from "@/lib/constant";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { extractTimeFromDatetime, isRangeEntry, type TimesheetInputMode } from "@/lib/timesheetTime";
import { parseFrappeErrorMsg } from "@/lib/utils";
import { TimesheetDraftUpdateSchema, serializeTimesheetUpdateRow } from "@/schema/timesheet";
import type { EditTimeProps, TimesheetDetail } from "./types";

export const EditTime = ({ employee, date, task, open, onClose }: EditTimeProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveRequestRef = useRef(0);
  const persistQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
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
  const timeColumnLabel = inputMode === "range" ? "Start / End" : "Hours";
  const { toast } = useToast();
  const { call: updateTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.bulk_update_timesheet_detail");
  const { call: deleteTimesheet } = useFrappePostCall("next_pms.timesheet.api.timesheet.delete");
  const { data, isLoading, mutate } = useFrappeGetCall("next_pms.timesheet.api.timesheet.get_timesheet_details", {
    employee: employee,
    date: date,
    task: task,
  });
  const projectDefaultIsBillable = data?.message?.project_default_is_billable;
  const descriptionRequired = Boolean(data?.message?.description_required);

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
      };
    });
    return updatedData;
  }, [data]);

  useEffect(() => {
    if (!open) {
      loadedDialogKeyRef.current = null;
      return;
    }
    if (!data) return;

    const dialogKey = `${employee}-${date}-${task}`;
    if (loadedDialogKeyRef.current === dialogKey) return;

    loadedDialogKeyRef.current = dialogKey;
    form.reset({ data: updatedData });
    setDraftSaveStatus("idle");
    const firstRangeRow = updatedData.find((item) => item.input_mode === "range");
    if (firstRangeRow) {
      setInputMode("range");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, employee, date, task]);

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
      task: task,
      date: date,
      input_mode: inputMode,
      from_time: "",
      to_time: "",
      is_billable: isBillableValue(projectDefaultIsBillable),
      project_default_is_billable: projectDefaultIsBillable,
      billable_override_reason: "",
    };
    append(newRow, { shouldFocus: true });
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

      const runPersist = async () => {
        const requestId = ++autoSaveRequestRef.current;
        setDraftSaveStatus("saving");

        try {
          const res = await updateTimesheet(buildUpdatePayload(parsed.data));
          if (requestId !== autoSaveRequestRef.current) {
            return false;
          }
          setDraftSaveStatus("saved");
          form.reset(form.getValues());
          if (showToast) {
            toast({
              variant: "success",
              description: res.message,
            });
          }
          return true;
        } catch (err) {
          if (requestId === autoSaveRequestRef.current) {
            setDraftSaveStatus("error");
            if (showToast) {
              const error = parseFrappeErrorMsg(err);
              toast({
                variant: "destructive",
                description: error,
              });
            }
          }
          return false;
        }
      };

      const queued = persistQueueRef.current.then(runPersist, runPersist);
      persistQueueRef.current = queued.catch(() => false);
      return queued;
    },
    [form, toast, updateTimesheet]
  );

  const handleUpdate = async (formData: z.infer<typeof TimesheetDraftUpdateSchema>) => {
    if (!form.formState.isDirty && draftSaveStatus === "saved") {
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

  useEffect(() => {
    if (!open) {
      setDraftSaveStatus("idle");
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values) => {
      if (!values.data?.length) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void persistDraft(values as z.infer<typeof TimesheetDraftUpdateSchema>);
      }, 800);
    });

    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [form, open, persistDraft]);

  const removeFormRow = (index: number) => {
    const currentData = form.getValues().data || [];
    const rowToDelete = currentData[index];
    if (!rowToDelete?.name) {
      remove(index);
    } else {
      handleDelete(rowToDelete.parent, rowToDelete.name);
    }
  };
  const handleDelete = (parent: string, name: string) => {
    deleteTimesheet({ parent, name })
      .then((res) => {
        mutate();
        toast({
          variant: "success",
          description: res.message,
        });
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
      });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[88vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-4 border-b px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-lg">Edit Time</DialogTitle>
              <Typography
                title={data?.message?.task}
                variant="p"
                className="truncate font-medium leading-snug"
              >
                {data?.message?.task}
              </Typography>
              <Typography
                title={data?.message?.project}
                variant="small"
                className="truncate text-muted-foreground"
              >
                {data?.message?.project}
              </Typography>
            </div>
            <div className="shrink-0">
              {draftSaveStatus === "saving" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              )}
              {draftSaveStatus === "saved" && (
                <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  Saved
                </span>
              )}
              {draftSaveStatus === "error" && (
                <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                  Save failed
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InputModeToggle value={inputMode} onChange={handleInputModeChange} />
            {projectDefaultIsBillable !== undefined && (
              <span className="inline-flex items-center rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                Project default: {isBillableValue(projectDefaultIsBillable) ? "Billable" : "Non-billable"}
              </span>
            )}
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleUpdate)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner />
                </div>
              ) : (
                <>
                  <div className="hidden overflow-hidden rounded-lg border md:block">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="w-[7.5rem] px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                            Date
                          </th>
                          <th
                            className={mergeClassNames(
                              "px-3 py-2.5 text-left text-xs font-medium text-muted-foreground",
                              inputMode === "range" ? "w-[13rem]" : "w-[8rem]"
                            )}
                          >
                            {timeColumnLabel}
                          </th>
                          <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                            Description
                          </th>
                          <th className="w-16 px-3 py-2.5 text-center text-xs font-medium text-muted-foreground">
                            Billable
                          </th>
                          <th className="w-10 px-2 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {fields.map((item, index: number) => (
                          <tr key={item.id} className="group hover:bg-muted/20">
                            <td className="px-3 py-2 align-middle">
                              <FormField
                                control={form.control}
                                name={`data.${index}.date`}
                                render={({ field }) => (
                                  <FormItem className="space-y-0">
                                    <FormControl>
                                      <div className="[&_button]:h-9 [&_button]:min-h-9 [&_button]:text-sm">
                                        <DatePicker
                                          date={new Date(field.value)}
                                          onDateChange={(nextDate) => {
                                            if (!nextDate) return;
                                            form.setValue(`data.${index}.date`, getFormatedDate(nextDate), {
                                              shouldValidate: true,
                                              shouldDirty: true,
                                              shouldTouch: true,
                                            });
                                          }}
                                        />
                                      </div>
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="px-3 py-2 align-middle">
                              {inputMode === "duration" ? (
                                <FormField
                                  control={form.control}
                                  name={`data.${index}.hours`}
                                  render={({ field }) => (
                                    <FormItem className="space-y-0">
                                      <FormControl>
                                        <div className="flex h-9 w-full rounded-md border">
                                          <Input
                                            placeholder="00:00"
                                            type="text"
                                            {...field}
                                            className="h-9 rounded-none border-0 border-r focus-visible:ring-0 focus-visible:ring-offset-0"
                                          />
                                          <TimeSelector
                                            onClick={(time: string) => {
                                              form.setValue(`data.${index}.hours`, time, {
                                                shouldValidate: true,
                                                shouldDirty: true,
                                                shouldTouch: true,
                                              });
                                            }}
                                          />
                                        </div>
                                      </FormControl>
                                      <FormMessage className="text-xs" />
                                    </FormItem>
                                  )}
                                />
                              ) : (
                                <TimeRangeFields
                                  compact
                                  fromTime={form.watch(`data.${index}.from_time`) || ""}
                                  toTime={form.watch(`data.${index}.to_time`) || ""}
                                  onFromTimeChange={(value) =>
                                    form.setValue(`data.${index}.from_time`, value, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                  }
                                  onToTimeChange={(value) =>
                                    form.setValue(`data.${index}.to_time`, value, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    })
                                  }
                                  fromError={form.formState.errors.data?.[index]?.from_time?.message}
                                  toError={form.formState.errors.data?.[index]?.to_time?.message}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 align-middle">
                              <TimesheetDescriptionField
                                compact
                                control={form.control}
                                name={`data.${index}.description`}
                                required={descriptionRequired}
                                placeholder="What did you work on?"
                              />
                            </td>
                            <td className="px-3 py-2 align-middle">
                              <BillableFields
                                compact
                                control={form.control}
                                isBillableName={`data.${index}.is_billable`}
                                reasonName={`data.${index}.billable_override_reason`}
                                projectDefault={projectDefaultIsBillable}
                                watchedIsBillable={form.watch(`data.${index}.is_billable`)}
                                showDefaultHint={false}
                              />
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <Button
                                variant="ghost"
                                size="icon"
                                type="button"
                                title="Remove entry"
                                aria-label="Remove entry"
                                className="h-8 w-8 text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100"
                                onClick={() => removeFormRow(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-3 md:hidden">
                    {fields.map((item, index: number) => (
                      <div key={item.id} className="space-y-3 rounded-lg border p-4">
                        <FormField
                          control={form.control}
                          name={`data.${index}.date`}
                          render={({ field }) => (
                            <FormItem className="space-y-1">
                              <FormLabel className="text-sm">Date</FormLabel>
                              <FormControl>
                                <DatePicker
                                  date={new Date(field.value)}
                                  onDateChange={(nextDate) => {
                                    if (!nextDate) return;
                                    form.setValue(`data.${index}.date`, getFormatedDate(nextDate), {
                                      shouldValidate: true,
                                      shouldDirty: true,
                                      shouldTouch: true,
                                    });
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {inputMode === "duration" ? (
                          <FormField
                            control={form.control}
                            name={`data.${index}.hours`}
                            render={({ field }) => (
                              <FormItem className="space-y-1">
                                <FormLabel className="text-sm">Hours</FormLabel>
                                <FormControl>
                                  <div className="flex h-9 w-full rounded-md border">
                                    <Input
                                      placeholder="00:00"
                                      type="text"
                                      {...field}
                                      className="h-9 rounded-none border-0 border-r focus-visible:ring-0 focus-visible:ring-offset-0"
                                    />
                                    <TimeSelector
                                      onClick={(time: string) => {
                                        form.setValue(`data.${index}.hours`, time, {
                                          shouldValidate: true,
                                          shouldDirty: true,
                                          shouldTouch: true,
                                        });
                                      }}
                                    />
                                  </div>
                                </FormControl>
                                <FormMessage className="text-xs" />
                              </FormItem>
                            )}
                          />
                        ) : (
                          <div className="space-y-1">
                            <FormLabel className="text-sm">Start / End</FormLabel>
                            <TimeRangeFields
                              compact
                              fromTime={form.watch(`data.${index}.from_time`) || ""}
                              toTime={form.watch(`data.${index}.to_time`) || ""}
                              onFromTimeChange={(value) =>
                                form.setValue(`data.${index}.from_time`, value, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                              onToTimeChange={(value) =>
                                form.setValue(`data.${index}.to_time`, value, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                              fromError={form.formState.errors.data?.[index]?.from_time?.message}
                              toError={form.formState.errors.data?.[index]?.to_time?.message}
                            />
                          </div>
                        )}
                        <TimesheetDescriptionField
                          compact
                          control={form.control}
                          name={`data.${index}.description`}
                          required={descriptionRequired}
                          label="Description"
                          placeholder="What did you work on?"
                        />
                        <BillableFields
                          control={form.control}
                          isBillableName={`data.${index}.is_billable`}
                          reasonName={`data.${index}.billable_override_reason`}
                          projectDefault={projectDefaultIsBillable}
                          watchedIsBillable={form.watch(`data.${index}.is_billable`)}
                          showDefaultHint={false}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="w-full text-destructive hover:text-destructive"
                          onClick={() => removeFormRow(index)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove entry
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="gap-2 border-t bg-muted/20 px-6 py-4 sm:justify-between">
              <Button type="button" variant="outline" size="sm" onClick={addEmptyFormRow}>
                <Plus className="h-4 w-4" />
                Add row
              </Button>
              <Button variant="success" size="sm" disabled={!form.formState.isValid || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {!form.formState.isDirty && draftSaveStatus === "saved" ? "Done" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
