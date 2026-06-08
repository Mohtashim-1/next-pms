/**
 * External dependencies.
 */
import { LegacyRef } from "react";
import { TableHead, TableHeader, TableRow, Typography } from "@next-pms/design-system/components";
import { prettyDate, getUTCDateTime } from "@next-pms/design-system/date";
import { isToday } from "date-fns";
import { useContextSelector } from "use-context-selector";

/**
 * Internal dependencies.
 */
import { mergeClassNames, getTableCellClass } from "@next-pms/resource-management/utils";
import { TableContext } from "@next-pms/resource-management/store";
import type { DateProps } from "../../../store/types";
import { TeamContext } from "../../../store/teamContext";
import { getRollupColumns, normalizeRollupPeriod } from "../../../utils/rollup";

type ResourceTeamTableHeaderProps = {
  dates: DateProps[];
  title: string;
  cellHeaderRef: LegacyRef<HTMLTableCellElement>;
  dateToAddHeaderRef: string;
  isLoading?: boolean;
};

export const ResourceTeamTableHeader = ({
  dates,
  title,
  cellHeaderRef,
  dateToAddHeaderRef,
  isLoading,
}: ResourceTeamTableHeaderProps) => {
  const { tableView } = useContextSelector(TeamContext, (value) => value.state);
  const { tableProperties } = useContextSelector(TableContext, (value) => value.state);
  const { getCellWidthString } = useContextSelector(TableContext, (value) => value.actions);

  const rollupPeriod = normalizeRollupPeriod(tableView.rollupPeriod, tableView.combineWeekHours);
  const rollupColumns = getRollupColumns(dates, rollupPeriod);

  return (
    <TableHeader className="border-t-0 sticky top-0 z-30">
      <TableRow className="flex items-center flex-shrink-0">
        <TableHead
          className={mergeClassNames(
            "flex items-center sticky left-0 bg-muted text-foreground h-[81px] w-full z-30 border-r border-border"
          )}
          style={{ width: getCellWidthString(tableProperties.firstCellWidth) }}
        >
          {title}
        </TableHead>
        <div className="flex flex-col">
          {rollupPeriod !== "day" && (
            <div className="flex items-center">
              {rollupColumns.map((column) => (
                <Typography
                  key={column.key}
                  variant="small"
                  className="py-2 text-center truncate cursor-pointer border-r border-border border-l"
                  style={{
                    width: getCellWidthString(
                      tableProperties.cellWidth * (rollupPeriod === "week" ? 5 : column.dates.length)
                    ),
                  }}
                >
                  {column.label}
                </Typography>
              ))}
            </div>
          )}
          <div className="flex items-center">
            {rollupColumns.map((column, columnIndex) => {
              if (rollupPeriod !== "day") {
                return (
                  <TableHead
                    key={column.key}
                    className={mergeClassNames(
                      getTableCellClass(0, columnIndex),
                      "text-xs flex flex-col px-2 py-2 justify-center items-center"
                    )}
                    style={{
                      width: getCellWidthString(
                        tableProperties.cellWidth * (rollupPeriod === "week" ? 5 : column.dates.length)
                      ),
                    }}
                    ref={column.dates.includes(dateToAddHeaderRef) ? cellHeaderRef : null}
                  >
                    <Typography variant="small" className="text-muted-foreground">
                      {rollupPeriod === "week" ? "Week Total" : "Month Total"}
                    </Typography>
                  </TableHead>
                );
              }

              return column.dates.map((date, index) => {
                const { date: dateStr, day } = prettyDate(date);
                return (
                  <TableHead
                    key={date}
                    className={mergeClassNames(
                      getTableCellClass(index, columnIndex),
                      "text-xs flex flex-col px-2 py-2 justify-center items-center"
                    )}
                    style={{ width: getCellWidthString(tableProperties.cellWidth) }}
                    ref={date === dateToAddHeaderRef ? cellHeaderRef : null}
                  >
                    <Typography
                      variant="p"
                      className={mergeClassNames(
                        "text-slate-600 text-[11px] dark:text-muted-foreground",
                        isToday(getUTCDateTime(date)) && "font-semibold text-foreground"
                      )}
                    >
                      {day}
                    </Typography>
                    <Typography
                      variant="small"
                      className={mergeClassNames(
                        "text-slate-500 text-[11px] max-lg:text-[0.65rem] dark:text-muted-foreground",
                        isToday(getUTCDateTime(date)) && "font-semibold text-foreground"
                      )}
                    >
                      {dateStr}
                    </Typography>
                  </TableHead>
                );
              });
            })}
          </div>
        </div>
      </TableRow>
    </TableHeader>
  );
};
