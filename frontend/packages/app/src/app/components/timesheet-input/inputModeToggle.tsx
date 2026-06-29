/**
 * External dependencies
 */
import { Button, Typography } from "@next-pms/design-system/components";
import { mergeClassNames } from "@next-pms/design-system/utils";
import { Clock, Timer } from "lucide-react";

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
    <div className={mergeClassNames("space-y-2", className)}>
      <Typography variant="small" className="font-medium text-muted-foreground">
        How do you want to log time ?  <br/>
        
      </Typography>
      <div className="inline-flex rounded-xl bg-muted/80 p-1 ring-1 ring-border/60">
        <Button
          type="button"
          size="sm"
          variant={value === "duration" ? "default" : "ghost"}
          className={mergeClassNames(
            "h-9 gap-2 rounded-lg px-4",
            value !== "duration" && "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onChange("duration")}
        >
          <Timer className="h-4 w-4" />
          Duration
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value === "range" ? "default" : "ghost"}
          className={mergeClassNames(
            "h-9 gap-2 rounded-lg px-4",
            value !== "range" && "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onChange("range")}
        >
          <Clock className="h-4 w-4" />
          Start & end
        </Button>
      </div>
    </div>
  );
};
