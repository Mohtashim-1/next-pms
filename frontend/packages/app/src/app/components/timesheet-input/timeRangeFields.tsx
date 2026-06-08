/**
 * External dependencies
 */
import { FormControl, FormItem, FormLabel, FormMessage, Input } from "@next-pms/design-system/components";
import { mergeClassNames } from "@next-pms/design-system/utils";

type TimeRangeFieldsProps = {
  fromTime: string;
  toTime: string;
  onFromTimeChange: (value: string) => void;
  onToTimeChange: (value: string) => void;
  fromError?: string;
  toError?: string;
  className?: string;
};

export const TimeRangeFields = ({
  fromTime,
  toTime,
  onFromTimeChange,
  onToTimeChange,
  fromError,
  toError,
  className,
}: TimeRangeFieldsProps) => {
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
