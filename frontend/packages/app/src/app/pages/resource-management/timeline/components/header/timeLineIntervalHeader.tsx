/**
 * External dependencies.
 */
import { getMonthKey, getMonthYearKey, getTodayDate } from "@next-pms/design-system";
import { TableHead, Typography } from "@next-pms/design-system/components";
import { startOfWeek } from "date-fns";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import { getDayKeyOfMoment, toTimelineMoment } from "../../../utils/dates";
import type { ResourceAllocationItemProps, TimeLineHeaderFunctionProps } from "../../types";

const TimeLineIntervalHeader = ({ getIntervalProps, intervalContext, data }: TimeLineHeaderFunctionProps) => {
  const { interval } = intervalContext;
  const { startTime, endTime } = interval;
  const startMoment = toTimelineMoment(startTime);
  const endMoment = toTimelineMoment(endTime);
  const start = startOfWeek(getTodayDate(), {
    weekStartsOn: 1,
  });

  const getKey = () => {
    const keys = { week: "Week", month: "Month", year: "Year" };

    if (start.getTime() >= startMoment.toDate().getTime() && start.getTime() <= endMoment.toDate().getTime()) {
      if (data.unit === "week") {
        return `This ${keys[data.unit]}`;
      }
    }
    if (data.unit === "month" && data.showYear) {
      return getMonthYearKey(getDayKeyOfMoment(startMoment));
    }

    return `${getMonthKey(getDayKeyOfMoment(startMoment))} - ${getMonthKey(
      getDayKeyOfMoment(endMoment.clone().add(-1, "days"))
    )}`;
  };

  let headerProps: ResourceAllocationItemProps = getIntervalProps();

  headerProps = {
    ...headerProps,
    style: {
      ...headerProps.style,
      left: (headerProps.style?.left ?? 0) + (data.unit === "week" ? 1 : -0.5),
    },
  };

  return (
    <TableHead
      {...headerProps}
      className={mergeClassNames("h-full pb-2 pt-1 px-0 text-center truncate cursor-pointer border-r border-border")}
    >
      <Typography variant="small">{getKey()}</Typography>
    </TableHead>
  );
};

export { TimeLineIntervalHeader };
