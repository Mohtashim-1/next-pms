/**
 * External dependencies.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  Button,
  Separator,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Spinner,
  Typography,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@next-pms/design-system/components";
import { useToast } from "@next-pms/design-system/components";
import { getUTCDateTime, getFormatedDate, getTodayDate } from "@next-pms/design-system/date";
import { floatToTime } from "@next-pms/design-system/utils";
import { useQueryParam } from "@next-pms/hooks";
import { useFrappeEventListener, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { isEmpty } from "lodash";
import { Calendar, CalendarArrowDown, EllipsisVertical, Paperclip, Plus, Table2 } from "lucide-react";

/**
 * Internal dependencies.
 */
import { PeriodLockAdmin } from "@/app/components/timesheet-period-lock/periodLockAdmin";
import { TimesheetTable } from "@/app/components/timesheet-table";
import { SubmitButton } from "@/app/components/timesheet-table/components/submitButton";
import { Header, Main } from "@/app/layout/root";
import { isWeekLocked as isTimesheetWeekLocked } from "@/lib/timesheetStatus";
import {
  filterTimesheetWeeksToMonth,
  getCurrentMonthBounds,
  getCurrentMonthLabel,
  MAX_WEEKS_PER_MONTH,
} from "@/lib/timesheetMonthView";
import { parseFrappeErrorMsg, expectatedHours, copyToClipboard, isDateInRange, getTimesheetHours } from "@/lib/utils";
import type { RootState } from "@/store";
import type { WorkingFrequency } from "@/types";
import type { NewTimesheetProps, timesheet } from "@/types/timesheet";
import ExpandableHours from "./components/expandableHours";
import { Footer } from "./components/footer";
import { initialState, reducer } from "./reducer";
import { validateDate } from "./utils";

function filterPayloadToCurrentMonth<T extends { data: Record<string, timesheet> }>(
  payload: T,
  monthBounds: ReturnType<typeof getCurrentMonthBounds>
): T {
  return {
    ...payload,
    data: filterTimesheetWeeksToMonth(payload.data ?? {}, monthBounds),
  };
}

function Timesheet() {
  const targetRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const [startDateParam, setStartDateParam] = useQueryParam<string>("date", "");
  const user = useSelector((state: RootState) => state.user);
  const monthBounds = useMemo(() => getCurrentMonthBounds(), []);
  const monthLabel = useMemo(() => getCurrentMonthLabel(), []);
  const [timesheet, dispatch] = useReducer(reducer, initialState);
  const dailyWorkingHour = expectatedHours(user.workingHours, user.workingFrequency);
  const { data, isLoading, error, mutate } = useFrappeGetCall("next_pms.timesheet.api.timesheet.get_timesheet_data", {
    employee: user.employee,
    start_date: getTodayDate(),
    max_week: MAX_WEEKS_PER_MONTH,
    current_month_only: 1,
  });
  const { call: recallTimesheet, loading: isRecalling } = useFrappePostCall(
    "next_pms.timesheet.api.timesheet.recall_timesheet"
  );
  const { call: abandonDraft, loading: isAbandoningDraft } = useFrappePostCall(
    "next_pms.timesheet.api.timesheet.abandon_draft"
  );

  useEffect(() => {
    const scrollToElement = () => {
      if (targetRef.current) {
        targetRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    const observer = new MutationObserver(scrollToElement);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    dispatch({ type: "SET_DATA", payload: { ...initialState.data } });
    dispatch({ type: "SET_WEEK_DATE", payload: getTodayDate() });
  }, [user.employee]);

  useEffect(() => {
    if (data) {
      dispatch({ type: "SET_DATA", payload: filterPayloadToCurrentMonth(data.message, monthBounds) });
    }
    if (error) {
      const err = parseFrappeErrorMsg(error);
      toast({
        variant: "destructive",
        description: err,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dispatch, error, toast, monthBounds]);

  useEffect(() => {
    if (Object.keys(timesheet.data.data).length == 0) return;
    if (startDateParam && startDateParam < monthBounds.start) {
      setStartDateParam("");
      return;
    }
    if (!startDateParam) return;
    if (!validateDate(startDateParam, timesheet)) {
      setStartDateParam("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, startDateParam, timesheet.data.data, monthBounds.start]);

  useFrappeEventListener(`timesheet_update::${user.employee}`, (payload) => {
    const res = filterPayloadToCurrentMonth(payload.message, monthBounds);
    const key = Object.keys(res.data)[0];
    if (!key || !Object.prototype.hasOwnProperty.call(timesheet.data.data, key)) {
      return;
    }
    dispatch({ type: "APPEND_DATA", payload: res });
    mutate();
  });
  const { call: fetchLikedTask, loading: loadingLikedTasks } = useFrappePostCall(
    "next_pms.timesheet.api.task.get_liked_tasks"
  );
  const [likedTaskData, setLikedTaskData] = useState([]);

  const getLikedTaskData = () => {
    fetchLikedTask({}).then((res) => {
      setLikedTaskData(res.message ?? []);
    });
  };

  const handleTimesheetRefresh = useCallback(
    (savedDate?: string) => {
      if (typeof savedDate === "string" && savedDate) {
        const parsed = getUTCDateTime(savedDate);
        if (!Number.isNaN(new Date(parsed).getTime())) {
          const formatted = getFormatedDate(parsed);
          dispatch({ type: "SET_WEEK_DATE", payload: formatted });
          setStartDateParam(formatted);
        }
      }
      mutate();
      getLikedTaskData();
    },
    [mutate, setStartDateParam]
  );

  useEffect(() => {
    getLikedTaskData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddTime = () => {
    const timesheetData = {
      name: "",
      task: "",
      date: getFormatedDate(getUTCDateTime()),
      description: "",
      hours: 0,
      employee: user.employee,
      project: "",
    };
    dispatch({ type: "SET_TIMESHEET", payload: timesheetData });
    dispatch({ type: "SET_DIALOG_STATE", payload: true });
  };
  const handleAddLeave = () => {
    dispatch({ type: "SET_LEAVE_DIALOG_STATE", payload: true });
  };

  const onCellClick = (data: NewTimesheetProps) => {
    data.employee = user.employee;
    dispatch({ type: "SET_TIMESHEET", payload: data });
    if (data.hours > 0) {
      dispatch({ type: "SET_EDIT_DIALOG_STATE", payload: true });
    } else {
      dispatch({ type: "SET_DIALOG_STATE", payload: true });
    }
  };

  const handleApproval = (start_date: string, end_date: string) => {
    const approvalRange = {
      start_date: start_date,
      end_date: end_date,
    };
    dispatch({ type: "SET_DATE_RANGE", payload: approvalRange });
    dispatch({ type: "SET_APPROVAL_DIALOG_STATE", payload: true });
  };

  const handleRecall = (start_date: string) => {
    if (isRecalling) return;
    recallTimesheet({
      start_date,
      employee: user.employee,
    })
      .then((res) => {
        toast({
          variant: "success",
          description: res.message,
        });
        mutate();
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
      });
  };

  const handleAbandonDraft = (start_date: string) => {
    if (isAbandoningDraft) return;
    if (!window.confirm("Discard all draft time entries for this week? This cannot be undone.")) {
      return;
    }

    abandonDraft({
      start_date,
      employee: user.employee,
    })
      .then((res) => {
        toast({
          variant: "success",
          description: res.message,
        });
        mutate();
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
      });
  };

  const handleImportTaskFromGoogleCalendar = () => {
    dispatch({ type: "SET_IMPORT_FROM_GOOGLE_CALENDAR_DIALOG_STATE", payload: true });
  };

  const handleOpenTimesheetGrid = () => {
    dispatch({ type: "SET_TIMESHEET_GRID_DIALOG_STATE", payload: true });
  };

  const visibleWeekEntries = useMemo(
    () =>
      Object.entries(
        filterTimesheetWeeksToMonth(timesheet.data?.data ?? {}, monthBounds)
      ),
    [timesheet.data?.data, monthBounds]
  );
  const visibleWeekCount = visibleWeekEntries.length;

  return (
    <>
      <Header className="justify-end gap-x-3">
        {window.frappe?.boot?.user?.can_create.includes("Leave Application") && (
          <Button variant="outline" onClick={handleAddLeave} title="Add Time">
            <Plus />
            Leave
          </Button>
        )}

        <PeriodLockAdmin
          roles={user.roles}
          periodLocks={timesheet.data.period_locks ?? []}
          onUpdated={mutate}
        />

        <Button onClick={handleAddTime} title="Add Time">
          <Plus />
          Time
        </Button>
        <Button variant="outline" onClick={handleOpenTimesheetGrid} title="Time Sheet grid">
          <Table2 />
          Time Sheet
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="mr-2 [&_div]:cursor-pointer  [&_div]:gap-x-2">
            <DropdownMenuItem onClick={handleOpenTimesheetGrid}>
              <Table2 />
              <Typography variant="p">Time Sheet</Typography>
            </DropdownMenuItem>
            {window.frappe?.boot?.is_calendar_setup && (
              <DropdownMenuItem onClick={handleImportTaskFromGoogleCalendar}>
                <CalendarArrowDown />
                <Typography variant="p">Import Events From Google Calendar</Typography>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </Header>

      {isLoading && Object.keys(timesheet.data?.data).length == 0 ? (
        <Spinner isFull />
      ) : (
        <>
          {visibleWeekCount === 0 ? (
            <Typography className="flex items-center justify-center">No Data</Typography>
          ) : (
            <Main className="w-full h-full overflow-y-auto">
              <div className="mb-3 px-1">
                <Typography variant="small" className="text-muted-foreground">
                  Showing {monthLabel} only
                </Typography>
              </div>
              <div className="w-full space-y-0">
                {visibleWeekEntries.map(([key, value]: [string, timesheet]) => {
                    const weekLocked = isTimesheetWeekLocked(value.status);
                    const data = getTimesheetHours(
                      value.dates,
                      value.total_hours,
                      timesheet.data.leaves,
                      timesheet.data.holidays,
                      dailyWorkingHour
                    );
                    return (
                      <Accordion type="single" collapsible key={key} defaultValue={key}>
                        <AccordionItem value={key}>
                          <AccordionTrigger className="hover:no-underline w-full py-2 max-md:[&>svg]:hidden">
                            <div className="flex justify-between items-center w-full group gap-2 ">
                              <div className="font-normal text-xs sm:text-base flex items-center gap-x-2 max-md:gap-x-3 sm:flex-row overflow-x-auto  max-md:w-4/5">
                                <span className="flex items-center gap-2 shrink-0">
                                  <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                                  <h2 className="font-medium">{key}</h2>
                                </span>
                                <Separator orientation="vertical" className="block h-5 shrink-0" />
                                <ExpandableHours
                                  totalHours={floatToTime(data.totalHours)}
                                  workingHours={floatToTime(data.totalHours - data.timeOffHours)}
                                  timeoffHours={floatToTime(data.timeOffHours)}
                                />
                                <Paperclip
                                  className="w-3 h-3 hidden group-hover:block shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setStartDateParam(getFormatedDate(value.start_date));
                                    copyToClipboard(
                                      `${window.location.origin}${window.location.pathname}?date="${value.start_date}"`
                                    );
                                  }}
                                />
                              </div>
                              <SubmitButton
                                start_date={value.start_date}
                                end_date={value.end_date}
                                onApproval={handleApproval}
                                onRecall={handleRecall}
                                onAbandonDraft={handleAbandonDraft}
                                status={value.status}
                                expectedHours={timesheet.data.working_hour}
                                totalHours={data.totalHours}
                                workingFrequency={timesheet.data.working_frequency as WorkingFrequency}
                              />
                            </div>
                          </AccordionTrigger>
                          <AccordionContent
                            className="pb-0"
                            ref={
                              !isEmpty(startDateParam) &&
                              isDateInRange(startDateParam, value.start_date, value.end_date)
                                ? targetRef
                                : null
                            }
                          >
                            <TimesheetTable
                              workingHour={timesheet.data.working_hour}
                              workingFrequency={timesheet.data.working_frequency as WorkingFrequency}
                              dates={value.dates}
                              holidays={timesheet.data.holidays}
                              leaves={timesheet.data.leaves}
                              tasks={value.tasks}
                              onCellClick={onCellClick}
                              weeklyStatus={value.status}
                              disabled={weekLocked}
                              importTasks={true}
                              loadingLikedTasks={loadingLikedTasks}
                              likedTaskData={likedTaskData}
                              getLikedTaskData={getLikedTaskData}
                              employee={user.employee}
                              onSaved={mutate}
                              enableInlineEdit={!weekLocked}
                              periodLocks={timesheet.data.period_locks ?? []}
                            />
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    );
                  })}
              </div>
            </Main>
          )}
        </>
      )}
      <Footer timesheet={timesheet} user={user} dispatch={dispatch} callback={handleTimesheetRefresh} />
    </>
  );
}

export default Timesheet;
