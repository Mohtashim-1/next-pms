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
  layout?: "default" | "card" | "compact";
};

export const TimesheetDescriptionField = <T extends FieldValues>({
  control,
  name,
  required = false,
  label = "Description",
  placeholder = "What did you work on? Markdown is supported.",
  compact = false,
  layout,
}: TimesheetDescriptionFieldProps<T>) => {
  const resolvedLayout = layout ?? (compact ? "compact" : "default");

  return (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem className={resolvedLayout === "card" ? "space-y-1.5" : "space-y-1"}>
        {resolvedLayout === "default" && (
          <div className="space-y-1">
            <FormLabel className="block leading-snug">
              {label}
              {required ? " *" : " (optional)"}
            </FormLabel>
            <Typography variant="small" className="block text-muted-foreground">
              Supports Markdown. No character limit.
            </Typography>
          </div>
        )}
        {resolvedLayout === "card" && (
          <FormLabel className="text-xs font-medium text-muted-foreground">
            {label}
            {required ? " *" : ""}
          </FormLabel>
        )}
        <FormControl>
          {resolvedLayout === "compact" ? (
            <Input
              placeholder={placeholder}
              className="h-9"
              {...field}
              value={field.value ?? ""}
            />
          ) : (
            <TextArea
              rows={resolvedLayout === "card" ? 2 : 5}
              placeholder={placeholder}
              className={
                resolvedLayout === "card"
                  ? "min-h-[4.5rem] resize-y rounded-lg border-muted-foreground/20 bg-background text-sm shadow-sm"
                  : "font-mono text-sm min-h-9"
              }
              {...field}
              value={field.value ?? ""}
            />
          )}
        </FormControl>
        {required && resolvedLayout === "default" && (
          <Typography variant="small" className="text-muted-foreground">
            Required for this project before submission.
          </Typography>
        )}
        <FormMessage className="text-xs" />
      </FormItem>
    )}
  />
  );
};
