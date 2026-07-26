/**
 * External dependencies.
 */
import * as React from "react";
import { DayPicker, DropdownProps } from "react-day-picker";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
/**
 * Internal dependencies.
 */
import { mergeClassNames } from "../../utils";
import { buttonVariants } from "../button/buttonVariants";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Custom month/year dropdown — avoids native <select> chrome (white boxes on Linux/dark UIs).
 * Visible label uses theme tokens; the real <select> is fully transparent on top.
 */
const CalendarDropdown = ({ value, onChange, caption, children, ...props }: DropdownProps) => {
  return (
    <div
      className="relative inline-flex h-8 min-w-[4.5rem] items-center justify-between gap-1 rounded-md border border-border px-2 text-sm font-medium text-foreground"
      style={{ backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}
    >
      <span className="pointer-events-none truncate">{caption}</span>
      <ChevronDown className="pointer-events-none h-3.5 w-3.5 shrink-0 opacity-70" />
      <select
        {...props}
        value={value}
        onChange={onChange}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        style={{ colorScheme: "dark" }}
      >
        {children}
      </select>
    </div>
  );
};

const Calendar = ({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) => {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={mergeClassNames("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center gap-1",
        caption_label: "text-sm font-medium text-foreground",
        caption_dropdowns: "flex items-center justify-center gap-2",
        dropdown: "absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0",
        dropdown_month: "relative",
        dropdown_year: "relative",
        dropdown_icon: "hidden",
        vhidden: "sr-only",
        nav: "space-x-1 flex items-center",
        nav_button: mergeClassNames(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: mergeClassNames(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside: "day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={mergeClassNames("h-4 w-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={mergeClassNames("h-4 w-4", className)} {...props} />
        ),
        Dropdown: CalendarDropdown,
      }}
      {...props}
    />
  );
};
Calendar.displayName = "Calendar";

export default Calendar;
