/**
 * External dependencies
 */
import {
  Checkbox,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Typography,
} from "@next-pms/design-system/components";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
/**
 * Internal dependencies
 */
import { isBillableValue, needsBillableOverrideReason } from "@/lib/timesheetBillable";

type BillableFieldsProps<T extends FieldValues> = {
  control: Control<T>;
  isBillableName: FieldPath<T>;
  reasonName: FieldPath<T>;
  projectDefault?: boolean | number | null;
  watchedIsBillable?: boolean | number | null;
  showDefaultHint?: boolean;
  compact?: boolean;
  layout?: "default" | "card" | "compact";
};

export const BillableFields = <T extends FieldValues>({
  control,
  isBillableName,
  reasonName,
  projectDefault,
  watchedIsBillable,
  showDefaultHint = true,
  compact = false,
  layout,
}: BillableFieldsProps<T>) => {
  const resolvedLayout = layout ?? (compact ? "compact" : "default");
  const requiresReason = needsBillableOverrideReason(
    isBillableValue(watchedIsBillable),
    projectDefault
  );

  return (
    <div className={resolvedLayout === "default" ? "space-y-2" : "space-y-0"}>
      {showDefaultHint && projectDefault !== undefined && (
        <Typography variant="small" className="text-muted-foreground">
          Project default: {isBillableValue(projectDefault) ? "Billable" : "Non-billable"}
        </Typography>
      )}
      <FormField
        control={control}
        name={isBillableName}
        render={({ field }) => (
          <FormItem
            className={
              resolvedLayout === "compact"
                ? "flex items-center justify-center space-y-0"
                : resolvedLayout === "card"
                  ? "flex items-center gap-3 space-y-0"
                  : "flex items-center gap-2 space-y-0"
            }
          >
            <FormControl>
              <Checkbox
                checked={isBillableValue(field.value)}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                aria-label="Billable"
              />
            </FormControl>
            <div className="flex min-w-0 flex-col gap-1">
              <FormLabel className="block font-medium leading-none">Billable</FormLabel>
              {resolvedLayout === "card" && projectDefault !== undefined && (
                <Typography variant="small" className="block text-muted-foreground">
                  Project default is {isBillableValue(projectDefault) ? "billable" : "non-billable"}
                </Typography>
              )}
            </div>
            <FormMessage className="text-xs" />
          </FormItem>
        )}
      />
      {requiresReason && (
        <FormField
          control={control}
          name={reasonName}
          render={({ field }) => (
            <FormItem
              className={
                resolvedLayout === "card"
                  ? "mt-3 space-y-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2.5"
                  : "mt-2 space-y-1"
              }
            >
              <FormLabel
                className={
                  resolvedLayout === "card"
                    ? "text-xs font-medium text-amber-800 dark:text-amber-300"
                    : undefined
                }
              >
                Override reason
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Why does this entry differ from the project default?"
                  className={resolvedLayout === "card" ? "h-9 bg-background" : undefined}
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
      )}
    </div>
  );
};
