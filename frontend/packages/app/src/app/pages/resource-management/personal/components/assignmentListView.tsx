/**
 * External dependencies.
 */
import { Typography } from "@next-pms/design-system/components";

/**
 * Internal dependencies.
 */
import type { PersonalAllocation } from "../types";
import { AssignmentCard } from "./assignmentCard";

export const AssignmentListView = ({
  upcoming,
  allocations,
}: {
  upcoming: PersonalAllocation[];
  allocations: PersonalAllocation[];
}) => {
  const otherAllocations = allocations.filter(
    (allocation) => !upcoming.some((item) => item.name === allocation.name)
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Typography variant="h6">Upcoming</Typography>
        {upcoming.length === 0 ? (
          <Typography variant="p" className="text-sm text-muted-foreground">
            No upcoming assignments in this range.
          </Typography>
        ) : (
          <div className="grid gap-3">
            {upcoming.map((allocation) => (
              <AssignmentCard key={allocation.name} allocation={allocation} highlightDue />
            ))}
          </div>
        )}
      </section>

      {otherAllocations.length > 0 && (
        <section className="space-y-3">
          <Typography variant="h6">All Assignments</Typography>
          <div className="grid gap-3">
            {otherAllocations.map((allocation) => (
              <AssignmentCard key={allocation.name} allocation={allocation} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
