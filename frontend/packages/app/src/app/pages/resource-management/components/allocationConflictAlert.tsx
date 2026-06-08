/**
 * External dependencies
 */
import { AlertTriangle } from "lucide-react";
import { Typography } from "@next-pms/design-system/components";

export type AllocationConflictAssignment = {
  name: string;
  project?: string;
  project_name?: string;
  hours_allocated_per_day: number;
  status?: string;
};

export type AllocationConflictDay = {
  date: string;
  capacity_hours: number;
  existing_hours: number;
  proposed_hours: number;
  total_hours: number;
  over_by: number;
  reason?: string;
  assignments: AllocationConflictAssignment[];
};

export type AllocationConflictResult = {
  has_conflicts: boolean;
  action: "Warn" | "Block";
  conflicts: AllocationConflictDay[];
};

type AllocationConflictAlertProps = {
  result?: AllocationConflictResult | null;
  loading?: boolean;
};

export const AllocationConflictAlert = ({ result, loading }: AllocationConflictAlertProps) => {
  if (loading) {
    return (
      <Typography variant="small" className="text-muted-foreground">
        Checking for assignment conflicts…
      </Typography>
    );
  }

  if (!result?.has_conflicts) {
    return null;
  }

  const isBlocked = result.action === "Block";

  return (
    <div
      className={
        isBlocked
          ? "rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2"
          : "rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2"
      }
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        <AlertTriangle className={`h-4 w-4 ${isBlocked ? "text-destructive" : "text-amber-600"}`} />
        {isBlocked ? "Allocation blocked — daily capacity exceeded" : "Allocation warning — conflicting assignments"}
      </div>

      <div className="space-y-2 max-h-40 overflow-y-auto">
        {result.conflicts.map((conflict) => (
          <div key={conflict.date} className="text-xs space-y-1">
            <Typography variant="small" className="font-medium block">
              {conflict.date}: {conflict.total_hours}h planned / {conflict.capacity_hours}h capacity
              {conflict.over_by > 0 ? ` (+${conflict.over_by}h over)` : ""}
              {conflict.reason ? ` — ${conflict.reason}` : ""}
            </Typography>
            {conflict.assignments.length > 0 && (
              <ul className="list-disc pl-4 text-muted-foreground">
                {conflict.assignments.map((assignment) => (
                  <li key={assignment.name}>
                    {assignment.project_name || assignment.project || assignment.name}: {assignment.hours_allocated_per_day}h/day
                    {assignment.status ? ` (${assignment.status})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
