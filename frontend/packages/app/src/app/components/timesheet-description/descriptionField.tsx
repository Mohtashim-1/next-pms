/**
 * External dependencies
 */
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  TextArea,
  Typography,
} from "@next-pms/design-system/components";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

type TimesheetDescriptionFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  required?: boolean;
  label?: string;
  placeholder?: string;
  compact?: boolean;
};

export const TimesheetDescriptionField = <T extends FieldValues>({
  control,
  name,
  required = false,
  label = "Description",
  placeholder = "What did you work on? Markdown is supported.",
  compact = false,
}: TimesheetDescriptionFieldProps<T>) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem className="space-y-1">
        {!compact && (
          <>
            <FormLabel>
              {label}
              {required ? " *" : " (optional)"}
            </FormLabel>
            <Typography variant="small" className="text-muted-foreground">
              Supports Markdown. No character limit.
            </Typography>
          </>
        )}
        <FormControl>
          {compact ? (
            <Input
              placeholder={placeholder}
              className="h-9"
              {...field}
              value={field.value ?? ""}
            />
          ) : (
            <TextArea
              rows={5}
              placeholder={placeholder}
              className="font-mono text-sm min-h-9"
              {...field}
              value={field.value ?? ""}
            />
          )}
        </FormControl>
        {required && (
          <Typography variant="small" className="text-muted-foreground">
            Required for this project before submission.
          </Typography>
        )}
        <FormMessage className="text-xs" />
      </FormItem>
    )}
  />
);
