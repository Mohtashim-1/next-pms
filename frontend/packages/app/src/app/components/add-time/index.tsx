/**
 * External Dependencies
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useToast,
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
  ComboBox,
  DatePicker,
  Typography,
} from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { FrappeConfig, FrappeContext, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { LoaderCircle, Play, Save, Search, Square, X } from "lucide-react";
import { z } from "zod";

/**
 * Internal Dependencies
 */
import EmployeeCombo from "@/app/components/employeeComboBox";
import { BillableFields } from "@/app/components/timesheet-billable/billableFields";
import { TimesheetDescriptionField } from "@/app/components/timesheet-description/descriptionField";
import { InputModeToggle } from "@/app/components/timesheet-input/inputModeToggle";
import { TimeRangeFields } from "@/app/components/timesheet-input/timeRangeFields";
import { TIMESHEET_INPUT_MODE_KEY } from "@/lib/constant";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { isBillableValue } from "@/lib/timesheetBillable";
import type { TimesheetInputMode } from "@/lib/timesheetTime";
import { mergeClassNames, expectatedHours, parseFrappeErrorMsg } from "@/lib/utils";
import { TimesheetDraftSchema, timeStringToFloat } from "@/schema/timesheet";
import type { TaskData } from "@/types";
import TimeSelector from "./time-selector";
import type { AddTimeProps } from "./type";

const debugAddTime = (event: string, details?: unknown) => {
  console.log(`[TimesheetAddTime] ${event}`, details ?? {});
};

/**
 * Add Time Component
 * @description This component is used to show dialog to the user to add time
 * entry for the timesheet. User can select the  date, time, project, task and
 * and description for the timesheet entry.
 * @param initialDate - Initial date for the timesheet, this select the date in date picker.
 * @param employee - Employee for the timesheet entry(In case of employee role they can select their employee only).
 * @param open - Boolean value to open the dialog.
 * @param onOpenChange - Function to change the open state of the dialog.
 * @param workingFrequency - Working frequency of the employee.(Used to calculating remaining hours).
 * @param workingHours - Working hours of the employee.(Used to calculating remaining hours).
 * @param onSuccess - Function to call after successfully adding the timesheet entry.
 * @param task - Task name for the timesheet entry (eg: TASK-0001).
 * @param project - Project name for the timesheet entry (eg: Project-0001).
 */
const AddTime = ({
  initialDate,
  employee,
  employeeName,
  open = false,
  onOpenChange,
  workingFrequency,
  workingHours,
  onSuccess,
  task = "",
  project = "",
}: AddTimeProps) => {
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const { call: save } = useFrappePostCall("next_pms.timesheet.api.timesheet.save");
  const { call: startTimer } = useFrappePostCall("next_pms.timesheet.api.timesheet.start_timer");
  const { call: stopTimer } = useFrappePostCall("next_pms.timesheet.api.timesheet.stop_timer");
  const [searchTask, setSearchTask] = useState(task);
  const [tasks, setTask] = useState<TaskData[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveRequestRef = useRef(0);
  const [timerSubmitting, setTimerSubmitting] = useState(false);
  const [timerTick, setTimerTick] = useState(Date.now());
  const [isTaskLoading, setIsTaskLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string[]>(project ? [project] : []);
  const [selectedDate, setSelectedDate] = useState(getFormatedDate(initialDate));
  const [selectedEmployee, setSelectedEmployee] = useState(employee);
  const expectedHours = expectatedHours(workingHours, workingFrequency);
  const { toast } = useToast();
  const savedInputMode = (getLocalStorage(TIMESHEET_INPUT_MODE_KEY) as TimesheetInputMode) || "duration";
  const form = useForm<z.infer<typeof TimesheetDraftSchema>>({
    resolver: zodResolver(TimesheetDraftSchema),
    defaultValues: {
      task: task,
      hours: "",
      description: "",
      date: initialDate,
      employee: employee,
      input_mode: savedInputMode,
      from_time: "",
      to_time: "",
      is_billable: false,
      project_default_is_billable: undefined,
      billable_override_reason: "",
    },
    mode: "onChange",
  });
  const inputMode = form.watch("input_mode");
  const selectedTaskName = form.watch("task");
  const selectedTask = tasks.find((item) => item.name === selectedTaskName);
  const descriptionRequired = Boolean(selectedTask?.custom_require_timesheet_description);
  const closeDialog = useCallback(() => {
    form.reset();
    onOpenChange(form.getValues());
  }, [form, onOpenChange]);
  const handleOpen = useCallback(() => {
    debugAddTime("dialog close requested", {
      submitting,
      values: form.getValues(),
    });
    if (submitting) return;
    closeDialog();
  }, [closeDialog, form, submitting]);
  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    form.setValue("date", getFormatedDate(date), {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
    setSelectedDate(getFormatedDate(date));
  };
  const handleTaskSearch = (searchTerm: string) => {
    setSearchTask(searchTerm);
  };
  const UpdateTime = (time: string) => {
    form.setValue("hours", time, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
  };
  const applyTaskBillableDefaults = useCallback(
    (taskName: string) => {
      const selectedTask = tasks.find((item: TaskData) => item.name === taskName);
      if (!selectedTask) return;

      const projectDefault = isBillableValue(selectedTask.project_default_is_billable);
      form.setValue("project_default_is_billable", projectDefault, {
        shouldValidate: true,
        shouldDirty: true,
        shouldTouch: true,
      });
      form.setValue("is_billable", projectDefault, {
        shouldValidate: true,
        shouldDirty: true,
        shouldTouch: true,
      });
      form.setValue("billable_override_reason", "", {
        shouldValidate: true,
        shouldDirty: true,
        shouldTouch: true,
      });
    },
    [form, tasks]
  );

  const handleTaskChange = (value: string | string[]) => {
    const taskName = value instanceof Array ? value[0] : value;
    form.setValue("task", taskName, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
    applyTaskBillableDefaults(taskName);
    updateProject(taskName);
  };
  const updateProject = useCallback(
    (value: string) => {
      if (selectedProject.length === 0) {
        tasks.find((item: TaskData) => {
          if (item.name === value) {
            setSelectedProject([item.project]);
          }
        });
      }
    },
    [selectedProject, tasks]
  );
  const handleProjectChange = (value: string | string[]) => {
    if (value instanceof Array) {
      setSelectedProject(value);
    } else {
      setSelectedProject([value]);
    }
    setSearchTask("");
    form.setValue("task", "", {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
  };
  const handleInputModeChange = (mode: TimesheetInputMode) => {
    form.setValue("input_mode", mode, { shouldDirty: true, shouldValidate: true });
    setLocalStorage(TIMESHEET_INPUT_MODE_KEY, mode);
  };

  const buildSavePayload = (data: z.infer<typeof TimesheetDraftSchema>) =>
    data.input_mode === "range"
      ? {
          ...data,
          description: data.description || "-",
          hours: 0,
          from_time: data.from_time,
          to_time: data.to_time,
        }
      : {
          ...data,
          description: data.description || "-",
        };

  const canAutoSaveDraft = (data: z.infer<typeof TimesheetDraftSchema>) => {
    if (!data.task) return false;
    if (data.input_mode === "range") {
      return Boolean(data.from_time && data.to_time);
    }
    const parsedHours = timeStringToFloat(String(data.hours ?? ""));
    return !Number.isNaN(parsedHours) && parsedHours > 0;
  };

  const { data: perDayEmpHours, mutate: mutatePerDayHrs } = useFrappeGetCall(
    "next_pms.timesheet.api.timesheet.get_remaining_hour_for_employee",
    {
      employee: selectedEmployee,
      date: selectedDate,
    },
    undefined,
    {
      revalidateOnFocus: false,
    }
  );
  const { data: runningTimer, mutate: mutateRunningTimer } = useFrappeGetCall(
    "next_pms.timesheet.api.timesheet.get_running_timer",
    {
      employee: selectedEmployee,
    },
    undefined,
    {
      revalidateOnFocus: false,
    }
  );
  const activeTimer = runningTimer?.message?.task ? runningTimer.message : null;

  const persistDraft = useCallback(
    async (data: z.infer<typeof TimesheetDraftSchema>, closeOnSuccess = false) => {
      const parsed = TimesheetDraftSchema.safeParse(data);
      debugAddTime("persist requested", {
        closeOnSuccess,
        data,
        parsed: parsed.success,
      });
      if (!parsed.success || !canAutoSaveDraft(parsed.data)) {
        debugAddTime("persist skipped", {
          closeOnSuccess,
          parsedError: parsed.success ? undefined : parsed.error.flatten(),
          canAutoSave: parsed.success ? canAutoSaveDraft(parsed.data) : false,
          data: parsed.success ? parsed.data : data,
        });
        return false;
      }

      const requestId = ++autoSaveRequestRef.current;
      setDraftSaveStatus("saving");
      const payload = buildSavePayload(parsed.data);
      debugAddTime("persist payload", {
        requestId,
        closeOnSuccess,
        payload,
      });

      try {
        const res = await save(payload);
        debugAddTime("persist response", {
          requestId,
          latestRequestId: autoSaveRequestRef.current,
          response: res,
        });
        if (requestId !== autoSaveRequestRef.current) {
          debugAddTime("persist ignored stale response", {
            requestId,
            latestRequestId: autoSaveRequestRef.current,
          });
          return false;
        }
        setDraftSaveStatus("saved");
        mutatePerDayHrs();
        onSuccess?.(parsed.data);
        debugAddTime("persist success", {
          requestId,
          closeOnSuccess,
          data: parsed.data,
        });
        if (closeOnSuccess) {
          closeDialog();
          toast({
            variant: "success",
            description: res.message,
          });
        }
        return true;
      } catch (err) {
        debugAddTime("persist failed", {
          requestId,
          closeOnSuccess,
          rawError: err,
          parsedError: parseFrappeErrorMsg(err),
        });
        if (requestId === autoSaveRequestRef.current) {
          setDraftSaveStatus("error");
          if (closeOnSuccess) {
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
    [save, mutatePerDayHrs, onSuccess, closeDialog, toast]
  );

  const handleSubmit = async (data: z.infer<typeof TimesheetDraftSchema>) => {
    debugAddTime("submit started", data);
    setSubmitting(true);
    const saved = await persistDraft(data, true);
    debugAddTime("submit finished", {
      saved,
      data,
    });
    setSubmitting(false);
  };
  const fetchTask = useCallback(() => {
    setIsTaskLoading(true);
    call
      .get("next_pms.timesheet.api.task.get_task_list", {
        search: searchTask,
        projects: selectedProject,
        page_length: 100,
        filter_recent: true,
      })
      .then((res) => {
        setTask(res.message.task);
        setIsTaskLoading(false);
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
        setIsTaskLoading(false);
      });
  }, [call, searchTask, selectedProject, toast]);

  const { data: projects, isLoading: isProjectLoading } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Project",
    fields: ["name", "project_name"],
    filters: window.frappe?.boot?.global_filters.project,
    limit_page_length: "null",
  });

  const onEmployeeChange = (value: string) => {
    setSelectedEmployee(value);
    form.setValue("employee", value, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
  };
  const formatElapsedTime = (startedAt: string) => {
    const startDate = new Date(startedAt.replace(" ", "T"));
    if (Number.isNaN(startDate.getTime())) return "00:00:00";

    const totalSeconds = Math.max(0, Math.floor((timerTick - startDate.getTime()) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };
  const handleStartTimer = () => {
    const values = form.getValues();
    if (!values.task) {
      toast({
        variant: "destructive",
        description: "Please select a task before starting the timer.",
      });
      return;
    }

    setTimerSubmitting(true);
    startTimer({
      employee: selectedEmployee,
      task: values.task,
      description: values.description,
    })
      .then(() => {
        toast({
          variant: "success",
          description: "Timer started.",
        });
        window.dispatchEvent(new Event("next-pms:timer-updated"));
        mutateRunningTimer();
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
      })
      .finally(() => {
        setTimerSubmitting(false);
      });
  };
  const handleStopTimer = () => {
    setTimerSubmitting(true);
    stopTimer({
      employee: selectedEmployee,
    })
      .then((res) => {
        toast({
          variant: "success",
          description: res.message?.message ?? "Timer stopped.",
        });
        mutateRunningTimer();
        mutatePerDayHrs();
        window.dispatchEvent(new Event("next-pms:timer-updated"));
        onSuccess?.(form.getValues());
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
      })
      .finally(() => {
        setTimerSubmitting(false);
      });
  };

  useEffect(() => {
    updateProject(task);
  }, [task, updateProject]);
  useEffect(() => {
    fetchTask();
  }, [fetchTask, searchTask, selectedProject]);

  useEffect(() => {
    const currentTask = form.getValues("task");
    if (open && currentTask && tasks.length) {
      applyTaskBillableDefaults(currentTask);
    }
  }, [open, tasks, applyTaskBillableDefaults, form]);

  useEffect(() => {
    mutatePerDayHrs();
  }, [mutatePerDayHrs, selectedDate, selectedEmployee]);
  useEffect(() => {
    mutateRunningTimer();
  }, [mutateRunningTimer, selectedEmployee]);
  useEffect(() => {
    if (!activeTimer) return;
    const interval = window.setInterval(() => setTimerTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeTimer]);

  useEffect(() => {
    if (!open) {
      setDraftSaveStatus("idle");
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void persistDraft(values as z.infer<typeof TimesheetDraftSchema>);
      }, 800);
    });

    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [form, open, persistDraft]);

  const {
    formState: { isDirty },
  } = form;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-xl" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex gap-x-2 items-center">
            Add Time
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
            {draftSaveStatus === "error" && (
              <Typography variant="small" className="text-destructive">
                Draft save failed
              </Typography>
            )}
            <Typography
              variant="p"
              className={mergeClassNames(
                Number(perDayEmpHours?.message) >= 0 && Number(perDayEmpHours?.message) <= expectedHours
                  ? "text-success"
                  : "text-destructive"
              )}
            >
              {perDayEmpHours
                ? `${floatToTime(Math.abs(perDayEmpHours?.message))} hrs ${
                    perDayEmpHours?.message < 0 ? "extended" : "remaining"
                  }`
                : ""}
            </Typography>
          </DialogTitle>
          {activeTimer && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Typography variant="p" className="font-medium text-success">
                Running {formatElapsedTime(activeTimer.started_at)}
              </Typography>
              <Typography variant="p" className="truncate text-muted-foreground max-w-96" title={activeTimer.task_subject}>
                {activeTimer.task_subject}
              </Typography>
            </div>
          )}
          <Separator />
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="flex flex-col gap-y-4">
              <InputModeToggle value={inputMode} onChange={handleInputModeChange} />
              <div className="grid max-sm:gap-y-4 sm:gap-x-4 max-sm:grid-rows-2 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="employee"
                  render={() => (
                    <FormItem className="w-full space-y-1">
                      <FormLabel className="flex gap-2 items-center text-sm">Employee</FormLabel>
                      <FormControl>
                        <EmployeeCombo
                          onSelect={onEmployeeChange}
                          value={selectedEmployee}
                          employeeName={employeeName}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className={mergeClassNames("grid gap-x-4", inputMode === "range" ? "grid-cols-1" : "grid-cols-2")}>
                  {inputMode === "duration" ? (
                    <FormField
                      control={form.control}
                      name="hours"
                      render={({ field }) => (
                        <FormItem className="w-full space-y-1">
                          <FormLabel className="flex gap-2 items-center">
                            <p className="text-sm">Time</p>
                          </FormLabel>
                          <FormControl>
                            <div className=" flex w-full border rounded-md ">
                              <Input
                                placeholder="00:00"
                                className="placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 border-r rounded-none px-2"
                                type="text"
                                {...field}
                              />
                              <TimeSelector onClick={UpdateTime} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <TimeRangeFields
                      fromTime={form.watch("from_time") || ""}
                      toTime={form.watch("to_time") || ""}
                      onFromTimeChange={(value) =>
                        form.setValue("from_time", value, { shouldDirty: true, shouldValidate: true })
                      }
                      onToTimeChange={(value) =>
                        form.setValue("to_time", value, { shouldDirty: true, shouldValidate: true })
                      }
                      fromError={form.formState.errors.from_time?.message}
                      toError={form.formState.errors.to_time?.message}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem className="w-full space-y-1">
                        <FormLabel className="flex gap-2 items-center text-sm">Date</FormLabel>
                        <FormControl>
                          <DatePicker date={field.value} onDateChange={handleDateChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              <div className="grid gap-x-4 grid-cols-2">
                <FormItem className="space-y-1">
                  <FormLabel>Projects</FormLabel>
                  <ComboBox
                    label="Search Projects"
                    showSelected
                    shouldFilter
                    value={selectedProject}
                    data={projects?.message?.map((item: { project_name: string; name: string }) => ({
                      label: item.project_name,
                      value: item.name,
                      disabled: false,
                    }))}
                    isLoading={isProjectLoading}
                    onSelect={handleProjectChange}
                    rightIcon={<Search className="h-4 w-4 stroke-slate-400" />}
                  />
                </FormItem>
                <FormField
                  control={form.control}
                  name="task"
                  render={() => (
                    <FormItem className="space-y-1">
                      <FormLabel>Tasks</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Task"
                          showSelected
                          deBounceTime={200}
                          value={
                            form.getValues("task") && form.getValues("task").length > 0 ? [form.getValues("task")] : []
                          }
                          isLoading={isTaskLoading}
                          data={
                            tasks.map((item: TaskData) => ({
                              label: item.subject,
                              value: item.name,
                              description: item.project_name as string,
                              disabled: false,
                            })) ?? []
                          }
                          onSelect={handleTaskChange}
                          onSearch={handleTaskSearch}
                          rightIcon={<Search className="h-4 w-4  stroke-slate-400" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {form.watch("task") && (
                <BillableFields
                  control={form.control}
                  isBillableName="is_billable"
                  reasonName="billable_override_reason"
                  projectDefault={form.watch("project_default_is_billable")}
                  watchedIsBillable={form.watch("is_billable")}
                />
              )}
              <TimesheetDescriptionField
                control={form.control}
                name="description"
                required={descriptionRequired}
                label="Work description"
              />
              <DialogFooter className="sm:justify-start w-full pt-3">
                <div className="flex flex-wrap gap-3 w-full">
                  <Button disabled={!isDirty || submitting}>
                    {submitting ? <LoaderCircle className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />}
                    Save & Close
                  </Button>
                  {activeTimer ? (
                    <Button variant="destructive" type="button" onClick={handleStopTimer} disabled={timerSubmitting}>
                      {timerSubmitting ? (
                        <LoaderCircle className="animate-spin w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      Stop Timer
                    </Button>
                  ) : (
                    <Button variant="outline" type="button" onClick={handleStartTimer} disabled={timerSubmitting}>
                      {timerSubmitting ? (
                        <LoaderCircle className="animate-spin w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Start Timer
                    </Button>
                  )}
                  <Button variant="secondary" type="button" onClick={handleOpen} disabled={submitting}>
                    <X className="w-4 h-4" />
                    Cancel
                  </Button>
                </div>
              </DialogFooter>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddTime;
