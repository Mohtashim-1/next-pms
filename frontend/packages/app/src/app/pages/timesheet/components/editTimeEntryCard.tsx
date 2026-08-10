/**
 * Single time-entry card for the Edit Time dialog.
 */
import {
  Button,
  DatePicker,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Typography,
} from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { floatToTime, mergeClassNames } from "@next-pms/design-system/utils";
import { CalendarDays, Trash2 } from "lucide-react";
import type { Control, UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { z } from "zod";

import { TimePickerField } from "@/app/components/timesheet-input/timePickerField";
import { BillableFields } from "@/app/components/timesheet-billable/billableFields";
import { TimesheetDescriptionField } from "@/app/components/timesheet-description/descriptionField";
import { TimeRangeFields } from "@/app/components/timesheet-input/timeRangeFields";
import type { TimesheetInputMode } from "@/lib/timesheetTime";
import { timeStringToFloat, TimesheetDraftUpdateSchema } from "@/schema/timesheet";

type FormValues = z.infer<typeof TimesheetDraftUpdateSchema>;

type EditTimeEntryCardProps = {
  index: number;
  entryNumber: number;
  control: Control<FormValues>;
  form: UseFormReturn<FormValues>;
  inputMode: TimesheetInputMode;
  descriptionRequired: boolean;
  projectDefaultIsBillable?: boolean | number | null;
  onRemove: () => void;
};

function getEntryDuration(
  row: FormValues["data"][number] | undefined,
  mode: TimesheetInputMode
): string | null {
  if (!row) return null;

  if (mode === "duration") {
    const hours = timeStringToFloat(String(row.hours ?? ""));
    if (Number.isNaN(hours) || hours <= 0) return null;
    return floatToTime(hours);
  }

  const from = timeStringToFloat(row.from_time ?? "");
  const to = timeStringToFloat(row.to_time ?? "");
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;
  return floatToTime(to - from);
}

export const EditTimeEntryCard = ({
  index,
  entryNumber,
  control,
  form,
  inputMode,
  descriptionRequired,
  projectDefaultIsBillable,
  onRemove,
}: EditTimeEntryCardProps) => {
  const row = useWatch({ control, name: `data.${index}` });
  const duration = getEntryDuration(row, inputMode);

  return (
    <article
      className={mergeClassNames(
        "group relative overflow-hidden rounded-xl border bg-card shadow-sm",
        "focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary/20"
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {entryNumber}
          </span>
          <Typography variant="small" className="font-medium text-muted-foreground">
            Time entry
          </Typography>
        </div>
        <div className="flex items-center gap-2">
          {duration && (
            <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-semibold tabular-nums shadow-sm ring-1 ring-border">
              {duration}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            type="button"
            title="Remove entry"
            aria-label="Remove entry"
            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(9rem,11rem)_1fr]">
          <FormField
            control={control}
            name={`data.${index}.date`}
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Date
                </FormLabel>
                <FormControl>
                  <div className="[&_button]:h-10 [&_button]:min-h-10 [&_button]:w-full [&_button]:justify-start [&_button]:rounded-lg [&_button]:border-muted-foreground/20 [&_button]:bg-background [&_button]:text-sm">
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

          {inputMode === "duration" ? (
            <FormField
              control={control}
              name={`data.${index}.hours`}
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-xs font-medium text-muted-foreground">Duration</FormLabel>
                  <FormControl>
                    <TimePickerField
                      className="h-10"
                      value={field.value || ""}
                      showNow={false}
                      minutesStep={15}
                      ariaLabel="Duration"
                      placeholder="1:30 or 1.5"
                      onChange={(time) => {
                        field.onChange(time);
                        form.setValue(`data.${index}.hours`, time, {
                          shouldValidate: true,
                          shouldDirty: true,
                          shouldTouch: true,
                        });
                      }}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          ) : (
            <div className="space-y-1.5">
              <FormLabel className="text-xs font-medium text-muted-foreground">Start & end</FormLabel>
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
        </div>

        <TimesheetDescriptionField
          control={control}
          name={`data.${index}.description`}
          required={descriptionRequired}
          label="Description"
          placeholder="What did you work on?"
          layout="card"
        />

        <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 px-3 py-2.5">
          <BillableFields
            layout="card"
            control={control}
            isBillableName={`data.${index}.is_billable`}
            reasonName={`data.${index}.billable_override_reason`}
            projectDefault={projectDefaultIsBillable}
            watchedIsBillable={form.watch(`data.${index}.is_billable`)}
            showDefaultHint={false}
          />
        </div>
      </div>
    </article>
  );
};
