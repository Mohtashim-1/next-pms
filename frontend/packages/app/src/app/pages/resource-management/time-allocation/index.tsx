/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { PieChart } from "lucide-react";

/**
 * Internal dependencies.
 */
import { AnalyticsDrilldownSheet } from "@/app/components/analytics/AnalyticsDrilldownSheet";
import type { AnalyticsDrilldownResponse } from "@/app/components/analytics/analyticsDrilldown";
import { Header as RootHeader } from "@/app/layout/root";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type TimeSplit = {
  billable: number;
  non_billable: number;
  pto: number;
  holiday: number;
  admin: number;
};

type AllocationRow = {
  key: string;
  label: string;
  splits: TimeSplit;
  capacity_hours?: number;
  target_billable_hours?: number;
  actual_billable_hours?: number;
  billable_variance?: number;
  billable_attainment_pct?: number;
};

type AllocationResponse = {
  summary: AllocationRow & { billable_attainment_pct?: number };
  rows: AllocationRow[];
  trend: Array<{
    key: string;
    label: string;
    splits: TimeSplit;
    target_billable_hours: number;
    actual_billable_hours: number;
  }>;
  group_by: string;
};

type DrilldownRequest = {
  split_key: keyof TimeSplit;
  group_key?: string;
  group_label?: string;
  period_key?: string;
  period_label?: string;
  context: "summary" | "row" | "trend";
};

const SPLIT_COLORS: Record<keyof TimeSplit, string> = {
  billable: "bg-emerald-500",
  non_billable: "bg-sky-500",
  pto: "bg-violet-500",
  holiday: "bg-amber-500",
  admin: "bg-slate-500",
};

const SPLIT_LABELS: Record<keyof TimeSplit, string> = {
  billable: "Billable",
  non_billable: "Non-Billable",
  pto: "PTO",
  holiday: "Holiday",
  admin: "Admin",
};

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const todayStr = today.toISOString().slice(0, 10);

const splitTotal = (splits?: Partial<TimeSplit>) =>
  Object.values(splits || {}).reduce((sum, value) => sum + Number(value || 0), 0);

const SplitBar = ({
  splits,
  className,
  onSegmentClick,
}: {
  splits?: Partial<TimeSplit>;
  className?: string;
  onSegmentClick?: (splitKey: keyof TimeSplit) => void;
}) => {
  const total = splitTotal(splits);
  if (!total) {
    return <div className={mergeClassNames("h-3 rounded-full bg-muted", className)} />;
  }
  return (
    <div className={mergeClassNames("flex h-3 overflow-hidden rounded-full", className)}>
      {(Object.keys(SPLIT_LABELS) as Array<keyof TimeSplit>).map((key) => {
        const value = splits?.[key] || 0;
        if (!value) return null;
        const segment = (
          <div
            className={mergeClassNames(
              SPLIT_COLORS[key],
              "h-full",
              onSegmentClick ? "cursor-pointer transition-opacity hover:opacity-80" : ""
            )}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${SPLIT_LABELS[key]}: ${value}h`}
          />
        );
        if (!onSegmentClick) {
          return <div key={key}>{segment}</div>;
        }
        return (
          <button
            key={key}
            type="button"
            className="h-full p-0"
            style={{ width: `${(value / total) * 100}%` }}
            title={`${SPLIT_LABELS[key]}: ${value}h`}
            onClick={() => onSegmentClick(key)}
          >
            <div className={mergeClassNames(SPLIT_COLORS[key], "h-full w-full")} />
          </button>
        );
      })}
    </div>
  );
};

const TimeAllocationView = () => {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(todayStr);
  const [groupBy, setGroupBy] = useState("team");
  const [period, setPeriod] = useState("week");
  const [drilldown, setDrilldown] = useState<AnalyticsDrilldownResponse | null>(null);
  const [drilldownTitle, setDrilldownTitle] = useState("Underlying Records");

  const apiArgs = useMemo(
    () => ({
      start_date: startDate,
      end_date: endDate,
      group_by: groupBy,
      period,
      horizon_months: 3,
    }),
    [startDate, endDate, groupBy, period]
  );

  const { data, isLoading, mutate, isValidating } = useFrappeGetCall(
    startDate && endDate ? "next_pms.next_pms.api.time_allocation.get_allocation_view" : null,
    apiArgs,
    undefined,
    {
      revalidateOnFocus: true,
      refreshInterval: 30000,
      dedupingInterval: 0,
    }
  );

  const { call: loadDrilldown, loading: drilldownLoading } = useFrappePostCall(
    "next_pms.next_pms.api.time_allocation.get_drilldown"
  );

  const response = data?.message as AllocationResponse | undefined;

  const openDrilldown = (request: DrilldownRequest) => {
    loadDrilldown({
      ...apiArgs,
      split_key: request.split_key,
      group_key: request.group_key,
      group_label: request.group_label,
      period_key: request.period_key,
      period_label: request.period_label,
      context: request.context,
    })
      .then((result) => {
        const payload = result?.message as AnalyticsDrilldownResponse;
        setDrilldown(payload);
        const splitLabel = SPLIT_LABELS[request.split_key];
        const scopeLabel = request.group_label || request.period_label || "Portfolio";
        setDrilldownTitle(`${splitLabel} · ${scopeLabel}`);
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  return (
    <div className="flex h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Typography variant="h3" className="flex items-center gap-2 text-lg font-semibold">
              <PieChart className="h-5 w-5" />
              Time Allocation
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              Billable, non-billable, PTO, holiday, and admin split with target vs actual and trends.
            </Typography>
          </div>
          <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isValidating}>
            Refresh
          </Button>
        </div>
      </RootHeader>

      <div className="space-y-4 overflow-auto p-3 sm:p-4">
        <Card>
          <CardContent className="grid gap-3 pt-4 md:grid-cols-5">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger><SelectValue placeholder="Group by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="role">Role</SelectItem>
                <SelectItem value="person">Person</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="department">Department</SelectItem>
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue placeholder="Trend period" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Weekly trend</SelectItem>
                <SelectItem value="month">Monthly trend</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(SPLIT_LABELS) as Array<keyof TimeSplit>).map((key) => (
            <Badge key={key} variant="outline" className="gap-2">
              <span className={mergeClassNames("inline-block h-2 w-2 rounded-full", SPLIT_COLORS[key])} />
              {SPLIT_LABELS[key]}
            </Badge>
          ))}
        </div>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Portfolio Split</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <SplitBar
                  splits={response?.summary?.splits}
                  className="h-4"
                  onSegmentClick={(splitKey) =>
                    openDrilldown({ split_key: splitKey, context: "summary" })
                  }
                />
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {(Object.keys(SPLIT_LABELS) as Array<keyof TimeSplit>).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="rounded-md border p-3 text-left hover:bg-muted/50"
                      onClick={() => openDrilldown({ split_key: key, context: "summary" })}
                    >
                      <Typography variant="small" className="text-muted-foreground">
                        {SPLIT_LABELS[key]}
                      </Typography>
                      <Typography variant="p" className="font-semibold">
                        {response?.summary?.splits?.[key] ?? 0}h
                      </Typography>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <Typography variant="small" className="text-muted-foreground">
                      Target Billable
                    </Typography>
                    <Typography variant="p" className="font-semibold">
                      {response?.summary?.target_billable_hours ?? 0}h
                    </Typography>
                  </div>
                  <div className="rounded-md border p-3">
                    <Typography variant="small" className="text-muted-foreground">
                      Actual Billable
                    </Typography>
                    <Typography variant="p" className="font-semibold">
                      {response?.summary?.actual_billable_hours ?? 0}h
                    </Typography>
                  </div>
                  <div className="rounded-md border p-3">
                    <Typography variant="small" className="text-muted-foreground">
                      Attainment
                    </Typography>
                    <Typography variant="p" className="font-semibold">
                      {response?.summary?.billable_attainment_pct ?? 0}%
                    </Typography>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Trend Over Time</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {response?.trend?.length ? (
                  response.trend.map((point) => (
                    <div key={point.key} className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{point.label}</span>
                        <span className="text-muted-foreground">
                          {point.actual_billable_hours}h / {point.target_billable_hours}h billable
                        </span>
                      </div>
                      <SplitBar
                        splits={point.splits}
                        onSegmentClick={(splitKey) =>
                          openDrilldown({
                            split_key: splitKey,
                            context: "trend",
                            period_key: point.key,
                            period_label: point.label,
                          })
                        }
                      />
                    </div>
                  ))
                ) : (
                  <Typography variant="small" className="text-muted-foreground">
                    No trend data for the selected range.
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By {response?.group_by || groupBy}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead>Split</TableHead>
                      <TableHead>Target Billable</TableHead>
                      <TableHead>Actual Billable</TableHead>
                      <TableHead>Variance</TableHead>
                      <TableHead>Attainment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {response?.rows?.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="min-w-[180px]">
                          <SplitBar
                            splits={row.splits}
                            onSegmentClick={(splitKey) =>
                              openDrilldown({
                                split_key: splitKey,
                                context: "row",
                                group_key: row.key,
                                group_label: row.label,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>{row.target_billable_hours ?? 0}h</TableCell>
                        <TableCell>{row.actual_billable_hours ?? 0}h</TableCell>
                        <TableCell>{row.billable_variance ?? 0}h</TableCell>
                        <TableCell>{row.billable_attainment_pct ?? 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AnalyticsDrilldownSheet
        open={Boolean(drilldown)}
        title={drilldownTitle}
        description={`${startDate} to ${endDate}`}
        loading={drilldownLoading}
        payload={drilldown}
        onClose={() => setDrilldown(null)}
        exportFilename={`time-allocation-drilldown-${startDate}-to-${endDate}.csv`}
        valueKey="hours"
      />
    </div>
  );
};

export default TimeAllocationView;
