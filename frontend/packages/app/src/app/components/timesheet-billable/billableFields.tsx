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
};

export const BillableFields = <T extends FieldValues>({
  control,
  isBillableName,
  reasonName,
  projectDefault,
  watchedIsBillable,
  showDefaultHint = true,
}: BillableFieldsProps<T>) => {
  const requiresReason = needsBillableOverrideReason(
    isBillableValue(watchedIsBillable),
    projectDefault
  );

  return (
    <div className="space-y-2">
      {showDefaultHint && projectDefault !== undefined && (
        <Typography variant="small" className="text-muted-foreground">
          Project default: {isBillableValue(projectDefault) ? "Billable" : "Non-billable"}
        </Typography>
      )}
      <FormField
        control={control}
        name={isBillableName}
        render={({ field }) => (
          <FormItem className="flex items-center gap-2 space-y-0">
            <FormControl>
              <Checkbox
                checked={isBillableValue(field.value)}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
              />
            </FormControl>
            <FormLabel className="font-normal">Billable</FormLabel>
            <FormMessage className="text-xs" />
          </FormItem>
        )}
      />
      {requiresReason && (
        <FormField
          control={control}
          name={reasonName}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Override reason</FormLabel>
              <FormControl>
                <Input placeholder="Why does this entry differ from the project default?" {...field} />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
      )}
    </div>
  );
};
