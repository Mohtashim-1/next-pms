/**
 * External dependencies
 */
import { Button, Typography } from "@next-pms/design-system/components";
import { mergeClassNames } from "@next-pms/design-system/utils";

/**
 * Internal dependencies
 */
import type { TimesheetInputMode } from "@/lib/timesheetTime";

type InputModeToggleProps = {
  value: TimesheetInputMode;
  onChange: (mode: TimesheetInputMode) => void;
  className?: string;
};

export const InputModeToggle = ({ value, onChange, className }: InputModeToggleProps) => {
  return (
    <div className={mergeClassNames("inline-flex rounded-md border p-0.5", className)}>
      <Button
        type="button"
        size="sm"
        variant={value === "duration" ? "default" : "ghost"}
        className="h-7 px-3"
        onClick={() => onChange("duration")}
      >
        <Typography variant="small">Duration</Typography>
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "range" ? "default" : "ghost"}
        className="h-7 px-3"
        onClick={() => onChange("range")}
      >
        <Typography variant="small">Start / End</Typography>
      </Button>
    </div>
  );
};
