/**
 * External dependencies
 */
import { useState, useEffect, useMemo } from "react";
import { Matcher, DayPickerSingleProps } from "react-day-picker";
import { Calendar as CalendarIcon } from "lucide-react";

/**
 * Internal dependencies
 */
import { getUTCDateTime, getDisplayDate } from "../../utils/date";
import { default as Button } from "../button";
import { default as Calendar, CalendarProps } from "../calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import Typography from "../typography";

export type DatePickerProp = Omit<DayPickerSingleProps, "mode" | "selected" | "onSelect"> & {
  date?: Date | string;
  disabled?: boolean;
  disabledDates?: Matcher | Matcher[];
  onDateChange?: (date: Date) => void;
};

const DatePicker = ({
  date,
  disabled,
  onDateChange,
  disabledDates,
  captionLayout = "dropdown-buttons",
  fromYear,
  toYear,
  ...props
}: DatePickerProp) => {
  const [pickerDate, setPickerDate] = useState<Date>();
  const [isOpen, setIsOpen] = useState(false);

  const yearRange = useMemo(() => {
    const current = new Date().getFullYear();
    return {
      fromYear: fromYear ?? current - 25,
      toYear: toYear ?? current + 5,
    };
  }, [fromYear, toYear]);

  useEffect(() => {
    if (!date) setPickerDate(getUTCDateTime() as Date);

    if (date && typeof date === "string") {
      setPickerDate(getUTCDateTime(date) as Date);
    } else {
      setPickerDate(date as Date);
    }
  }, [date]);

  const onDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setPickerDate(date);
    onDateChange?.(date);
    setIsOpen(false);
  };

  return (
    <div>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2" disabled={disabled}>
            <CalendarIcon className="shrink-0 stroke-slate-400" />
            <Typography variant="p">{pickerDate ? getDisplayDate(pickerDate) : "Pick any date"}</Typography>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-[1000] w-auto border bg-popover p-0 text-popover-foreground shadow-md" align="start">
          <Calendar
            mode="single"
            selected={pickerDate}
            onSelect={onDateSelect}
            disabled={disabledDates}
            captionLayout={captionLayout}
            fromYear={yearRange.fromYear}
            toYear={yearRange.toYear}
            defaultMonth={pickerDate}
            {...props}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
export default DatePicker;
