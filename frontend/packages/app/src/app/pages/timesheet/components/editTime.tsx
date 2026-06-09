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
  Separator,
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
  const columns = ["Date", inputMode === "range" ? "Start / End" : "Hours", "Description", "Billable", ""];
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
    if (data) {
      form.reset({ data: updatedData });
      const firstRangeRow = updatedData.find((item) => item.input_mode === "range");
      if (firstRangeRow) {
        setInputMode("range");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

      const requestId = ++autoSaveRequestRef.current;
      setDraftSaveStatus("saving");

      try {
        const res = await updateTimesheet(buildUpdatePayload(parsed.data));
        if (requestId !== autoSaveRequestRef.current) {
          return false;
        }
        setDraftSaveStatus("saved");
        mutate();
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
    },
    [mutate, toast, updateTimesheet]
  );

  const handleUpdate = async (formData: z.infer<typeof TimesheetDraftUpdateSchema>) => {
    setIsSubmitting(true);
    await persistDraft(formData, true);
    setIsSubmitting(false);
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Time
            {draftSaveStatus === "saving" && (
              <Typography variant="small" className="text-muted-foreground">
                Saving draft...
              </Typography>
            )}
            {draftSaveStatus === "saved" && (
              <Typography variant="small" className="text-success">
                Draft saved
              </Typography>
            )}
          </DialogTitle>
          <Separator />
          <div className="flex justify-between w-full ">
            <span className="flex flex-col items-start">
              <Typography title={data?.message?.task} variant="p" className="max-w-80 truncate font-semibold">
                {data?.message?.task}
              </Typography>
              <Typography title={data?.message?.project} variant="small" className="max-w-80 truncate">
                {data?.message?.project}
              </Typography>
            </span>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleUpdate)}>
            {isLoading ? (
              <Spinner />
            ) : (
              <div className=" max-md:flex max-md:flex-col max-md:gap-y-3">
                <InputModeToggle value={inputMode} onChange={handleInputModeChange} className="mb-4" />
                <div className="flex flex-col max-md:hidden">
                  <div className="py-2 bg-muted rounded-lg flex items-center gap-2 h-10 mb-5">
                    {columns.map((column, key) => (
                      <Typography
                        key={`column-${key}`}
                        variant="p"
                        className={mergeClassNames(
                          "w-full px-2 text-slate-600 dark:text-slate-200 font-medium ",
                          key != 2 && "max-w-16",
                          key == 0 && "max-w-28",
                          key == 3 && "max-w-24"
                        )}
                      >
                        {column}
                      </Typography>
                    ))}
                  </div>
                </div>
                {fields.map((item, index: number) => (
                  <div
                    className="flex gap-2 border-b pb-5 items-start pt-1 max-md:border max-md:rounded-md max-md:p-4 max-md:flex-col"
                    key={item.id}
                  >
                    <FormField
                      control={form.control}
                      name={`data.${index}.date`}
                      render={({ field }) => (
                        <FormItem className="w-full md:max-w-28 space-y-2 truncate">
                          <FormLabel className="flex gap-2 items-center md:hidden">
                            <p title="subject" className="text-sm truncate">
                              Date
                            </p>
                          </FormLabel>
                          <FormControl>
                            <DatePicker
                              date={new Date(field.value)}
                              onDateChange={(date) => {
                                if (!date) return;
                                form.setValue(`data.${index}.date`, getFormatedDate(date), {
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
                        render={({ field }) => {
                          return (
                            <FormItem className="w-full md:max-w-24 max-md:w-full md:px-2">
                              <FormLabel className="flex gap-2 items-center md:hidden">
                                <p title="subject" className="text-sm truncate">
                                  Hours
                                </p>
                              </FormLabel>
                              <FormControl>
                                <div className=" flex w-full border rounded-md ">
                                  <Input
                                    placeholder="00:00"
                                    type="text"
                                    {...field}
                                    className={mergeClassNames(
                                      "p-1 border-0 border-r rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                    )}
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
                          );
                        }}
                      />
                    ) : (
                      <div className="w-full md:max-w-40 max-md:w-full md:px-2">
                        <TimeRangeFields
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
                    <div className="w-full md:px-2">
                      <TimesheetDescriptionField
                        control={form.control}
                        name={`data.${index}.description`}
                        required={descriptionRequired}
                        label="Description"
                        placeholder="Update your progress"
                      />
                    </div>
                    <div className="w-full md:max-w-40 md:px-2">
                      <BillableFields
                        control={form.control}
                        isBillableName={`data.${index}.is_billable`}
                        reasonName={`data.${index}.billable_override_reason`}
                        projectDefault={projectDefaultIsBillable}
                        watchedIsBillable={form.watch(`data.${index}.is_billable`)}
                        showDefaultHint={index === 0}
                      />
                    </div>
                    <div className=" flex items-center min-h-10 gap-2 md:px-2 max-md:w-full">
                      <Button
                        variant="destructive"
                        className="p-1 h-fit max-md:h-8 max-md:w-full  mt-1 max-md:flex max-md:justify-center max-md:items-center"
                        type="button"
                        onClick={() => removeFormRow(index)}
                      >
                        <Trash2 />{" "}
                        <Typography className="hidden text-sm text-white max-md:block" variant="p">
                          Delete Row
                        </Typography>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter className="sm:justify-between mt-4 flex max-md:flex-col gap-y-2">
              <Button type="button" variant="outline" onClick={addEmptyFormRow}>
                <Plus />
                Add Row
              </Button>
              <Button variant="success" disabled={!form.formState.isValid || !form.formState.isDirty || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" /> : <Save />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
