/**
 * External dependencies
 */
import { Typography } from "@next-pms/design-system/components";
import { mergeClassNames } from "@next-pms/design-system/utils";
/**
 * Internal dependencies
 */
import { getBillableSummary, isBillableValue, type BillableEntry } from "@/lib/timesheetBillable";

type BillableIndicatorProps = {
  entries?: BillableEntry[];
  projectDefault?: boolean | number;
  compact?: boolean;
  className?: string;
};

export const BillableIndicator = ({
  entries = [],
  projectDefault,
  compact = false,
  className,
}: BillableIndicatorProps) => {
  const summary = entries.length ? getBillableSummary(entries) : null;
  const defaultBillable = isBillableValue(projectDefault);
  const showBillable = summary ? summary.hasBillable && (summary.isMixed || summary.isAllBillable) : defaultBillable;
  const showNonBillable = summary ? summary.hasNonBillable : projectDefault !== undefined && !defaultBillable;

  if (!showBillable && !showNonBillable) {
    return null;
  }

  const tooltip = summary?.overrideReasons.length
    ? `Override: ${summary.overrideReasons.join("; ")}`
    : summary?.isMixed
      ? "Mixed billable and non-billable entries"
      : showBillable && showNonBillable
        ? "Mixed billable and non-billable entries"
        : showBillable
          ? summary?.hasOverride
            ? "Billable (overridden)"
            : "Billable"
          : summary?.hasOverride
            ? "Non-billable (overridden)"
            : projectDefault !== undefined
              ? "Non-billable (project default)"
              : "Non-billable";

  const badgeClass = compact ? "text-[0.62rem] px-1 py-0" : "text-[0.68rem] px-1.5 py-0.5";
  const overrideMark = summary?.hasOverride ? "*" : "";

  return (
    <span
      title={tooltip}
      className={mergeClassNames("inline-flex items-center gap-0.5", !compact && "group-hover:hidden", className)}
    >
      {showBillable && (
        <Typography
          variant="small"
          className={mergeClassNames(
            "rounded font-semibold leading-none text-success bg-success/10",
            badgeClass,
            summary?.hasOverride && "ring-1 ring-warning/60"
          )}
        >
          B{overrideMark}
        </Typography>
      )}
      {showNonBillable && (
        <Typography
          variant="small"
          className={mergeClassNames(
            "rounded font-semibold leading-none text-muted-foreground bg-muted",
            badgeClass,
            summary?.hasOverride && "ring-1 ring-warning/60"
          )}
        >
          NB{overrideMark}
        </Typography>
      )}
    </span>
  );
};
