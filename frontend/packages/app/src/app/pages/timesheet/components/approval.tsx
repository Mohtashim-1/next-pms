/**
 * External dependencies.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ComboBox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  TextArea,
  Separator,
} from "@next-pms/design-system/components";
import { floatToTime } from "@next-pms/design-system/utils";
import { prettyDate } from "@next-pms/design-system/date";
import { useToast } from "@next-pms/design-system/hooks";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { LoaderCircle, Send } from "lucide-react";
import { z } from "zod";
/**
 * Internal dependencies.
 */
import { parseFrappeErrorMsg } from "@/lib/utils";
import { TimesheetApprovalSchema } from "@/schema/timesheet";
import type { ApprovalProps } from "./types";

type SubmissionSummary = {
  period_type: string;
  start_date: string;
  end_date: string;
  timesheet_count: number;
  entry_count: number;
  task_count: number;
  project_count: number;
  total_hours: number;
  expected_hours: number;
  warnings: string[];
  violations: string[];
  can_submit: boolean;
};

export const Approval = ({ onClose, user, timesheetState, dispatch }: ApprovalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { call } = useFrappePostCall("next_pms.timesheet.api.timesheet.submit_for_approval");
  const { data } = useFrappeGetCall("next_pms.timesheet.api.get_employee_with_role", {
    role: ["Projects Manager", "Projects User"],
  });
  const { data: summaryData, isLoading: isValidating } = useFrappeGetCall(
    "next_pms.timesheet.api.timesheet.validate_submission",
    {
      start_date: timesheetState.dateRange.start_date,
      employee: user.employee,
    }
  );
  const summary = summaryData?.message as SubmissionSummary | undefined;
  const form = useForm<z.infer<typeof TimesheetApprovalSchema>>({
    resolver: zodResolver(TimesheetApprovalSchema),
    defaultValues: {
      start_date: timesheetState.dateRange.start_date,
      end_date: timesheetState.dateRange.end_date,
      employee: user.employee,
      approver: user.reportsTo,
      notes: "",
    },
    mode: "onSubmit",
  });

  const handleOpen = () => {
    if (isSubmitting) return;
    form.reset();
    const data = { start_date: "", end_date: "" };
    dispatch({ type: "SET_DATE_RANGE", payload: data });
    dispatch({ type: "SET_APPROVAL_DIALOG_STATE", payload: false });
    onClose?.(form.getValues());
  };
  const handleSubmit = (data: z.infer<typeof TimesheetApprovalSchema>) => {
    setIsSubmitting(true);
    call(data)
      .then((res) => {
        toast({
          variant: "success",
          description: res.message,
        });
        setIsSubmitting(false);
        handleOpen();
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
        setIsSubmitting(false);
      });
  };
  return (
    <Dialog open={timesheetState.isAprrovalDialogOpen} onOpenChange={handleOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {`Week of ${prettyDate(timesheetState.dateRange.start_date).date} -
             ${prettyDate(timesheetState.dateRange.end_date).date}`}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="font-normal">Note</FormLabel>
                  <FormControl>
                    <TextArea
                      placeholder="Add a note"
                      rows={4}
                      className="w-full placeholder:text-slate-400"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator className="my-4" />
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Period</div>
                  <div className="font-medium">{summary?.period_type ?? "Weekly"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Total</div>
                  <div className="font-medium">{summary ? floatToTime(summary.total_hours) : "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Expected</div>
                  <div className="font-medium">{summary ? floatToTime(summary.expected_hours) : "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Entries</div>
                  <div className="font-medium">{summary?.entry_count ?? "-"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">Timesheets</div>
                  <div className="font-medium">{summary?.timesheet_count ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Tasks</div>
                  <div className="font-medium">{summary?.task_count ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Projects</div>
                  <div className="font-medium">{summary?.project_count ?? "-"}</div>
                </div>
              </div>
              {isValidating && <div className="text-muted-foreground">Checking submission rules...</div>}
              {summary?.warnings?.length ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-warning">
                  {summary.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}
              {summary?.violations?.length ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                  {summary.violations.map((violation) => (
                    <div key={violation}>{violation}</div>
                  ))}
                </div>
              ) : null}
            </div>
            <FormField
              control={form.control}
              name="approver"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="w-full flex items-center gap-x-2 mt-2">
                      <FormLabel className="font-normal">Send To</FormLabel>
                      <ComboBox
                        label="Select an Approver"
                        className="max-w-48"
                        value={[field.value]}
                        onSelect={(value) => {
                          form.setValue("approver", value[0]);
                        }}
                        data={data?.message?.map((item: { name: string; employee_name: string }) => ({
                          value: item.name,
                          label: item.employee_name,
                        }))}
                        shouldFilter
                        showSelected
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:justify-start mt-6">
              <Button disabled={isSubmitting || isValidating || !summary?.can_submit}>
                {isSubmitting ? <LoaderCircle className="animate-spin" /> : <Send />}
                Submit For Approval
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
