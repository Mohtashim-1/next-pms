/**
 * Charts + insight panels for Timesheet User (personal) dashboard.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Typography,
} from "@next-pms/design-system/components";
import { ArrowRight, Clock3, ListChecks, Sparkles } from "lucide-react";

import { loadEcharts } from "@/app/pages/project/profitability/loadEcharts";
import { BASE_ROUTE } from "@/lib/constant";
import { mergeClassNames } from "@/lib/utils";

export type PersonalPanels = {
  personal?: boolean;
  employee?: {
    name?: string;
    employee_name?: string;
    department?: string;
    company?: string;
    working_hours?: number;
  };
  week?: {
    label?: string;
    logged_hours?: number;
    billable_hours?: number;
    non_billable_hours?: number;
    target_hours?: number;
    utilization_pct?: number;
  };
  daily_trend?: Array<{
    date: string;
    label: string;
    logged_hours: number;
    billable_hours: number;
    non_billable_hours: number;
  }>;
  weekly_trend?: Array<{
    label: string;
    logged_hours: number;
    billable_hours: number;
    non_billable_hours: number;
    billable_ratio: number;
  }>;
  by_project?: Array<{
    project: string;
    project_name: string;
    hours: number;
    billable: number;
    billable_pct: number;
  }>;
  by_activity?: Array<{ activity_type: string; hours: number }>;
  recent_entries?: Array<{
    date: string;
    hours: number;
    is_billable?: boolean;
    project_name?: string;
    activity_type?: string;
    description?: string;
  }>;
  billable_split?: { billable: number; non_billable: number };
  shortcuts?: Array<{ key: string; label: string; description: string; route: string }>;
};

const getTheme = () => {
  const dark =
    typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  return {
    dark,
    text: dark ? "#e2e8f0" : "#334155",
    muted: dark ? "#94a3b8" : "#64748b",
    split: dark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)",
    tooltipBg: dark ? "#0f172a" : "#1f2937",
  };
};

function ChartBox({
  option,
  height = 280,
  empty = "No data yet",
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: Record<string, any> | null;
  height?: number;
  empty?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    loadEcharts()
      .then((echarts) => {
        if (disposed || !ref.current) return;
        if (!chartRef.current) chartRef.current = echarts.init(ref.current);
        if (!option) {
          chartRef.current.clear();
          chartRef.current.setOption({
            title: {
              text: empty,
              left: "center",
              top: "center",
              textStyle: { color: getTheme().muted, fontSize: 13 },
            },
          });
          return;
        }
        chartRef.current.setOption(option, true);
        requestAnimationFrame(() => chartRef.current?.resize());
      })
      .catch(() => undefined);
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
    };
  }, [option, empty]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    []
  );

  return <div ref={ref} style={{ height }} className="w-full overflow-hidden" />;
}

export function PersonalDashboardPanels({ panels }: { panels?: PersonalPanels }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(Boolean(window.echarts));
  useEffect(() => {
    loadEcharts()
      .then(() => setReady(true))
      .catch(() => undefined);
  }, []);

  const theme = getTheme();
  const week = panels?.week;
  const daily = panels?.daily_trend || [];
  const weekly = panels?.weekly_trend || [];
  const projects = panels?.by_project || [];
  const activities = panels?.by_activity || [];
  const split = panels?.billable_split || { billable: 0, non_billable: 0 };
  const recent = panels?.recent_entries || [];
  const shortcuts = panels?.shortcuts || [];

  const dailyOption = useMemo(() => {
    if (!daily.some((d) => d.logged_hours > 0)) return null;
    return {
      tooltip: { trigger: "axis", backgroundColor: theme.tooltipBg, textStyle: { color: "#f8fafc" } },
      legend: { top: 0, textStyle: { color: theme.text, fontSize: 11 } },
      grid: { left: 8, right: 12, top: 36, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: daily.map((d) => d.label),
        axisLabel: { color: theme.muted, fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: theme.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        {
          name: "Billable",
          type: "bar",
          stack: "h",
          data: daily.map((d) => d.billable_hours),
          itemStyle: { color: "#14b8a6" },
        },
        {
          name: "Non-billable",
          type: "bar",
          stack: "h",
          data: daily.map((d) => d.non_billable_hours),
          itemStyle: { color: "#94a3b8" },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, ready]);

  const weeklyOption = useMemo(() => {
    if (!weekly.length) return null;
    return {
      tooltip: { trigger: "axis", backgroundColor: theme.tooltipBg, textStyle: { color: "#f8fafc" } },
      legend: { top: 0, textStyle: { color: theme.text, fontSize: 11 } },
      grid: { left: 8, right: 16, top: 36, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: weekly.map((w) => w.label),
        axisLabel: { color: theme.muted, fontSize: 10 },
      },
      yAxis: [
        {
          type: "value",
          name: "Hours",
          axisLabel: { color: theme.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.split } },
        },
        {
          type: "value",
          name: "Billable %",
          min: 0,
          max: 100,
          axisLabel: { color: theme.muted, formatter: "{value}%", fontSize: 10 },
        },
      ],
      series: [
        {
          name: "Logged",
          type: "bar",
          data: weekly.map((w) => w.logged_hours),
          itemStyle: { color: "#38bdf8", borderRadius: [4, 4, 0, 0] },
        },
        {
          name: "Billable",
          type: "bar",
          data: weekly.map((w) => w.billable_hours),
          itemStyle: { color: "#34d399", borderRadius: [4, 4, 0, 0] },
        },
        {
          name: "Billable %",
          type: "line",
          yAxisIndex: 1,
          data: weekly.map((w) => w.billable_ratio),
          itemStyle: { color: "#a78bfa" },
          lineStyle: { width: 3 },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekly, ready]);

  const projectOption = useMemo(() => {
    if (!projects.length) return null;
    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: theme.tooltipBg,
        textStyle: { color: "#f8fafc" },
      },
      grid: { left: 8, right: 28, top: 12, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { color: theme.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.split } },
      },
      yAxis: {
        type: "category",
        data: [...projects].reverse().map((p) => p.project_name),
        axisLabel: { color: theme.muted, width: 110, overflow: "truncate", fontSize: 10 },
      },
      series: [
        {
          type: "bar",
          data: [...projects].reverse().map((p) => p.hours),
          itemStyle: { color: "#4f86f7", borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            color: theme.text,
            fontSize: 10,
            formatter: (p: { value: number }) => `${p.value}h`,
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, ready]);

  const activityOption = useMemo(() => {
    if (!activities.length) return null;
    const palette = ["#4f86f7", "#10b981", "#f97316", "#a855f7", "#22d3ee", "#f43f5e", "#fbbf24", "#818cf8"];
    return {
      tooltip: { trigger: "item", backgroundColor: theme.tooltipBg, textStyle: { color: "#f8fafc" } },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 4,
        top: 16,
        bottom: 16,
        textStyle: { color: theme.text, fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          center: ["36%", "50%"],
          label: { show: false },
          data: activities.map((a, i) => ({
            name: a.activity_type,
            value: a.hours,
            itemStyle: { color: palette[i % palette.length] },
          })),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, ready]);

  const billableOption = useMemo(() => {
    const bill = Number(split.billable || 0);
    const non = Number(split.non_billable || 0);
    if (bill + non <= 0) return null;
    return {
      tooltip: { trigger: "item", backgroundColor: theme.tooltipBg, textStyle: { color: "#f8fafc" } },
      legend: { bottom: 0, textStyle: { color: theme.text, fontSize: 11 } },
      series: [
        {
          type: "pie",
          radius: ["48%", "72%"],
          center: ["50%", "46%"],
          label: { show: false },
          data: [
            { name: "Billable", value: bill, itemStyle: { color: "#14b8a6" } },
            { name: "Non-billable", value: non, itemStyle: { color: "#94a3b8" } },
          ],
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, ready]);

  const utilOption = useMemo(() => {
    const pct = Number(week?.utilization_pct || 0);
    const clamp = Math.min(Math.max(pct, 0), 120);
    const col = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#f43f5e";
    return {
      series: [
        {
          type: "gauge",
          min: 0,
          max: 120,
          splitNumber: 6,
          radius: "90%",
          startAngle: 210,
          endAngle: -30,
          axisLine: { lineStyle: { width: 14, color: [[1, theme.split]] } },
          progress: { show: true, width: 14, itemStyle: { color: col } },
          pointer: { itemStyle: { color: col }, width: 4, length: "60%" },
          axisTick: { show: false },
          splitLine: { length: 8, lineStyle: { color: theme.split } },
          axisLabel: { color: theme.muted, fontSize: 10, distance: 16 },
          detail: {
            formatter: "{value}%",
            color: col,
            fontSize: 28,
            fontWeight: 800,
            offsetCenter: [0, "65%"],
          },
          title: { offsetCenter: [0, "88%"], color: theme.muted, fontSize: 12 },
          data: [{ value: Number(clamp.toFixed(0)), name: "Utilization" }],
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, ready]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Typography variant="p" className="text-sm font-semibold">
            {panels?.employee?.employee_name || "My insights"}
          </Typography>
          <Typography variant="small" className="text-muted-foreground">
            {[panels?.employee?.department, panels?.employee?.company, week?.label].filter(Boolean).join(" · ")}
          </Typography>
        </div>
        <Badge variant="outline" className="gap-1 text-[10px] uppercase">
          <Sparkles className="h-3 w-3" />
          Personal
        </Badge>
      </div>

      {shortcuts.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {shortcuts.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => navigate(`${BASE_ROUTE}${s.route}`)}
              className="flex items-start justify-between gap-2 rounded-xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div>
                <Typography variant="p" className="text-sm font-semibold">
                  {s.label}
                </Typography>
                <Typography variant="small" className="text-muted-foreground">
                  {s.description}
                </Typography>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-primary" />
              Daily hours (last 14 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartBox option={dailyOption} height={300} empty="No hours logged in the last 2 weeks" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Week utilization</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartBox option={utilOption} height={300} />
            <Typography variant="small" className="mt-2 text-center text-muted-foreground">
              {week?.logged_hours ?? 0}h / {week?.target_hours ?? 0}h target
            </Typography>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Weekly trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartBox option={weeklyOption} height={300} empty="Not enough weekly history yet" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Billable split (this week)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartBox option={billableOption} height={300} empty="No hours this week" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hours by project</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartBox option={projectOption} height={320} empty="No project hours yet" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hours by activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartBox option={activityOption} height={320} empty="No activity types logged" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4 text-primary" />
              Recent entries
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!recent.length ? (
              <Typography variant="small" className="py-8 text-center text-muted-foreground">
                No recent time entries
              </Typography>
            ) : (
              recent.slice(0, 8).map((row, idx) => (
                <div
                  key={`${row.date}-${idx}`}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border/70 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <Typography variant="small" className="truncate font-medium">
                      {row.project_name || "No project"}
                    </Typography>
                    <Typography variant="small" className="truncate text-muted-foreground">
                      {row.date} · {row.activity_type || "—"}
                      {row.description ? ` · ${row.description}` : ""}
                    </Typography>
                  </div>
                  <div className="shrink-0 text-right">
                    <Typography variant="small" className="font-semibold tabular-nums">
                      {row.hours}h
                    </Typography>
                    <Badge
                      variant="secondary"
                      className={mergeClassNames(
                        "mt-1 text-[10px]",
                        row.is_billable ? "bg-teal-500/15 text-teal-700" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {row.is_billable ? "Billable" : "Non-bill"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
