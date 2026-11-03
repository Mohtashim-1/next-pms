/**
 * Team performance dashboard for a lead's direct reports.
 * Charts use ApexCharts.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from "@next-pms/design-system/components";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Clock3, Users } from "lucide-react";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

import { Header as RootHeader } from "@/app/layout/root";
import { parseFrappeErrorMsg, mergeClassNames } from "@/lib/utils";

type TeamOption = {
  employee: string;
  employee_name: string;
  department?: string;
  member_count: number;
};

type MemberRow = {
  employee: string;
  employee_name: string;
  department: string;
  designation: string;
  logged_hours: number;
  billable_hours: number;
  expected_hours: number;
  utilization_pct: number;
  billable_pct: number;
  status: string;
  non_billable_hours: number;
  working_days: number;
  days_logged: number;
  missing_days: number;
  top_project: string;
  daily: number[];
  billable_daily: number[];
  expected_daily: number[];
};

type NamedHours = { hours: number; billable?: number; project?: string; activity_type?: string };
type StatusSlice = { status: string; count: number };

type DailyPoint = {
  label: string;
  logged: number;
  billable: number;
  expected: number;
};

type TeamPerformance = {
  can_switch_team: boolean;
  teams: TeamOption[];
  team: { employee: string; employee_name: string; department?: string } | null;
  week_label?: string;
  labels: string[];
  kpis: {
    members?: number;
    logged_hours?: number;
    expected_hours?: number;
    utilization_pct?: number;
    billable_hours?: number;
    billable_pct?: number;
    below_target?: number;
    pending_approval?: number;
    non_billable_hours?: number;
    working_days?: number;
    missing_days?: number;
    avg_daily_hours?: number;
  };
  range_label?: string;
  daily: DailyPoint[];
  projects?: NamedHours[];
  activities?: NamedHours[];
  status_breakdown?: StatusSlice[];
  members: MemberRow[];
  message?: string;
};

const iso = (date: Date) => format(date, "yyyy-MM-dd");

function rangeFor(preset: string): [string, string] {
  const today = new Date();
  if (preset === "last-week") {
    const end = subDays(startOfWeek(today), 1);
    return [iso(startOfWeek(end)), iso(endOfWeek(end))];
  }
  if (preset === "this-month") return [iso(startOfMonth(today)), iso(endOfMonth(today))];
  if (preset === "last-month") {
    const prev = subMonths(today, 1);
    return [iso(startOfMonth(prev)), iso(endOfMonth(prev))];
  }
  if (preset === "last-14") return [iso(subDays(today, 13)), iso(today)];
  return [iso(startOfWeek(today)), iso(endOfWeek(today))];
}

const PRESETS = [
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "last-14", label: "Last 14 days" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
];

const getTheme = () => {
  const dark =
    typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  return {
    dark,
    text: dark ? "#e2e8f0" : "#334155",
    muted: dark ? "#94a3b8" : "#64748b",
    grid: dark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)",
    tooltipBg: dark ? "#0f172a" : "#1f2937",
  };
};

type ApexChartConfig = {
  type: "line" | "area" | "bar" | "pie" | "donut" | "radialBar" | "scatter" | "bubble" | "heatmap" | "candlestick" | "boxPlot" | "radar" | "polarArea" | "rangeBar" | "rangeArea" | "treemap";
  options: ApexOptions;
  series: ApexOptions["series"];
};

function utilTone(pct: number) {
  if (pct >= 80 && pct <= 110) return "text-emerald-700 dark:text-emerald-300";
  if (pct >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-destructive";
}

function statusBadge(status: string) {
  if (status === "Approved") return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
  if (status === "Not Submitted") return "border-border text-muted-foreground";
  if (status.includes("Reject")) return "border-destructive/40 text-destructive";
  return "border-amber-500/40 text-amber-700 dark:text-amber-300";
}

function ChartBox({
  config,
  height = 300,
}: {
  config: ApexChartConfig | null;
  height?: number;
}) {
  if (!config) return null;
  return (
    <div className="w-full" style={{ minHeight: height }}>
      <Chart type={config.type} options={config.options} series={config.series} height={height} width="100%" />
    </div>
  );
}

const TeamPerformanceDashboard = () => {
  const initialRange = rangeFor("this-week");
  const [preset, setPreset] = useState("this-week");
  const [startDate, setStartDate] = useState(initialRange[0]);
  const [endDate, setEndDate] = useState(initialRange[1]);
  const [reportsTo, setReportsTo] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");

  const { data, isLoading, error, mutate, isValidating } = useFrappeGetCall(
    "next_pms.timesheet.api.team_performance.get_team_performance",
    {
      start_date: startDate,
      end_date: endDate,
      reports_to: reportsTo || undefined,
    },
    undefined,
    { revalidateOnFocus: false }
  );

  const board = data?.message as TeamPerformance | undefined;
  const theme = getTheme();
  const selected = board?.members.find((member) => member.employee === selectedEmployee);

  useEffect(() => {
    if (selectedEmployee && board && !board.members.some((member) => member.employee === selectedEmployee)) {
      setSelectedEmployee("");
    }
  }, [board, selectedEmployee]);

  const dailyChart = useMemo((): ApexChartConfig | null => {
    if (!board?.labels?.length) return null;
    const logged = selected ? selected.daily : board.daily.map((point) => point.logged);
    const billable = selected ? selected.billable_daily || [] : board.daily.map((point) => point.billable);
    const nonBillable = logged.map((hour, index) => Math.round((hour - (billable[index] || 0)) * 100) / 100);
    const expected = selected ? selected.expected_daily : board.daily.map((point) => point.expected);
    if (!selected && !logged.some((hour) => hour > 0) && !expected.some((hour) => hour > 0)) return null;
    const rotate = board.labels.length > 14;
    return {
      type: "line",
      series: [
        { name: "Billable", type: "column", data: billable },
        { name: "Non-billable", type: "column", data: nonBillable },
        { name: "Expected", type: "line", data: expected.map((hour) => Math.round(hour * 100) / 100) },
      ],
      options: {
        chart: {
          type: "line",
          stacked: true,
          toolbar: { show: false },
          fontFamily: "inherit",
          background: "transparent",
        },
        colors: ["#14b8a6", "#94a3b8", "#f59e0b"],
        stroke: { width: [0, 0, 2], curve: "smooth", dashArray: [0, 0, 5] },
        plotOptions: { bar: { columnWidth: "55%", borderRadius: 3 } },
        dataLabels: { enabled: false },
        legend: { position: "top", labels: { colors: theme.text } },
        xaxis: {
          categories: board.labels,
          labels: { style: { colors: theme.muted, fontSize: "11px" }, rotate: rotate ? -40 : 0 },
        },
        yaxis: {
          title: { text: "Hours", style: { color: theme.muted } },
          labels: { style: { colors: theme.muted, fontSize: "10px" } },
        },
        grid: { borderColor: theme.grid },
        tooltip: {
          theme: theme.dark ? "dark" : "light",
          y: { formatter: (value: number) => `${value}h` },
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, selected, theme.text]);

  const memberChart = useMemo((): ApexChartConfig | null => {
    const members = board?.members || [];
    if (!members.length) return null;
    const ordered = [...members].reverse();
    return {
      type: "bar",
      series: [
        { name: "Logged", data: ordered.map((member) => member.logged_hours) },
        { name: "Expected", data: ordered.map((member) => member.expected_hours) },
      ],
      options: {
        chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", background: "transparent" },
        plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "70%" } },
        colors: ["#4f86f7", "rgba(148,163,184,0.45)"],
        dataLabels: { enabled: false },
        legend: { position: "top", labels: { colors: theme.text } },
        xaxis: {
          categories: ordered.map((member) => member.employee_name),
          labels: { style: { colors: theme.muted, fontSize: "10px" } },
        },
        yaxis: {
          labels: { style: { colors: theme.muted, fontSize: "11px" }, maxWidth: 140 },
        },
        grid: { borderColor: theme.grid },
        tooltip: {
          theme: theme.dark ? "dark" : "light",
          y: { formatter: (value: number) => `${value}h` },
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, theme.text]);

  const billableChart = useMemo((): ApexChartConfig | null => {
    const billable = Number(board?.kpis.billable_hours || 0);
    const nonBillable = Number(board?.kpis.non_billable_hours || 0);
    if (billable + nonBillable <= 0) return null;
    return {
      type: "donut",
      series: [billable, nonBillable],
      options: {
        chart: { type: "donut", fontFamily: "inherit", background: "transparent" },
        labels: ["Billable", "Non-billable"],
        colors: ["#14b8a6", "#94a3b8"],
        legend: { position: "bottom", labels: { colors: theme.text } },
        dataLabels: { enabled: false },
        plotOptions: { pie: { donut: { size: "62%" } } },
        tooltip: {
          theme: theme.dark ? "dark" : "light",
          y: { formatter: (value: number) => `${value}h` },
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, theme.text]);

  const projectChart = useMemo((): ApexChartConfig | null => {
    const projects = board?.projects || [];
    if (!projects.length) return null;
    const ordered = [...projects].reverse();
    return {
      type: "bar",
      series: [{ name: "Hours", data: ordered.map((project) => project.hours) }],
      options: {
        chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", background: "transparent" },
        plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "65%" } },
        colors: ["#4f86f7"],
        dataLabels: { enabled: false },
        legend: { show: false },
        xaxis: {
          categories: ordered.map((project) => project.project || "No project"),
          labels: { style: { colors: theme.muted, fontSize: "10px" } },
        },
        yaxis: {
          labels: { style: { colors: theme.muted, fontSize: "11px" }, maxWidth: 140 },
        },
        grid: { borderColor: theme.grid },
        tooltip: {
          theme: theme.dark ? "dark" : "light",
          y: { formatter: (value: number) => `${value}h` },
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, theme.text]);

  const activityChart = useMemo((): ApexChartConfig | null => {
    const activities = board?.activities || [];
    if (!activities.length) return null;
    return {
      type: "donut",
      series: activities.map((activity) => activity.hours),
      options: {
        chart: { type: "donut", fontFamily: "inherit", background: "transparent" },
        labels: activities.map((activity) => activity.activity_type || "Unspecified"),
        colors: ["#4f86f7", "#14b8a6", "#f97316", "#a855f7", "#22d3ee", "#f43f5e", "#fbbf24", "#818cf8"],
        legend: { position: "bottom", labels: { colors: theme.text } },
        dataLabels: { enabled: false },
        plotOptions: { pie: { donut: { size: "58%" } } },
        tooltip: {
          theme: theme.dark ? "dark" : "light",
          y: { formatter: (value: number) => `${value}h` },
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, theme.text]);

  const statusChart = useMemo((): ApexChartConfig | null => {
    const slices = board?.status_breakdown || [];
    if (!slices.length) return null;
    return {
      type: "bar",
      series: [{ name: "Members", data: slices.map((slice) => slice.count) }],
      options: {
        chart: { type: "bar", toolbar: { show: false }, fontFamily: "inherit", background: "transparent" },
        plotOptions: { bar: { borderRadius: 4, columnWidth: "45%" } },
        colors: ["#f59e0b"],
        dataLabels: { enabled: false },
        legend: { show: false },
        xaxis: {
          categories: slices.map((slice) => slice.status),
          labels: {
            style: { colors: theme.muted, fontSize: "10px" },
            rotate: slices.length > 3 ? -25 : 0,
          },
        },
        yaxis: {
          labels: { style: { colors: theme.muted, fontSize: "10px" } },
          forceNiceScale: true,
        },
        grid: { borderColor: theme.grid },
        tooltip: { theme: theme.dark ? "dark" : "light" },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, theme.text]);

  const kpis = board?.kpis || {};
  const kpiCards = [
    { label: "Members", value: kpis.members ?? 0 },
    { label: "Logged", value: `${kpis.logged_hours ?? 0}h` },
    { label: "Expected", value: `${kpis.expected_hours ?? 0}h` },
    { label: "Utilization", value: `${kpis.utilization_pct ?? 0}%` },
    { label: "Billable", value: `${kpis.billable_hours ?? 0}h` },
    { label: "Non-billable", value: `${kpis.non_billable_hours ?? 0}h` },
    { label: "Avg / person / day", value: `${kpis.avg_daily_hours ?? 0}h` },
    { label: "Missing days", value: kpis.missing_days ?? 0 },
    { label: "Below 80%", value: kpis.below_target ?? 0 },
    { label: "Pending approval", value: kpis.pending_approval ?? 0 },
  ];

  const applyPreset = (id: string) => {
    const [from, to] = rangeFor(id);
    setPreset(id);
    setStartDate(from);
    setEndDate(to);
    setSelectedEmployee("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20">
      <RootHeader className="shrink-0 border-b bg-background px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <Typography variant="h3" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5 text-primary" />
              Team performance
              <Badge variant="outline" className="text-[10px] font-normal uppercase">
                Team Lead
              </Badge>
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              {board?.team
                ? `${board.team.employee_name}${board.team.department ? ` · ${board.team.department}` : ""} · direct reports`
                : "Weekly hours, utilization, and approvals for your team"}
              {board?.range_label ? ` · ${board.range_label}` : ""}
            </Typography>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {board?.can_switch_team ? (
              <select
                className="h-9 max-w-[260px] rounded-md border bg-background px-2 text-sm"
                value={board.team?.employee || reportsTo}
                onChange={(event) => {
                  setSelectedEmployee("");
                  setReportsTo(event.target.value);
                }}
                aria-label="Team"
              >
                {(board.teams || []).map((team) => (
                  <option key={team.employee} value={team.employee}>
                    {team.employee_name} ({team.member_count})
                  </option>
                ))}
              </select>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isValidating}>
              Refresh
            </Button>
          </div>
        </div>
      </RootHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-5">
          <div className="flex flex-wrap items-end gap-2">
            {PRESETS.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={preset === item.id ? "default" : "outline"}
                onClick={() => applyPreset(item.id)}
              >
                {item.label}
              </Button>
            ))}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                value={startDate}
                max={endDate}
                onChange={(event) => {
                  setPreset("custom");
                  setStartDate(event.target.value);
                  setSelectedEmployee("");
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                value={endDate}
                min={startDate}
                onChange={(event) => {
                  setPreset("custom");
                  setEndDate(event.target.value);
                  setSelectedEmployee("");
                }}
              />
            </label>
          </div>
          {error ? (
            <Card className="border-destructive/40">
              <CardContent className="py-4">
                <Typography variant="small" className="text-destructive">
                  {parseFrappeErrorMsg(error)}
                </Typography>
              </CardContent>
            </Card>
          ) : null}

          {isLoading && !board ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {kpiCards.map((card) => (
                <Card key={card.label}>
                  <CardContent className="px-3 py-3">
                    <Typography variant="small" className="text-muted-foreground">
                      {card.label}
                    </Typography>
                    <Typography variant="p" className="mt-1 text-xl font-semibold">
                      {card.value}
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock3 className="h-4 w-4 text-primary" />
                  {selected ? `${selected.employee_name} · daily hours` : "Team daily hours"}
                </CardTitle>
                {selected ? (
                  <button
                    type="button"
                    className="text-left text-xs text-primary"
                    onClick={() => setSelectedEmployee("")}
                  >
                    Show the whole team
                  </button>
                ) : (
                  <Typography variant="small" className="text-muted-foreground">
                    Logged and billable hours against the team’s expected hours
                  </Typography>
                )}
              </CardHeader>
              <CardContent>
                {dailyChart ? (
                  <ChartBox config={dailyChart} />
                ) : (
                  <Typography variant="small" className="flex h-40 items-center justify-center text-muted-foreground">
                    {board?.message || "No hours logged this week"}
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Hours by team member</CardTitle>
                <Typography variant="small" className="text-muted-foreground">
                  Logged hours against expected hours for each person
                </Typography>
              </CardHeader>
              <CardContent>
                {memberChart ? (
                  <ChartBox config={memberChart} height={Math.max(280, (board?.members.length || 1) * 36)} />
                ) : (
                  <Typography variant="small" className="flex h-40 items-center justify-center text-muted-foreground">
                    {board?.message || "No direct reports"}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Billable split</CardTitle>
              </CardHeader>
              <CardContent>
                {billableChart ? (
                  <ChartBox config={billableChart} height={260} />
                ) : (
                  <Typography variant="small" className="flex h-40 items-center justify-center text-muted-foreground">
                    No hours in this range
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Approval status</CardTitle>
              </CardHeader>
              <CardContent>
                {statusChart ? (
                  <ChartBox config={statusChart} height={260} />
                ) : (
                  <Typography variant="small" className="flex h-40 items-center justify-center text-muted-foreground">
                    No team members
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Hours by project</CardTitle>
              </CardHeader>
              <CardContent>
                {projectChart ? (
                  <ChartBox config={projectChart} height={260} />
                ) : (
                  <Typography variant="small" className="flex h-40 items-center justify-center text-muted-foreground">
                    No project hours in this range
                  </Typography>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Hours by activity</CardTitle>
              </CardHeader>
              <CardContent>
                {activityChart ? (
                  <ChartBox config={activityChart} height={260} />
                ) : (
                  <Typography variant="small" className="flex h-40 items-center justify-center text-muted-foreground">
                    No activity hours in this range
                  </Typography>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Member review</CardTitle>
              <Typography variant="small" className="text-muted-foreground">
                Lowest utilization first. Select a person to see their daily hours.
              </Typography>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Logged</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Utilization</TableHead>
                    <TableHead className="text-right">Billable</TableHead>
                    <TableHead className="text-right">Non-billable</TableHead>
                    <TableHead className="text-right">Days logged</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead>Top project</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(board?.members || []).map((member) => (
                    <TableRow
                      key={member.employee}
                      className={mergeClassNames("cursor-pointer", selectedEmployee === member.employee && "bg-accent")}
                      onClick={() => setSelectedEmployee(member.employee === selectedEmployee ? "" : member.employee)}
                    >
                      <TableCell>
                        <div className="font-medium">{member.employee_name}</div>
                        <div className="text-xs text-muted-foreground">{member.designation}</div>
                      </TableCell>
                      <TableCell>{member.department || "—"}</TableCell>
                      <TableCell className="text-right">{member.logged_hours}h</TableCell>
                      <TableCell className="text-right">{member.expected_hours}h</TableCell>
                      <TableCell className={mergeClassNames("text-right font-medium", utilTone(member.utilization_pct))}>
                        {member.utilization_pct}%
                      </TableCell>
                      <TableCell className="text-right">
                        {member.billable_hours}h
                        <span className="ml-1 text-xs text-muted-foreground">{member.billable_pct}%</span>
                      </TableCell>
                      <TableCell className="text-right">{member.non_billable_hours}h</TableCell>
                      <TableCell className="text-right">
                        {member.days_logged}/{member.working_days}
                      </TableCell>
                      <TableCell className="text-right">{member.missing_days}</TableCell>
                      <TableCell className="max-w-40 truncate">{member.top_project || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadge(member.status)}>
                          {member.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && !(board?.members || []).length ? (
                    <TableRow>
                      <TableCell colSpan={11} className="h-16 text-center text-muted-foreground">
                        {board?.message || "No direct reports"}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default TeamPerformanceDashboard;
