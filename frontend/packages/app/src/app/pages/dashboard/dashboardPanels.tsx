/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Typography,
} from "@next-pms/design-system/components";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Clock3,
  DollarSign,
  HeartPulse,
  History,
  Layers,
  ListChecks,
  TrendingUp,
  Users,
} from "lucide-react";

/**
 * Internal dependencies.
 */
import { BASE_ROUTE, PROJECT, RESOURCE_MANAGEMENT, TASK, TEAM, TIMESHEET } from "@/lib/constant";
import { mergeClassNames } from "@/lib/utils";

type TrendPoint = {
  label: string;
  capacity_hours: number;
  demand_hours: number;
  bench_hours: number;
  utilization_pct: number;
};

type TaskStatusRow = { status: string; count: number };

type ModuleShortcut = {
  key: string;
  label: string;
  description: string;
  route: string;
};

type ExtraKpi = {
  key: string;
  label: string;
  value: string | number;
  route?: string;
  status?: "healthy" | "warning" | "critical" | "neutral";
};

type TimesheetTrendPoint = {
  label: string;
  logged_hours: number;
  billable_hours: number;
  non_billable_hours: number;
  billable_ratio: number;
};

type DashboardPanels = {
  shortcuts?: ModuleShortcut[];
  extra_kpis?: ExtraKpi[];
  utilization_trend?: TrendPoint[];
  capacity_forecast?: TrendPoint[];
  timesheet_trend?: TimesheetTrendPoint[];
  department_utilization?: Array<{
    department: string;
    capacity_hours: number;
    demand_hours: number;
    utilization_pct: number;
  }>;
  timesheet_week?: {
    period_label: string;
    logged_hours: number;
    billable_hours: number;
    active_employees: number;
    active_tasks: number;
    allocated_hours: number;
    capacity_hours: number;
  };
  tasks_overview?: {
    total: number;
    overdue: number;
    by_status: TaskStatusRow[];
  };
  client_health?: {
    green: number;
    amber: number;
    red: number;
    unrated: number;
    total_projects: number;
    health_score: number;
  };
  at_risk_projects?: Array<{
    project: string;
    project_name: string;
    customer?: string;
    rag_status: string;
    percent_complete: number;
    expected_end_date?: string;
  }>;
  margin_by_customer?: Array<{
    key: string;
    label: string;
    actual_margin: number;
    actual_margin_pct: number;
    recognized_revenue: number;
    project_count: number;
  }>;
  ar_aging?: {
    currency: string;
    labels: Record<string, string>;
    values: Record<string, number>;
  };
  budget_alerts?: Array<{
    project: string;
    project_name: string;
    customer?: string;
    budget_amount: number;
    burn_amount: number;
    utilization_pct: number;
    currency?: string;
  }>;
  margin_waterfall?: {
    currency?: string;
    recognized_revenue: number;
    incurred_cost: number;
    actual_margin: number;
    actual_margin_pct: number;
    planned_margin_pct: number;
    period_start?: string;
    period_end?: string;
  };
  margin_by_project_type?: Array<{
    label: string;
    actual_margin: number;
    actual_margin_pct: number;
    recognized_revenue: number;
    project_count: number;
  }>;
  project_status?: {
    open: number;
    total: number;
    by_status: TaskStatusRow[];
  };
  top_projects_by_hours?: Array<{
    project: string;
    project_name: string;
    customer?: string;
    total_hours: number;
    billable_hours: number;
  }>;
  overdue_tasks?: Array<{
    task: string;
    subject: string;
    project?: string;
    status?: string;
    exp_end_date?: string;
    priority?: string;
  }>;
  recent_activity?: Array<{
    type: string;
    title: string;
    status?: string;
    reference?: string;
    project?: string;
    when?: string;
    user?: string;
  }>;
  approval_summary?: {
    pending_entries: number;
    pending_sheets: number;
  };
  allocation_summary?: {
    confirmed: number;
    tentative: number;
    total: number;
    by_status: TaskStatusRow[];
  };
};

const TASK_COLORS = ["bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-violet-500", "bg-slate-400", "bg-red-500"];
const RAG_COLORS: Record<string, string> = {
  Green: "bg-emerald-500",
  Amber: "bg-amber-500",
  Red: "bg-red-500",
  Unrated: "bg-slate-400",
};
const AR_COLORS = ["bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-orange-500", "bg-red-500"];

const formatNumber = (value: number, digits = 1) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });

const formatCurrency = (value: number, currency = "") =>
  `${currency ? `${currency} ` : ""}${formatNumber(value, 2)}`;

const ragBadgeVariant = (status: string) => {
  if (status === "Red") return "destructive" as const;
  if (status === "Amber") return "secondary" as const;
  return "outline" as const;
};

const PanelCard = ({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <Card className={mergeClassNames("rounded-xl shadow-none", className)}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
      <CardTitle className="flex items-center gap-2 text-base font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </CardTitle>
      {action}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

const DualBarChart = ({
  data,
  activeIndex,
  onSelect,
}: {
  data: TrendPoint[];
  activeIndex: number | null;
  onSelect: (index: number | null) => void;
}) => {
  const maxValue = Math.max(...data.map((point) => Math.max(point.capacity_hours, point.demand_hours)), 1);

  return (
    <div className="space-y-3">
      <div className="flex h-44 items-end gap-2 overflow-x-auto pb-1">
        {data.map((point, index) => {
          const isActive = activeIndex === index;
          return (
            <button
              key={`${point.label}-${index}`}
              type="button"
              className={mergeClassNames(
                "group flex min-w-[52px] flex-1 flex-col items-center gap-2 rounded-md px-1 py-1 transition",
                isActive && "bg-muted/60"
              )}
              onClick={() => onSelect(isActive ? null : index)}
              title={`${point.label}: ${point.utilization_pct}% utilization`}
            >
              <div className="flex h-32 w-full items-end justify-center gap-1">
                <div
                  className="w-2 rounded-t bg-primary/70 transition-all group-hover:bg-primary"
                  style={{ height: `${(point.demand_hours / maxValue) * 100}%`, minHeight: point.demand_hours ? 4 : 0 }}
                />
                <div
                  className="w-2 rounded-t bg-muted-foreground/30 transition-all group-hover:bg-muted-foreground/50"
                  style={{ height: `${(point.capacity_hours / maxValue) * 100}%`, minHeight: point.capacity_hours ? 4 : 0 }}
                />
              </div>
              <Typography variant="small" className="max-w-[72px] truncate text-[10px] text-muted-foreground">
                {point.label.replace("This Week", "Now")}
              </Typography>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary/70" />
          Demand
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          Capacity
        </span>
      </div>
      {activeIndex !== null && data[activeIndex] ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-4">
          <MetricPill label="Utilization" value={`${data[activeIndex].utilization_pct}%`} />
          <MetricPill label="Demand" value={`${formatNumber(data[activeIndex].demand_hours)}h`} />
          <MetricPill label="Capacity" value={`${formatNumber(data[activeIndex].capacity_hours)}h`} />
          <MetricPill label="Bench" value={`${formatNumber(data[activeIndex].bench_hours)}h`} />
        </div>
      ) : (
        <Typography variant="small" className="text-muted-foreground">
          Click a bar to inspect week-level capacity and demand.
        </Typography>
      )}
    </div>
  );
};

const TimesheetTrendChart = ({
  data,
  activeIndex,
  onSelect,
}: {
  data: TimesheetTrendPoint[];
  activeIndex: number | null;
  onSelect: (index: number | null) => void;
}) => {
  const maxValue = Math.max(...data.map((point) => point.logged_hours), 1);
  return (
    <div className="space-y-3">
      <div className="flex h-44 items-end gap-2 overflow-x-auto pb-1">
        {data.map((point, index) => {
          const isActive = activeIndex === index;
          return (
            <button
              key={`${point.label}-${index}`}
              type="button"
              className={mergeClassNames(
                "group flex min-w-[52px] flex-1 flex-col items-center gap-2 rounded-md px-1 py-1 transition",
                isActive && "bg-muted/60"
              )}
              onClick={() => onSelect(isActive ? null : index)}
            >
              <div className="flex h-32 w-full flex-col items-center justify-end gap-0.5">
                <div
                  className="w-3 rounded-t bg-primary/80"
                  style={{ height: `${(point.billable_hours / maxValue) * 100}%`, minHeight: point.billable_hours ? 4 : 0 }}
                />
                <div
                  className="w-3 rounded-t bg-muted-foreground/25"
                  style={{ height: `${(point.non_billable_hours / maxValue) * 100}%`, minHeight: point.non_billable_hours ? 4 : 0 }}
                />
              </div>
              <Typography variant="small" className="max-w-[72px] truncate text-[10px] text-muted-foreground">
                {point.label.replace("This Week", "Now")}
              </Typography>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary/80" />
          Billable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
          Non-billable
        </span>
      </div>
      {activeIndex !== null && data[activeIndex] ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-4">
          <MetricPill label="Logged" value={`${formatNumber(data[activeIndex].logged_hours)}h`} />
          <MetricPill label="Billable" value={`${formatNumber(data[activeIndex].billable_hours)}h`} />
          <MetricPill label="Non-billable" value={`${formatNumber(data[activeIndex].non_billable_hours)}h`} />
          <MetricPill label="Billable %" value={`${data[activeIndex].billable_ratio}%`} />
        </div>
      ) : null}
    </div>
  );
};

const UtilizationPctChart = ({
  data,
  onSelect,
  activeIndex,
}: {
  data: Array<{ department: string; utilization_pct: number; demand_hours: number; capacity_hours: number }>;
  activeIndex: number | null;
  onSelect: (index: number | null) => void;
}) => {
  const max = Math.max(...data.map((row) => row.utilization_pct), 100);
  return (
    <div className="space-y-2">
      {data.map((row, index) => (
        <button
          key={row.department}
          type="button"
          className={mergeClassNames("w-full rounded-md p-1 text-left transition", activeIndex === index && "bg-muted/50")}
          onClick={() => onSelect(activeIndex === index ? null : index)}
        >
          <div className="mb-1 flex justify-between text-sm">
            <span className="truncate font-medium">{row.department}</span>
            <span className={mergeClassNames(row.utilization_pct > 100 ? "text-destructive" : "text-muted-foreground")}>
              {row.utilization_pct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary">
            <div
              className={mergeClassNames(
                "h-2 rounded-full",
                row.utilization_pct > 100 ? "bg-destructive" : row.utilization_pct >= 70 ? "bg-emerald-500" : "bg-amber-500"
              )}
              style={{ width: `${Math.min((row.utilization_pct / max) * 100, 100)}%` }}
            />
          </div>
          {activeIndex === index ? (
            <Typography variant="small" className="mt-1 text-muted-foreground">
              {formatNumber(row.demand_hours)}h demand · {formatNumber(row.capacity_hours)}h capacity
            </Typography>
          ) : null}
        </button>
      ))}
    </div>
  );
};

const MetricPill = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Typography variant="small" className="text-muted-foreground">
      {label}
    </Typography>
    <div className="font-medium">{value}</div>
  </div>
);

const StackedStatusBar = ({ rows, total }: { rows: TaskStatusRow[]; total: number }) => (
  <div className="space-y-3">
    <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
      {rows.map((row, index) => (
        <div
          key={row.status}
          className={TASK_COLORS[index % TASK_COLORS.length]}
          style={{ width: `${total ? (row.count / total) * 100 : 0}%` }}
          title={`${row.status}: ${row.count}`}
        />
      ))}
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map((row, index) => (
        <div key={row.status} className="flex items-center justify-between rounded-md border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={mergeClassNames("h-2.5 w-2.5 shrink-0 rounded-full", TASK_COLORS[index % TASK_COLORS.length])} />
            <Typography variant="small" className="truncate">
              {row.status}
            </Typography>
          </div>
          <span className="text-sm font-medium">{row.count}</span>
        </div>
      ))}
    </div>
  </div>
);

const HorizontalValueBars = ({
  items,
  valueKey,
  labelKey,
  suffix = "",
  onClick,
}: {
  items: Array<Record<string, string | number>>;
  valueKey: string;
  labelKey: string;
  suffix?: string;
  onClick?: (item: Record<string, string | number>) => void;
}) => {
  const max = Math.max(...items.map((item) => Math.abs(Number(item[valueKey] || 0))), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const value = Number(item[valueKey] || 0);
        return (
          <button
            key={String(item[labelKey])}
            type="button"
            className={mergeClassNames("w-full text-left", onClick && "rounded-md transition hover:bg-muted/40")}
            onClick={() => onClick?.(item)}
            disabled={!onClick}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium">{item[labelKey]}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatNumber(value)}
                {suffix}
              </span>
            </div>
            <div className="h-2 rounded-full bg-secondary">
              <div
                className={mergeClassNames("h-2 rounded-full", value >= 0 ? "bg-primary" : "bg-destructive")}
                style={{ width: `${(Math.abs(value) / max) * 100}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
};

const ShortcutGrid = ({ shortcuts, onNavigate }: { shortcuts: ModuleShortcut[]; onNavigate: (route: string) => void }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {shortcuts.map((shortcut) => (
      <button
        key={shortcut.key}
        type="button"
        onClick={() => onNavigate(shortcut.route)}
        className="rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{shortcut.label}</div>
            <Typography variant="small" className="mt-1 text-muted-foreground">
              {shortcut.description}
            </Typography>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </button>
    ))}
  </div>
);

export const DashboardPanels = ({ panels }: { panels?: DashboardPanels }) => {
  const navigate = useNavigate();
  const [trendIndex, setTrendIndex] = useState<number | null>(null);
  const [forecastIndex, setForecastIndex] = useState<number | null>(null);
  const [timesheetTrendIndex, setTimesheetTrendIndex] = useState<number | null>(null);
  const [deptIndex, setDeptIndex] = useState<number | null>(null);

  const go = (route: string) => navigate(`${BASE_ROUTE}${route}`);

  const ragSegments = useMemo(() => {
    if (!panels?.client_health) return [];
    const health = panels.client_health;
    return [
      { label: "Green", value: health.green, color: RAG_COLORS.Green },
      { label: "Amber", value: health.amber, color: RAG_COLORS.Amber },
      { label: "Red", value: health.red, color: RAG_COLORS.Red },
      { label: "Unrated", value: health.unrated, color: RAG_COLORS.Unrated },
    ].filter((segment) => segment.value > 0);
  }, [panels?.client_health]);

  const arSeries = useMemo(() => {
    if (!panels?.ar_aging) return [];
    return Object.entries(panels.ar_aging.values).map(([key, value], index) => ({
      key,
      label: panels.ar_aging?.labels[key] || key,
      value,
      color: AR_COLORS[index % AR_COLORS.length],
    }));
  }, [panels?.ar_aging]);

  if (!panels) return null;

  return (
    <div className="space-y-4">
      {panels.extra_kpis?.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-10">
          {panels.extra_kpis.map((kpi) => (
            <button
              key={kpi.key}
              type="button"
              onClick={() => kpi.route && go(kpi.route)}
              className={mergeClassNames(
                "rounded-xl border bg-card p-3 text-left transition hover:shadow-sm",
                kpi.status === "critical" && "border-destructive/40 bg-destructive/5",
                kpi.status === "warning" && "border-amber-500/40 bg-amber-500/5",
                kpi.status === "healthy" && "border-emerald-500/30 bg-emerald-500/5"
              )}
            >
              <Typography variant="small" className="text-muted-foreground">
                {kpi.label}
              </Typography>
              <div className="mt-1 text-lg font-semibold">{kpi.value}</div>
            </button>
          ))}
        </div>
      ) : null}

      {panels.shortcuts?.length ? (
        <PanelCard title="Module Overview" icon={Briefcase}>
          <ShortcutGrid shortcuts={panels.shortcuts} onNavigate={go} />
        </PanelCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.utilization_trend?.length ? (
          <PanelCard
            title="Utilization Trend"
            icon={TrendingUp}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`${RESOURCE_MANAGEMENT}/capacity`)}>
                Open capacity
              </button>
            }
          >
            <DualBarChart data={panels.utilization_trend} activeIndex={trendIndex} onSelect={setTrendIndex} />
          </PanelCard>
        ) : null}

        {panels.capacity_forecast?.length ? (
          <PanelCard
            title="Capacity Forecast"
            icon={BarChart3}
            action={
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => go(`${RESOURCE_MANAGEMENT}/time-allocation`)}
              >
                Manage allocations
              </button>
            }
          >
            <DualBarChart data={panels.capacity_forecast} activeIndex={forecastIndex} onSelect={setForecastIndex} />
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.timesheet_trend?.length ? (
          <PanelCard
            title="Timesheet Hours Trend"
            icon={Clock3}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`/${TIMESHEET}`)}>
                Timesheet
              </button>
            }
          >
            <TimesheetTrendChart data={panels.timesheet_trend} activeIndex={timesheetTrendIndex} onSelect={setTimesheetTrendIndex} />
          </PanelCard>
        ) : null}

        {panels.department_utilization?.length ? (
          <PanelCard
            title="Utilization by Department"
            icon={Users}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`${RESOURCE_MANAGEMENT}/capacity`)}>
                Capacity view
              </button>
            }
          >
            <UtilizationPctChart data={panels.department_utilization} activeIndex={deptIndex} onSelect={setDeptIndex} />
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {panels.timesheet_week ? (
          <PanelCard
            title="Timesheet This Week"
            icon={Clock3}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`/${TIMESHEET}`)}>
                Open timesheet
              </button>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricPill label="Logged" value={`${formatNumber(panels.timesheet_week.logged_hours)}h`} />
                <MetricPill label="Billable" value={`${formatNumber(panels.timesheet_week.billable_hours)}h`} />
                <MetricPill label="Employees" value={String(panels.timesheet_week.active_employees)} />
                <MetricPill label="Active tasks" value={String(panels.timesheet_week.active_tasks)} />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                  <span>Logged vs allocated</span>
                  <span>
                    {formatNumber(panels.timesheet_week.logged_hours)} / {formatNumber(panels.timesheet_week.allocated_hours)}h
                  </span>
                </div>
                <Progress
                  value={
                    panels.timesheet_week.allocated_hours
                      ? Math.min((panels.timesheet_week.logged_hours / panels.timesheet_week.allocated_hours) * 100, 100)
                      : 0
                  }
                  className="h-2"
                />
              </div>
            </div>
          </PanelCard>
        ) : null}

        {panels.tasks_overview ? (
          <PanelCard
            title="Task Portfolio"
            icon={ListChecks}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`/${TASK}`)}>
                View tasks
              </button>
            }
          >
            <div className="mb-4 grid grid-cols-2 gap-3">
              <MetricPill label="Total tasks" value={String(panels.tasks_overview.total)} />
              <MetricPill label="Overdue" value={String(panels.tasks_overview.overdue)} />
            </div>
            <StackedStatusBar rows={panels.tasks_overview.by_status} total={panels.tasks_overview.total} />
          </PanelCard>
        ) : null}

        {panels.client_health ? (
          <PanelCard
            title="Client Health (RAG)"
            icon={HeartPulse}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(PROJECT)}>
                View projects
              </button>
            }
          >
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <Typography variant="small" className="text-muted-foreground">
                    Portfolio score
                  </Typography>
                  <div className="text-3xl font-semibold">{panels.client_health.health_score}%</div>
                </div>
                <Typography variant="small" className="text-muted-foreground">
                  {panels.client_health.total_projects} open projects
                </Typography>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
                {ragSegments.map((segment) => (
                  <div
                    key={segment.label}
                    className={segment.color}
                    style={{
                      width: `${panels.client_health!.total_projects ? (segment.value / panels.client_health!.total_projects) * 100 : 0}%`,
                    }}
                    title={`${segment.label}: ${segment.value}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ragSegments.map((segment) => (
                  <div key={segment.label} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={mergeClassNames("h-2.5 w-2.5 rounded-full", segment.color)} />
                      {segment.label}
                    </span>
                    <span className="font-medium">{segment.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {panels.approval_summary && panels.approval_summary.pending_entries > 0 ? (
          <PanelCard
            title="Approval Queue"
            icon={CheckCircle2}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`${TEAM}/approvals`)}>
                Review all
              </button>
            }
          >
            <div className="space-y-3">
              <div className="text-3xl font-semibold">{panels.approval_summary.pending_entries}</div>
              <Typography variant="small" className="text-muted-foreground">
                entries across {panels.approval_summary.pending_sheets} timesheet(s) need approval
              </Typography>
              <Progress value={Math.min(panels.approval_summary.pending_entries * 5, 100)} className="h-2" />
            </div>
          </PanelCard>
        ) : null}

        {panels.allocation_summary ? (
          <PanelCard
            title="Resource Allocations"
            icon={Layers}
            action={
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => go(`${RESOURCE_MANAGEMENT}/time-allocation`)}
              >
                Manage
              </button>
            }
          >
            <div className="mb-3 grid grid-cols-3 gap-2">
              <MetricPill label="Confirmed" value={String(panels.allocation_summary.confirmed)} />
              <MetricPill label="Tentative" value={String(panels.allocation_summary.tentative)} />
              <MetricPill label="Total live" value={String(panels.allocation_summary.total)} />
            </div>
            <StackedStatusBar rows={panels.allocation_summary.by_status} total={panels.allocation_summary.total || 1} />
          </PanelCard>
        ) : null}

        {panels.project_status ? (
          <PanelCard
            title="Project Portfolio"
            icon={Briefcase}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(PROJECT)}>
                All projects
              </button>
            }
          >
            <div className="mb-3 grid grid-cols-2 gap-3">
              <MetricPill label="Open" value={String(panels.project_status.open)} />
              <MetricPill label="Total" value={String(panels.project_status.total)} />
            </div>
            <StackedStatusBar rows={panels.project_status.by_status} total={panels.project_status.total || 1} />
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.margin_waterfall ? (
          <PanelCard title="Revenue vs Cost (MTD)" icon={DollarSign}>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <MetricPill
                  label="Revenue"
                  value={formatCurrency(panels.margin_waterfall.recognized_revenue, panels.margin_waterfall.currency)}
                />
                <MetricPill
                  label="Cost"
                  value={formatCurrency(panels.margin_waterfall.incurred_cost, panels.margin_waterfall.currency)}
                />
                <MetricPill label="Margin" value={`${panels.margin_waterfall.actual_margin_pct}%`} />
              </div>
              <div className="space-y-2">
                {[
                  { label: "Revenue", value: panels.margin_waterfall.recognized_revenue, color: "bg-emerald-500" },
                  { label: "Cost", value: panels.margin_waterfall.incurred_cost, color: "bg-amber-500" },
                  { label: "Margin", value: Math.max(panels.margin_waterfall.actual_margin, 0), color: "bg-primary" },
                ].map((bar) => {
                  const max = Math.max(panels.margin_waterfall!.recognized_revenue, 1);
                  return (
                    <div key={bar.label}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{bar.label}</span>
                        <span>{formatCurrency(bar.value, panels.margin_waterfall?.currency)}</span>
                      </div>
                      <div className="h-3 rounded-full bg-secondary">
                        <div className={mergeClassNames("h-3 rounded-full", bar.color)} style={{ width: `${(bar.value / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <Typography variant="small" className="text-muted-foreground">
                Planned margin {panels.margin_waterfall.planned_margin_pct}% · {panels.margin_waterfall.period_start} to{" "}
                {panels.margin_waterfall.period_end}
              </Typography>
            </div>
          </PanelCard>
        ) : null}

        {panels.margin_by_project_type?.length ? (
          <PanelCard title="Margin by Project Type" icon={BarChart3}>
            <HorizontalValueBars
              items={panels.margin_by_project_type.map((row) => ({ label: row.label, value: row.actual_margin }))}
              labelKey="label"
              valueKey="value"
              onClick={() => go(`${PROJECT}/margins`)}
            />
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.margin_by_customer?.length ? (
          <PanelCard
            title="Margin by Customer (MTD)"
            icon={DollarSign}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`${PROJECT}/margins`)}>
                Full margin view
              </button>
            }
          >
            <HorizontalValueBars
              items={panels.margin_by_customer.map((row) => ({
                label: row.label,
                value: row.actual_margin,
                meta: `${row.actual_margin_pct}% · ${row.project_count} projects`,
              }))}
              labelKey="label"
              valueKey="value"
              onClick={() => go(`${PROJECT}/margins`)}
            />
          </PanelCard>
        ) : null}

        {panels.ar_aging ? (
          <PanelCard
            title="Receivables Aging"
            icon={DollarSign}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`${PROJECT}/invoicing`)}>
                Open invoicing
              </button>
            }
          >
            <div className="space-y-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
                {arSeries.map((bucket) => {
                  const total = arSeries.reduce((sum, item) => sum + item.value, 0) || 1;
                  return (
                    <div
                      key={bucket.key}
                      className={bucket.color}
                      style={{ width: `${(bucket.value / total) * 100}%` }}
                      title={`${bucket.label}: ${formatCurrency(bucket.value, panels.ar_aging?.currency)}`}
                    />
                  );
                })}
              </div>
              <div className="space-y-2">
                {arSeries.map((bucket) => (
                  <div key={bucket.key} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={mergeClassNames("h-2.5 w-2.5 rounded-full", bucket.color)} />
                      {bucket.label}
                    </span>
                    <span className="font-medium">{formatCurrency(bucket.value, panels.ar_aging?.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.top_projects_by_hours?.length ? (
          <PanelCard title="Top Projects by Hours (MTD)" icon={BarChart3}>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1.2fr_auto_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>Project</span>
                <span>Total</span>
                <span>Billable</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {panels.top_projects_by_hours.map((project) => (
                  <button
                    key={project.project}
                    type="button"
                    className="grid w-full grid-cols-[1.2fr_auto_auto] gap-3 border-b px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-muted/30"
                    onClick={() => go(`${PROJECT}/${project.project}`)}
                  >
                    <span className="truncate">
                      <span className="font-medium">{project.project_name}</span>
                      {project.customer ? (
                        <Typography variant="small" className="block truncate text-muted-foreground">
                          {project.customer}
                        </Typography>
                      ) : null}
                    </span>
                    <span>{formatNumber(project.total_hours)}h</span>
                    <span className="text-muted-foreground">{formatNumber(project.billable_hours)}h</span>
                  </button>
                ))}
              </div>
            </div>
          </PanelCard>
        ) : null}

        {panels.overdue_tasks?.length ? (
          <PanelCard
            title="Overdue Tasks"
            icon={AlertTriangle}
            action={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => go(`/${TASK}`)}>
                All tasks
              </button>
            }
          >
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1.2fr_auto_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>Task</span>
                <span>Status</span>
                <span>Due</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {panels.overdue_tasks.map((task) => (
                  <button
                    key={task.task}
                    type="button"
                    className="grid w-full grid-cols-[1.2fr_auto_auto] gap-3 border-b px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-muted/30"
                    onClick={() => go(`/${TASK}?search=${encodeURIComponent(task.task)}`)}
                  >
                    <span className="truncate font-medium">{task.subject}</span>
                    <Badge variant="secondary">{task.status}</Badge>
                    <span className="text-destructive">{task.exp_end_date || "-"}</span>
                  </button>
                ))}
              </div>
            </div>
          </PanelCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.at_risk_projects?.length ? (
          <PanelCard title="At-Risk Projects" icon={AlertTriangle}>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1.2fr_auto_auto_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>Project</span>
                <span>RAG</span>
                <span>Complete</span>
                <span>Due</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {panels.at_risk_projects.map((project) => (
                  <button
                    key={project.project}
                    type="button"
                    className="grid w-full grid-cols-[1.2fr_auto_auto_auto] gap-3 border-b px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-muted/30"
                    onClick={() => go(`${PROJECT}/${project.project}`)}
                  >
                    <span className="truncate">
                      <span className="font-medium">{project.project_name}</span>
                      {project.customer ? (
                        <Typography variant="small" className="block truncate text-muted-foreground">
                          {project.customer}
                        </Typography>
                      ) : null}
                    </span>
                    <Badge variant={ragBadgeVariant(project.rag_status)}>{project.rag_status}</Badge>
                    <span>{project.percent_complete}%</span>
                    <span className="text-muted-foreground">{project.expected_end_date || "-"}</span>
                  </button>
                ))}
              </div>
            </div>
          </PanelCard>
        ) : null}

        {panels.budget_alerts?.length ? (
          <PanelCard title="Budget Burn Alerts" icon={AlertTriangle}>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1.2fr_auto_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>Project</span>
                <span>Burn</span>
                <span>Used</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {panels.budget_alerts.map((alert) => (
                  <button
                    key={alert.project}
                    type="button"
                    className="grid w-full grid-cols-[1.2fr_auto_auto] gap-3 border-b px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-muted/30"
                    onClick={() => go(`${PROJECT}/${alert.project}`)}
                  >
                    <span className="truncate">
                      <span className="font-medium">{alert.project_name}</span>
                      {alert.customer ? (
                        <Typography variant="small" className="block truncate text-muted-foreground">
                          {alert.customer}
                        </Typography>
                      ) : null}
                    </span>
                    <span>{formatCurrency(alert.burn_amount, alert.currency)}</span>
                    <Badge variant={alert.utilization_pct >= 100 ? "destructive" : "secondary"}>
                      {alert.utilization_pct}%
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </PanelCard>
        ) : null}
      </div>

      {panels.recent_activity?.length ? (
        <PanelCard title="Recent Activity" icon={History}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {panels.recent_activity.map((item, index) => (
              <div key={`${item.type}-${item.reference}-${index}`} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Typography variant="p" className="truncate font-medium">
                      {item.title}
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      {item.type}
                      {item.user ? ` · ${item.user}` : ""}
                      {item.project ? ` · ${item.project}` : ""}
                    </Typography>
                  </div>
                  {item.status ? <Badge variant="secondary">{item.status}</Badge> : null}
                </div>
                {item.when ? (
                  <Typography variant="small" className="mt-2 text-muted-foreground">
                    {item.when}
                  </Typography>
                ) : null}
              </div>
            ))}
          </div>
        </PanelCard>
      ) : null}

      {!panels.utilization_trend &&
      !panels.tasks_overview &&
      !panels.client_health &&
      !panels.margin_by_customer &&
      !panels.shortcuts?.length ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Typography variant="small" className="text-muted-foreground">
              Detailed panels will appear once dashboard tiles are enabled for your role.
            </Typography>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export type { DashboardPanels as DashboardPanelsData };
