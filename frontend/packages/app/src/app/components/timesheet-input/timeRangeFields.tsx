/**
 * External dependencies
 */
import { FormControl, FormItem, FormLabel, FormMessage, Input } from "@next-pms/design-system/components";
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
        <div className="flex items-center gap-1.5">
          <TimePickerField value={fromTime} onChange={onFromTimeChange} placeholder="09:00" className="min-w-0 flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>
            –
          </span>
          <TimePickerField value={toTime} onChange={onToTimeChange} placeholder="17:00" className="min-w-0 flex-1" />
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
          <Input placeholder="09:00" value={fromTime} onChange={(e) => onFromTimeChange(e.target.value)} />
        </FormControl>
        {fromError && <FormMessage>{fromError}</FormMessage>}
      </FormItem>
      <FormItem className="space-y-1">
        <FormLabel className="text-sm">End</FormLabel>
        <FormControl>
          <Input placeholder="17:00" value={toTime} onChange={(e) => onToTimeChange(e.target.value)} />
        </FormControl>
        {toError && <FormMessage>{toError}</FormMessage>}
      </FormItem>
    </div>
  );
};
