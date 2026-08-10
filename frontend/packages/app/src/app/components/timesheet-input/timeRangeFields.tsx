/**
 * External dependencies
 */
import { FormControl, FormItem, FormLabel, FormMessage } from "@next-pms/design-system/components";
import { mergeClassNames } from "@next-pms/design-system/utils";

import { TimePickerField } from "@/app/components/timesheet-input/timePickerField";

type TimeRangeFieldsProps = {
  fromTime: string;
  toTime: string;
  onFromTimeChange: (value: string) => void;
  onToTimeChange: (value: string) => void;
  fromError?: string;
  toError?: string;
  className?: string;
  compact?: boolean;
};

export const TimeRangeFields = ({
  fromTime,
  toTime,
  onFromTimeChange,
  onToTimeChange,
  fromError,
  toError,
  className,
  compact = false,
}: TimeRangeFieldsProps) => {
  if (compact) {
    return (
      <div className={mergeClassNames("space-y-1", className)}>
        <div className="flex items-center gap-2">
          <TimePickerField
            value={fromTime}
            onChange={onFromTimeChange}
            placeholder="9:00"
            className="min-w-0 flex-1 h-10"
            ariaLabel="Start time"
            hour12
          />
          <span className="shrink-0 px-0.5 text-sm text-muted-foreground" aria-hidden>
            –
          </span>
          <TimePickerField
            value={toTime}
            onChange={onToTimeChange}
            placeholder="5:00"
            className="min-w-0 flex-1 h-10"
            ariaLabel="End time"
            hour12
          />
        </div>
        {(fromError || toError) && (
          <p className="text-xs text-destructive">{fromError || toError}</p>
        )}
      </div>
    );
  }

  return (
    <div className={mergeClassNames("grid grid-cols-2 gap-x-4", className)}>
      <FormItem className="space-y-1">
        <FormLabel className="text-sm">Start</FormLabel>
        <FormControl>
          <TimePickerField
            value={fromTime}
            onChange={onFromTimeChange}
            placeholder="9:00"
            className="h-10"
            ariaLabel="Start time"
            hour12
          />
        </FormControl>
        {fromError && <FormMessage>{fromError}</FormMessage>}
      </FormItem>
      <FormItem className="space-y-1">
        <FormLabel className="text-sm">End</FormLabel>
        <FormControl>
          <TimePickerField
            value={toTime}
            onChange={onToTimeChange}
            placeholder="5:00"
            className="h-10"
            ariaLabel="End time"
            hour12
          />
        </FormControl>
        {toError && <FormMessage>{toError}</FormMessage>}
      </FormItem>
    </div>
  );
};
