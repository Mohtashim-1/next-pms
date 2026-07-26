/**
 * Project Profitability Dashboard — portal-native (same data as Desk page).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DatePicker,
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
} from "@next-pms/design-system/components";
import { getFormatedDate, getTodayDate } from "@next-pms/design-system/date";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { BarChart3, RefreshCw } from "lucide-react";
import { addDays } from "date-fns";

import { Header as RootHeader } from "@/app/layout/root";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";
import { loadEcharts } from "./loadEcharts";

type ProjectRow = {
  project: string;
  project_name: string;
  status: string;
  customer?: string;
  company?: string;
  estimated_costing: number;
  total_costing_amount: number;
  total_purchase_cost: number;
  total_expense_claim: number;
  total_consumed_material_cost: number;
  total_billed_amount: number;
  total_billable_amount: number;
  total_cost: number;
  gross_profit: number;
  profit_margin: number;
};

type MonthlyRow = {
  month: string;
  revenue: number;
  ts_cost: number;
  purchase_cost: number;
  total_cost: number;
  profit: number;
};

type DashboardKpis = {
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  profit_margin: number;
  billable_hours: number;
  logged_hours: number;
  active_projects: number;
  completed_projects: number;
  comparisons?: {
    total_revenue?: number;
    total_cost?: number;
    gross_profit?: number;
    profit_margin?: number;
  };
};

const money = (value: number, compact = false) => {
  const n = Number(value || 0);
  if (compact) {
    const a = Math.abs(n);
    const s = n < 0 ? "-" : "";
    if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `${s}${(a / 1_000).toFixed(0)}K`;
    return `${s}${a.toFixed(0)}`;
  }
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtMonth = (ym: string) => {
  if (!ym) return ym;
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
};

const pctLabel = (value?: number, suffix = "YoY") => {
  if (value == null || Number.isNaN(Number(value))) return "";
  const n = Number(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}% ${suffix}`;
};

const getChartTheme = () => {
  const dark =
    typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") ||
      document.body.classList.contains("dark") ||
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  return {
    dark,
    text: dark ? "#e2e8f0" : "#334155",
    muted: dark ? "#94a3b8" : "#64748b",
    split: dark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)",
    tooltipBg: dark ? "#0f172a" : "#1f2937",
    tooltipBorder: dark ? "#334155" : "#374151",
  };
};

const legendStyle = (theme = getChartTheme()) => ({
  textStyle: { color: theme.text, fontSize: 11 },
  pageTextStyle: { color: theme.muted },
  pageIconColor: theme.text,
  pageIconInactiveColor: theme.muted,
});

const axisLabel = (theme = getChartTheme()) => ({
  color: theme.muted,
  fontSize: 11,
});

const tooltipDark = (theme = getChartTheme()) => ({
  backgroundColor: theme.tooltipBg,
  borderColor: theme.tooltipBorder,
  textStyle: { color: "#f8fafc", fontSize: 12 },
});

function ChartBox({
  option,
  height = 340,
  empty,
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
        if (!chartRef.current) chartRef.current = echarts.init(ref.current, null, { renderer: "canvas" });
        if (!option) {
          chartRef.current.clear();
          chartRef.current.setOption({
            title: {
              text: empty || "No data",
              left: "center",
              top: "center",
              textStyle: { color: getChartTheme().muted, fontSize: 14 },
            },
          });
          return;
        }
        chartRef.current.setOption(option, true);
        // Ensure canvas resizes after layout settles (fixes clipped legends)
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

const ProjectProfitability = () => {
  const today = getTodayDate();
  const [fromDate, setFromDate] = useState(getFormatedDate(addDays(new Date(today), -365)));
  const [toDate, setToDate] = useState(today);
  const [company, setCompany] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [customer, setCustomer] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [echartsReady, setEchartsReady] = useState(Boolean(window.echarts));

  useEffect(() => {
    loadEcharts()
      .then(() => fsetEchartsReady(true))
      .catch(() => undefined);
  }, []);

  const { data: companiesData } = useFrappeGetDocList("Company", {
    fields: ["name"],
    limit: 100,
    orderBy: { field: "name", order: "asc" },
  });

  const filters = useMemo(
    () => ({
      company: company || undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      customer: customer.trim() || undefined,
      status: status || undefined,
      _r: refreshKey,
    }),
    [company, fromDate, toDate, customer, status, refreshKey]
  );

  const {
    data: projectsRes,
    isLoading: loadingProjects,
    error: projectsError,
    mutate: mutateProjects,
  } = useFrappeGetCall(
    "hrms.hr.page.project_profitability_dashboard.project_profitability_dashboard.get_project_profitability_data",
    {
      company: filters.company,
      from_date: filters.from_date,
      to_date: filters.to_date,
      customer: filters.customer,
      status: filters.status,
    },
    `ppd-projects-${JSON.stringify(filters)}`,
    { revalidateOnFocus: false }
  );

  const {
    data: monthlyRes,
    isLoading: loadingMonthly,
    mutate: mutateMonthly,
  } = useFrappeGetCall(
    "hrms.hr.page.project_profitability_dashboard.project_profitability_dashboard.get_monthly_trends",
    {
      company: filters.company,
      from_date: filters.from_date,
      to_date: filters.to_date,
    },
    `ppd-monthly-${JSON.stringify(filters)}`,
    { revalidateOnFocus: false }
  );

  const {
    data: kpiRes,
    isLoading: loadingKpis,
    mutate: mutateKpis,
  } = useFrappeGetCall(
    "hrms.hr.page.project_profitability_dashboard.project_profitability_dashboard.get_dashboard_kpis",
    {
      company: filters.company,
      from_date: filters.from_date,
      to_date: filters.to_date,
      customer: filters.customer,
      status: filters.status,
    },
    `ppd-kpis-${JSON.stringify(filters)}`,
    { revalidateOnFocus: false }
  );

  const projects = useMemo(() => {
    const rows = (projectsRes?.message || []) as ProjectRow[];
    const q = projectQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.project_name?.toLowerCase().includes(q) ||
        row.project?.toLowerCase().includes(q) ||
        row.customer?.toLowerCase().includes(q)
    );
  }, [projectsRes, projectQuery]);

  const monthly = (monthlyRes?.message || []) as MonthlyRow[];
  const apiKpis = (kpiRes?.message || null) as DashboardKpis | null;
  const loading = loadingProjects || loadingMonthly || loadingKpis;

  const totals = useMemo(() => {
    return projects.reduce(
      (acc, p) => {
        acc.rev += p.total_billed_amount || 0;
        acc.cost += p.total_cost || 0;
        acc.profit += p.gross_profit || 0;
        acc.billable += p.total_billable_amount || 0;
        acc.ts += p.total_costing_amount || 0;
        acc.pu += p.total_purchase_cost || 0;
        acc.ex += p.total_expense_claim || 0;
        acc.ma += p.total_consumed_material_cost || 0;
        acc.estimated += p.estimated_costing || 0;
        if ((p.gross_profit || 0) < 0) acc.lossMaking += 1;
        if ((p.status || "").toLowerCase() === "open") acc.open += 1;
        if ((p.status || "").toLowerCase() === "completed") acc.completed += 1;
        return acc;
      },
      {
        rev: 0,
        cost: 0,
        profit: 0,
        billable: 0,
        ts: 0,
        pu: 0,
        ex: 0,
        ma: 0,
        estimated: 0,
        lossMaking: 0,
        open: 0,
        completed: 0,
      }
    );
  }, [projects]);

  const margin = totals.rev ? (totals.profit / totals.rev) * 100 : 0;
  const billingEff = totals.billable ? (totals.rev / totals.billable) * 100 : 0;
  const unbilled = Math.max(totals.billable - totals.rev, 0);
  const avgMargin =
    projects.length > 0
      ? projects.reduce((s, p) => s + (p.profit_margin || 0), 0) / projects.length
      : 0;
  const budgetVariance = totals.estimated ? ((totals.cost - totals.estimated) / totals.estimated) * 100 : 0;
  const billableShare = apiKpis?.logged_hours
    ? ((apiKpis.billable_hours || 0) / apiKpis.logged_hours) * 100
    : 0;

  const gradient = (top: string, bot: string, horizontal = false) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const echarts = window.echarts as any;
    if (!echarts?.graphic) return top;
    return horizontal
      ? new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: bot },
          { offset: 1, color: top },
        ])
      : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: top },
          { offset: 1, color: bot },
        ]);
  };

  const trendOption = useMemo(() => {
    if (!monthly.length) return null;
    const theme = getChartTheme();
    const months = monthly.map((r) => fmtMonth(r.month));
    return {
      tooltip: { trigger: "axis", ...tooltipDark(theme) },
      legend: { top: 0, ...legendStyle(theme) },
      grid: { left: 16, right: 20, bottom: 28, top: 44, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: months,
        axisLabel: axisLabel(theme),
        axisLine: { lineStyle: { color: theme.split } },
      },
      yAxis: {
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => money(v, true) },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        {
          name: "Timesheet Cost",
          type: "line",
          stack: "cost",
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.75, color: gradient("rgba(79,134,247,0.9)", "rgba(26,86,219,0.1)") },
          lineStyle: { width: 0 },
          data: monthly.map((r) => r.ts_cost),
        },
        {
          name: "Purchase Cost",
          type: "line",
          stack: "cost",
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.75, color: gradient("rgba(249,115,22,0.9)", "rgba(194,65,12,0.1)") },
          lineStyle: { width: 0 },
          data: monthly.map((r) => r.purchase_cost),
        },
        {
          name: "Revenue",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 3, color: "#10b981" },
          areaStyle: { opacity: 0.12, color: gradient("#10b981", "rgba(16,185,129,0)") },
          data: monthly.map((r) => r.revenue),
        },
        {
          name: "Profit",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#a78bfa", type: "dashed" },
          data: monthly.map((r) => r.profit),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, echartsReady]);

  const monthlyProfitOption = useMemo(() => {
    if (!monthly.length) return null;
    const theme = getChartTheme();
    return {
      tooltip: { trigger: "axis", ...tooltipDark(theme) },
      grid: { left: 12, right: 16, top: 28, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: monthly.map((r) => fmtMonth(r.month)),
        axisLabel: axisLabel(theme),
      },
      yAxis: {
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => money(v, true) },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        {
          name: "Monthly Profit",
          type: "bar",
          barMaxWidth: 28,
          data: monthly.map((r) => ({
            value: r.profit,
            itemStyle: {
              color: r.profit >= 0 ? gradient("#10b981", "#047857") : gradient("#f43f5e", "#be123c"),
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, echartsReady]);

  const nestOption = useMemo(() => {
    if (!projects.length) return null;
    const theme = getChartTheme();
    const totalCost = totals.ts + totals.pu + totals.ex + totals.ma;
    const outer = [
      { value: totals.ts, name: "Timesheet", itemStyle: { color: "#4f86f7" } },
      { value: totals.pu, name: "Purchase", itemStyle: { color: "#fb923c" } },
      { value: totals.ex, name: "Expense", itemStyle: { color: "#a855f7" } },
      { value: totals.ma, name: "Material", itemStyle: { color: "#059669" } },
    ].filter((s) => s.value > 0);

    return {
      tooltip: {
        trigger: "item",
        ...tooltipDark(theme),
        formatter: (p: { seriesName: string; marker: string; name: string; value: number; percent: number }) =>
          `${p.seriesName}<br/>${p.marker} ${p.name}: <b>${money(p.value)}</b> (${p.percent}%)`,
      },
      legend: {
        top: 4,
        left: "center",
        ...legendStyle(theme),
      },
      series: [
        {
          name: "Overview",
          type: "pie",
          radius: [0, "32%"],
          center: ["50%", "58%"],
          label: {
            show: true,
            position: "inner",
            fontSize: 11,
            color: "#fff",
            formatter: "{b}",
          },
          labelLine: { show: false },
          data: [
            { value: totals.rev, name: "Revenue", itemStyle: { color: "#10b981" } },
            { value: totalCost, name: "Total Cost", itemStyle: { color: "#f97316" } },
          ],
        },
        {
          name: "Cost Mix",
          type: "pie",
          radius: ["42%", "68%"],
          center: ["50%", "58%"],
          // Legend handles names — hide outer labels to avoid overlap
          label: { show: false },
          labelLine: { show: false },
          data: outer,
        },
      ],
    };
  }, [projects.length, totals]);

  const topProjectsOption = useMemo(() => {
    const theme = getChartTheme();
    const palette = [
      "#4f86f7",
      "#10b981",
      "#f97316",
      "#a855f7",
      "#22d3ee",
      "#f43f5e",
      "#fbbf24",
      "#34d399",
      "#818cf8",
      "#fb7185",
    ];
    const top = [...projects]
      .filter((p) => p.total_billed_amount > 0)
      .sort((a, b) => b.total_billed_amount - a.total_billed_amount)
      .slice(0, 10);
    if (!top.length) return null;

    const total = top.reduce((s, p) => s + (p.total_billed_amount || 0), 0);
    const pieData = top.map((p, i) => ({
      name: p.project_name,
      value: p.total_billed_amount,
      itemStyle: { color: palette[i % palette.length] },
    }));

    return {
      tooltip: {
        trigger: "item",
        ...tooltipDark(theme),
        formatter: (p: { name: string; marker: string; value: number; percent: number }) =>
          `<b>${p.name}</b><br/>${p.marker} Revenue: <b>${money(p.value)}</b> (${p.percent}%)`,
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 4,
        top: 16,
        bottom: 16,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 8,
        ...legendStyle(theme),
        formatter: (name: string) => {
          const row = pieData.find((d) => d.name === name);
          if (!row) return name.length > 22 ? `${name.slice(0, 21)}…` : name;
          const short = name.length > 18 ? `${name.slice(0, 17)}…` : name;
          const share = total ? ((row.value / total) * 100).toFixed(0) : "0";
          return `${short}  ${share}%`;
        },
      },
      series: [
        {
          name: "Revenue",
          type: "pie",
          radius: ["42%", "68%"],
          center: ["34%", "52%"],
          // No on-slice labels — legend is the source of truth
          label: { show: false },
          labelLine: { show: false },
          avoidLabelOverlap: true,
          data: pieData,
          emphasis: {
            scale: true,
            itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.35)" },
            label: {
              show: true,
              formatter: (p: { name: string; percent: number }) => {
                const short = p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name;
                return `${short}\n${p.percent}%`;
              },
              color: theme.text,
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: theme.dark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.92)",
              borderRadius: 4,
              padding: [4, 6],
            },
          },
        },
      ],
    };
  }, [projects]);

  const marginOption = useMemo(() => {
    const theme = getChartTheme();
    const rows = [...projects]
      .filter((p) => p.total_billed_amount > 0)
      .sort((a, b) => b.profit_margin - a.profit_margin)
      .slice(0, 20);
    if (!rows.length) return null;
    return {
      tooltip: { trigger: "axis", ...tooltipDark(theme) },
      grid: { left: 8, right: 40, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: theme.split } },
      },
      yAxis: {
        type: "category",
        data: rows.map((p) => p.project_name).reverse(),
        axisLabel: { ...axisLabel(theme), width: 120, overflow: "truncate", fontSize: 10 },
      },
      series: [
        {
          type: "bar",
          label: { show: true, position: "right", formatter: "{c}%", fontSize: 10, color: theme.text },
          data: rows
            .map((p) => ({
              value: Number(p.profit_margin || 0),
              itemStyle: {
                color: p.profit_margin >= 0 ? gradient("#10b981", "#d1fae5", true) : gradient("#f43f5e", "#fee2e2", true),
                borderRadius: [0, 4, 4, 0],
              },
            }))
            .reverse(),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, echartsReady]);

  const gaugeOption = useMemo(() => {
    const theme = getChartTheme();
    const clamp = Math.min(Math.max(margin, -100), 100);
    const col = margin >= 0 ? "#10b981" : "#f43f5e";
    return {
      series: [
        {
          type: "gauge",
          startAngle: 210,
          endAngle: -30,
          min: -100,
          max: 100,
          splitNumber: 4,
          radius: "82%",
          pointer: { itemStyle: { color: col }, length: "65%", width: 5 },
          progress: {
            show: true,
            width: 18,
            itemStyle: { color: gradient(col, margin >= 0 ? "#047857" : "#be123c", true) },
          },
          axisLine: { lineStyle: { width: 18, color: [[1, theme.split]] } },
          axisTick: { show: false },
          splitLine: { length: 10, lineStyle: { width: 2, color: theme.split } },
          axisLabel: { distance: 22, fontSize: 10, color: theme.muted, formatter: "{value}%" },
          detail: {
            valueAnimation: true,
            formatter: "{value}%",
            fontSize: 32,
            fontWeight: 900,
            color: col,
            offsetCenter: [0, "62%"],
          },
          title: { offsetCenter: [0, "85%"], fontSize: 12, color: theme.muted },
          data: [{ value: Number(clamp.toFixed(1)), name: "Profit Margin" }],
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margin, echartsReady]);

  const stackedOption = useMemo(() => {
    const theme = getChartTheme();
    const top = [...projects].sort((a, b) => b.total_cost - a.total_cost).slice(0, 15);
    if (!top.length) return null;
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipDark(theme) },
      legend: { top: 0, ...legendStyle(theme) },
      grid: { left: 8, right: 16, top: 36, bottom: 48, containLabel: true },
      xAxis: {
        type: "category",
        data: top.map((p) => p.project_name),
        axisLabel: { ...axisLabel(theme), rotate: 35, fontSize: 10, width: 90, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => money(v, true) },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        { name: "Timesheet", type: "bar", stack: "cost", data: top.map((p) => p.total_costing_amount), itemStyle: { color: "#4f86f7" } },
        { name: "Purchase", type: "bar", stack: "cost", data: top.map((p) => p.total_purchase_cost), itemStyle: { color: "#fb923c" } },
        { name: "Expense", type: "bar", stack: "cost", data: top.map((p) => p.total_expense_claim), itemStyle: { color: "#a855f7" } },
        { name: "Material", type: "bar", stack: "cost", data: top.map((p) => p.total_consumed_material_cost), itemStyle: { color: "#059669" } },
      ],
    };
  }, [projects]);

  const billingOption = useMemo(() => {
    const theme = getChartTheme();
    const top = [...projects].sort((a, b) => b.total_billable_amount - a.total_billable_amount).slice(0, 15);
    if (!top.length) return null;
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipDark(theme) },
      legend: { top: 0, ...legendStyle(theme) },
      grid: { left: 8, right: 16, top: 36, bottom: 48, containLabel: true },
      xAxis: {
        type: "category",
        data: top.map((p) => p.project_name),
        axisLabel: { ...axisLabel(theme), rotate: 35, fontSize: 10, width: 90, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => money(v, true) },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        {
          name: "Billable",
          type: "bar",
          barMaxWidth: 26,
          data: top.map((p) => p.total_billable_amount),
          itemStyle: { color: gradient("#a78bfa", "#7c3aed"), borderRadius: [4, 4, 0, 0] },
        },
        {
          name: "Billed",
          type: "bar",
          barMaxWidth: 26,
          data: top.map((p) => p.total_billed_amount),
          itemStyle: { color: gradient("#34d399", "#059669"), borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, echartsReady]);

  const treemapOption = useMemo(() => {
    const theme = getChartTheme();
    const palette = ["#4f86f7", "#10b981", "#f97316", "#a855f7", "#22d3ee", "#f43f5e", "#fbbf24", "#34d399", "#818cf8", "#fb7185"];
    const data = projects
      .filter((p) => p.total_billed_amount > 0)
      .map((p, i) => ({
        name: p.project_name,
        value: p.total_billed_amount,
        profit: p.gross_profit,
        margin: p.profit_margin,
        itemStyle: { color: palette[i % palette.length] },
      }));
    if (!data.length) return null;
    return {
      tooltip: {
        ...tooltipDark(theme),
        formatter: (p: { name: string; value: number; data: { profit: number; margin: number } }) =>
          `<b>${p.name}</b><br/>Revenue: <b>${money(p.value)}</b><br/>Profit: <b>${money(p.data.profit)}</b><br/>Margin: <b>${Number(
            p.data.margin || 0
          ).toFixed(1)}%</b>`,
      },
      series: [
        {
          type: "treemap",
          data,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: {
            show: true,
            fontSize: 11,
            formatter: (p: { name: string; value: number }) => `${p.name}\n${money(p.value, true)}`,
            color: "#fff",
          },
          itemStyle: { borderWidth: 2, borderColor: theme.dark ? "#0f172a" : "#fff", gapWidth: 2 },
        },
      ],
    };
  }, [projects]);

  const scatterOption = useMemo(() => {
    const theme = getChartTheme();
    const pts = projects.filter((p) => p.total_billed_amount > 0);
    if (!pts.length) return null;
    return {
      tooltip: {
        ...tooltipDark(theme),
        formatter: (p: { data: [number, number, string, number] }) =>
          `<b>${p.data[2]}</b><br/>Revenue: ${money(p.data[0])}<br/>Margin: ${p.data[1].toFixed(1)}%<br/>Profit: ${money(p.data[3])}`,
      },
      grid: { left: 16, right: 24, top: 28, bottom: 40, containLabel: true },
      xAxis: {
        name: "Revenue",
        nameTextStyle: { color: theme.muted },
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => money(v, true) },
        splitLine: { lineStyle: { color: theme.split } },
      },
      yAxis: {
        name: "Margin %",
        nameTextStyle: { color: theme.muted },
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        {
          type: "scatter",
          symbolSize: (val: number[]) => Math.max(12, Math.min(42, Math.sqrt(Math.abs(val[3] || 0)) / 8)),
          data: pts.map((p) => [p.total_billed_amount, p.profit_margin, p.project_name, p.gross_profit]),
          itemStyle: {
            color: (params: { data: number[] }) => (params.data[1] >= 0 ? "rgba(16,185,129,0.75)" : "rgba(244,63,94,0.75)"),
          },
        },
      ],
    };
  }, [projects]);

  const customerOption = useMemo(() => {
    const theme = getChartTheme();
    const map = new Map<string, { revenue: number; cost: number; profit: number }>();
    for (const p of projects) {
      const key = p.customer || "No Customer";
      const cur = map.get(key) || { revenue: 0, cost: 0, profit: 0 };
      cur.revenue += p.total_billed_amount || 0;
      cur.cost += p.total_cost || 0;
      cur.profit += p.gross_profit || 0;
      map.set(key, cur);
    }
    const rows = [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 12);
    if (!rows.length) return null;
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipDark(theme) },
      legend: { top: 0, ...legendStyle(theme) },
      grid: { left: 8, right: 16, top: 36, bottom: 48, containLabel: true },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.name),
        axisLabel: { ...axisLabel(theme), rotate: 30, fontSize: 10, width: 90, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => money(v, true) },
        splitLine: { lineStyle: { color: theme.split } },
      },
      series: [
        { name: "Revenue", type: "bar", data: rows.map((r) => r.revenue), itemStyle: { color: "#38bdf8" } },
        { name: "Cost", type: "bar", data: rows.map((r) => r.cost), itemStyle: { color: "#fb923c" } },
        { name: "Profit", type: "bar", data: rows.map((r) => r.profit), itemStyle: { color: "#34d399" } },
      ],
    };
  }, [projects]);

  const statusOption = useMemo(() => {
    const theme = getChartTheme();
    const counts = projects.reduce(
      (acc, p) => {
        const key = p.status || "Unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }));
    if (!data.length) return null;
    const colors: Record<string, string> = {
      Open: "#3b82f6",
      Completed: "#10b981",
      Cancelled: "#94a3b8",
    };
    return {
      tooltip: { trigger: "item", ...tooltipDark(theme) },
      legend: { bottom: 0, ...legendStyle(theme) },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          center: ["50%", "46%"],
          data: data.map((d) => ({
            ...d,
            itemStyle: { color: colors[d.name] || "#a78bfa" },
          })),
          label: { show: false },
          labelLine: { show: false },
        },
      ],
    };
  }, [projects]);

  const refresh = () => {
    setRefreshKey((k) => k + 1);
    mutateProjects();
    mutateMonthly();
    mutateKpis();
  };

  const cmp = apiKpis?.comparisons;
  const kpis = [
    {
      label: "Total Revenue",
      value: money(totals.rev),
      sub: pctLabel(cmp?.total_revenue) || `${projects.length} projects`,
      className: "from-blue-600 to-sky-400",
    },
    {
      label: "Total Cost",
      value: money(totals.cost),
      sub: pctLabel(cmp?.total_cost) || "All categories",
      className: "from-amber-700 to-orange-400",
    },
    {
      label: "Gross Profit",
      value: money(totals.profit),
      sub: pctLabel(cmp?.gross_profit) || "",
      className: totals.profit >= 0 ? "from-emerald-800 to-emerald-400" : "from-rose-800 to-rose-400",
    },
    {
      label: "Profit Margin",
      value: `${margin.toFixed(1)}%`,
      sub: cmp?.profit_margin != null ? `${pctLabel(cmp.profit_margin, "pts YoY")}` : "Overall",
      className: "from-violet-800 to-violet-400",
    },
    {
      label: "Billing Efficiency",
      value: `${billingEff.toFixed(1)}%`,
      sub: "Billed / Billable",
      className: "from-cyan-800 to-cyan-400",
    },
    {
      label: "Unbilled Amount",
      value: money(unbilled),
      sub: "Billable − Billed",
      className: "from-fuchsia-800 to-pink-400",
    },
    {
      label: "Billable Hours",
      value: Number(apiKpis?.billable_hours || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
      sub: `${billableShare.toFixed(0)}% of logged`,
      className: "from-indigo-700 to-indigo-400",
    },
    {
      label: "Logged Hours",
      value: Number(apiKpis?.logged_hours || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
      sub: "Timesheet hours",
      className: "from-slate-700 to-slate-500",
    },
    {
      label: "Active Projects",
      value: String(apiKpis?.active_projects ?? totals.open),
      sub: `${apiKpis?.completed_projects ?? totals.completed} completed`,
      className: "from-sky-700 to-blue-400",
    },
    {
      label: "Loss-Making",
      value: String(totals.lossMaking),
      sub: "Projects with negative profit",
      className: "from-rose-800 to-red-400",
    },
    {
      label: "Avg Project Margin",
      value: `${avgMargin.toFixed(1)}%`,
      sub: "Mean across projects",
      className: "from-teal-800 to-teal-400",
    },
    {
      label: "Budget Variance",
      value: `${budgetVariance >= 0 ? "+" : ""}${budgetVariance.toFixed(1)}%`,
      sub: totals.estimated ? `Est. ${money(totals.estimated, true)}` : "No estimates",
      className: budgetVariance <= 0 ? "from-emerald-800 to-lime-500" : "from-orange-800 to-amber-400",
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <RootHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Typography variant="h5" className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Project Profitability Dashboard
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              Revenue, cost, margin, billing efficiency, and portfolio charts
            </Typography>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={mergeClassNames("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </RootHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-4">
            <div className="space-y-1 min-w-[160px]">
              <Typography variant="small">From</Typography>
              <DatePicker date={fromDate} onDateChange={(d) => d && setFromDate(getFormatedDate(d))} />
            </div>
            <div className="space-y-1 min-w-[160px]">
              <Typography variant="small">To</Typography>
              <DatePicker date={toDate} onDateChange={(d) => d && setToDate(getFormatedDate(d))} />
            </div>
            <div className="space-y-1 min-w-[180px]">
              <Typography variant="small">Company</Typography>
              <Select value={company || "__all__"} onValueChange={(v) => setCompany(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Companies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Companies</SelectItem>
                  {(companiesData || []).map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[140px]">
              <Typography variant="small">Status</Typography>
              <Select value={status || "__all__"} onValueChange={(v) => setStatus(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[180px] flex-1">
              <Typography variant="small">Customer</Typography>
              <Input placeholder="Customer name (exact)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </div>
            <div className="space-y-1 min-w-[180px] flex-1">
              <Typography variant="small">Filter table</Typography>
              <Input
                placeholder="Search project / customer…"
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {projectsError ? (
          <Typography className="text-destructive">{parseFrappeErrorMsg(projectsError)}</Typography>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          {loading && !projects.length
            ? Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
            : kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className={mergeClassNames(
                    "relative overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white shadow-md",
                    kpi.className
                  )}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">{kpi.label}</div>
                  <div className="mt-1 text-2xl font-black leading-tight">{kpi.value}</div>
                  {kpi.sub ? <div className="mt-1 text-[11px] opacity-75">{kpi.sub}</div> : null}
                </div>
              ))}
        </div>

        <section className="space-y-2">
          <Typography variant="small" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Trends
          </Typography>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Monthly Revenue & Cost Trend
                </Typography>
                {loading && !monthly.length ? <Skeleton className="h-[340px] w-full" /> : <ChartBox option={trendOption} />}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Monthly Profit
                </Typography>
                <ChartBox option={monthlyProfitOption} />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-2">
          <Typography variant="small" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Cost Structure & Project Revenue Share
          </Typography>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Revenue vs Cost Breakdown
                </Typography>
                <ChartBox option={nestOption} height={360} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Top Projects by Revenue
                </Typography>
                <ChartBox option={topProjectsOption} height={360} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Overall Profit Margin Gauge
                </Typography>
                <ChartBox option={gaugeOption} height={360} />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-2">
          <Typography variant="small" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Rankings & Cost Mix
          </Typography>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Profit Margin % — Top Projects
                </Typography>
                <ChartBox option={marginOption} height={380} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Cost Breakdown per Project (Stacked)
                </Typography>
                <ChartBox option={stackedOption} height={380} />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-2">
          <Typography variant="small" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Billing Efficiency & Scale
          </Typography>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Billable vs Billed — Top Projects
                </Typography>
                <ChartBox option={billingOption} height={360} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Project Status Mix
                </Typography>
                <ChartBox option={statusOption} height={360} />
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Project Revenue Treemap
                </Typography>
                <ChartBox option={treemapOption} height={360} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <Typography variant="small" className="mb-2 font-medium">
                  Revenue vs Margin (Scatter)
                </Typography>
                <ChartBox option={scatterOption} height={360} />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-2">
          <Typography variant="small" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Customer Profitability
          </Typography>
          <Card>
            <CardContent className="pt-4">
              <Typography variant="small" className="mb-2 font-medium">
                Top Customers — Revenue, Cost, Profit
              </Typography>
              <ChartBox option={customerOption} height={360} />
            </CardContent>
          </Card>
        </section>

        <section className="space-y-2">
          <Typography variant="small" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Full Project Detail
          </Typography>
          <Card>
            <CardContent className="pt-4 overflow-auto">
              {!projects.length && !loading ? (
                <Typography className="py-8 text-center text-muted-foreground">
                  No projects found for this filter selection.
                </Typography>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Billable</TableHead>
                      <TableHead className="text-right">Timesheet</TableHead>
                      <TableHead className="text-right">Purchase</TableHead>
                      <TableHead className="text-right">Expense</TableHead>
                      <TableHead className="text-right">Material</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((row) => (
                      <TableRow key={row.project}>
                        <TableCell className="font-medium max-w-[200px] truncate" title={row.project_name}>
                          {row.project_name}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate">{row.customer || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_billed_amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_billable_amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_costing_amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_purchase_cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_expense_claim)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_consumed_material_cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.total_cost)}</TableCell>
                        <TableCell
                          className={mergeClassNames(
                            "text-right tabular-nums font-medium",
                            row.gross_profit >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}
                        >
                          {money(row.gross_profit)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="secondary"
                            className={
                              row.profit_margin >= 0 ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700"
                            }
                          >
                            {Number(row.profit_margin || 0).toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default ProjectProfitability;
