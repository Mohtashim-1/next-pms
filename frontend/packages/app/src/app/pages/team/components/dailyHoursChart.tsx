/**
 * Daily logged-hours chart for the Team week.
 * Company total by default; the employee filter switches it to that person.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Typography } from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Clock3 } from "lucide-react";

import { loadEcharts } from "@/app/pages/project/profitability/loadEcharts";
import type { TeamState } from "../employee-detail/types";

type ChartSeries = {
  name: string;
  employee?: string;
  hours: number[];
};

type DailyHoursChartResponse = {
  mode: "company" | "employee";
  title: string;
  week_label?: string;
  labels: string[];
  series: ChartSeries[];
  expected?: number[] | null;
  employee_count: number;
  shown_count: number;
  truncated?: boolean;
  total_hours: number;
};

const PALETTE = ["#4f86f7", "#14b8a6", "#f97316", "#a855f7", "#22d3ee", "#f43f5e", "#fbbf24", "#818cf8"];

const getTheme = () => {
  const dark =
    typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  return {
    text: dark ? "#e2e8f0" : "#334155",
    muted: dark ? "#94a3b8" : "#64748b",
    split: dark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)",
    tooltipBg: dark ? "#0f172a" : "#1f2937",
  };
};

function ChartBox({
  option,
  height = 280,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: Record<string, any> | null;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    loadEcharts()
      .then((echarts) => {
        if (disposed || !ref.current || !option) return;
        if (!chartRef.current) chartRef.current = echarts.init(ref.current);
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
  }, [option]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    []
  );

  return <div ref={ref} style={{ height }} className="relative z-0 w-full overflow-hidden" />;
}

export function DailyHoursChart({ teamState }: { teamState: TeamState }) {
  const [ready, setReady] = useState(Boolean(window.echarts));

  useEffect(() => {
    loadEcharts()
      .then(() => setReady(true))
      .catch(() => undefined);
  }, []);

  const { data, isLoading } = useFrappeGetCall(
    "next_pms.timesheet.api.team.get_daily_hours_chart",
    {
      date: teamState.weekDate,
      employee_name: teamState.employeeName,
      project: teamState.project,
      user_group: teamState.userGroup,
      status_filter: teamState.statusFilter,
      reports_to: teamState.reportsTo,
      status: teamState.status,
      department: teamState.department,
      designation: teamState.designation,
      customer: teamState.customer,
      project_type: teamState.projectType,
      task: teamState.task,
    },
    undefined,
    { revalidateOnFocus: false }
  );

  const chart = data?.message as DailyHoursChartResponse | undefined;
  const theme = getTheme();

  const option = useMemo(() => {
    if (!chart?.labels?.length || !chart.series?.length) return null;
    const many = chart.mode === "employee" && chart.series.length > 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series: any[] = chart.series.map((item, index) => ({
      name: item.name,
      type: many ? "line" : "bar",
      data: item.hours,
      smooth: many,
      itemStyle: { color: PALETTE[index % PALETTE.length], borderRadius: many ? 0 : [4, 4, 0, 0] },
      lineStyle: many ? { width: 2 } : undefined,
    }));
    if (chart.expected?.length) {
      series.push({
        name: "Expected",
        type: "line",
        data: chart.expected,
        smooth: false,
        itemStyle: { color: "#94a3b8" },
        lineStyle: { width: 2, type: "dashed" },
      });
    }
    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: theme.tooltipBg,
        textStyle: { color: "#f8fafc" },
        valueFormatter: (value: number) => `${value}h`,
      },
      legend: {
        type: "scroll",
        top: 0,
        textStyle: { color: theme.text, fontSize: 11 },
      },
      grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: chart.labels,
        axisLabel: { color: theme.muted, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        name: "Hours",
        axisLabel: { color: theme.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series,
    };
    // Theme is read at render time; chart payload is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, ready]);

  const subtitle = useMemo(() => {
    if (!chart) return "";
    const hours = `${chart.total_hours}h logged`;
    if (chart.mode === "employee") {
      if (chart.series.length === 1) return `${chart.week_label || "This week"} · ${hours}`;
      const count = chart.truncated
        ? `${chart.shown_count} of ${chart.employee_count} matches`
        : `${chart.employee_count} employees`;
      return `${chart.week_label || "This week"} · ${count} · ${hours}`;
    }
    return `${chart.week_label || "This week"} · ${chart.employee_count} employees · ${hours}`;
  }, [chart]);

  return (
    <Card className="mx-3 mt-3 mb-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock3 className="h-4 w-4 text-primary" />
          {chart?.title || "Daily logged hours"}
        </CardTitle>
        <Typography variant="small" className="text-muted-foreground">
          {chart?.mode === "employee"
            ? "Daily logged hours for the selected employee"
            : "Company-wide daily logged hours. Other team filters still apply."}
          {subtitle ? ` · ${subtitle}` : ""}
        </Typography>
      </CardHeader>
      <CardContent>
        {isLoading && !chart ? (
          <Skeleton className="h-[280px] w-full" />
        ) : option ? (
          <ChartBox option={option} />
        ) : (
          <Typography variant="small" className="flex h-[120px] items-center justify-center text-muted-foreground">
            {teamState.employeeName ? "No employee matches this filter" : "No hours logged this week"}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
