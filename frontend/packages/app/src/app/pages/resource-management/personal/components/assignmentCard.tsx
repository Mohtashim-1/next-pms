/**
 * External dependencies.
 */
import { Badge, Card, CardContent, Typography } from "@next-pms/design-system/components";
import { prettyDate } from "@next-pms/design-system/date";
import { CalendarDays, Clock3 } from "lucide-react";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import type { PersonalAllocation } from "../types";

const getDueBadgeVariant = (dueDate: string) => {
  const today = new Date().toISOString().slice(0, 10);
  const daysUntilDue = Math.ceil(
    (new Date(dueDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilDue < 0) return "outline";
  if (daysUntilDue <= 7) return "destructive";
  if (daysUntilDue <= 14) return "secondary";
  return "outline";
};

export const AssignmentCard = ({
  allocation,
  highlightDue = false,
}: {
  allocation: PersonalAllocation;
  highlightDue?: boolean;
}) => {
  const start = prettyDate(allocation.allocation_start_date);
  const end = prettyDate(allocation.allocation_end_date);

  return (
    <Card className="border shadow-none">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Typography variant="p" className="font-semibold truncate">
              {allocation.project_name || allocation.project || "Assignment"}
            </Typography>
            {allocation.status && (
              <Typography variant="small" className="text-muted-foreground">
                {allocation.status}
              </Typography>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {allocation.is_billable ? (
              <Badge variant="default">Billable</Badge>
            ) : (
              <Badge variant="outline">Non-Billable</Badge>
            )}
            {highlightDue && (
              <Badge variant={getDueBadgeVariant(allocation.allocation_end_date)}>
                Due {end.date}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>
              {start.date} – {end.date}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span>{allocation.hours_allocated_per_day || 0}h / day</span>
          </div>
        </div>

        {allocation.note && (
          <Typography
            variant="small"
            className={mergeClassNames("text-muted-foreground line-clamp-3")}
          >
            {allocation.note}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};
