/**
 * External dependencies.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  HeartPulse,
  LayoutDashboard,
  LineChart,
  PieChart,
  RefreshCw,
  Settings2,
  UserCheck,
  Users,
} from "lucide-react";

/**
 * Internal dependencies.
 */
import { DashboardPanels } from "@/app/pages/dashboard/dashboardPanels";
import type { DashboardPanelsData } from "@/app/pages/dashboard/dashboardPanels";
import { PersonalDashboardPanels } from "@/app/pages/dashboard/personalPanels";
import type { PersonalPanels } from "@/app/pages/dashboard/personalPanels";
import { Header as RootHeader } from "@/app/layout/root";
import { BASE_ROUTE } from "@/lib/constant";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type DashboardTile = {
  key: string;
  label: string;
  description?: string;
  route?: string;
  display_value?: string | number;
  value?: number;
  unit?: string;
  status?: "healthy" | "warning" | "critical" | "neutral";
  details?: Record<string, string | number>;
};

type DashboardResponse = {
  tiles: DashboardTile[];
  panels?: DashboardPanelsData | PersonalPanels;
  available_tiles: Array<{ key: string; label: string; description?: string; enabled_by_role?: boolean }>;
  layout?: { tiles?: string[] };
  refreshed_at?: string;
  persona?: { persona?: string; title?: string; can_view_executive?: boolean; can_view_reports?: boolean };
  mode?: string;
};

const TILE_ICONS: Record<string, typeof Activity> = {
  utilization: Activity,
  bench: Users,
  pipeline: Briefcase,
  margin: LineChart,
  ar: DollarSign,
  client_health: HeartPulse,
  approvals: ClipboardList,
  revenue: DollarSign,
  billable_ratio: PieChart,
  overdue_tasks: AlertTriangle,
  team_active: UserCheck,
  active_allocations: CheckCircle2,
  my_hours: Activity,
  my_billable: PieChart,
  my_utilization: LineChart,
  my_today: Clock,
  my_month_hours: Activity,
  my_remaining: AlertTriangle,
  my_avg_daily: LineChart,
  my_entries: ClipboardList,
  my_drafts: Briefcase,
  my_pending: ClipboardList,
  my_tasks: CheckCircle2,
  my_overdue: AlertTriangle,
};

const ACCENT: Record<string, string> = {
  utilization: "bg-sky-500",
  bench: "bg-violet-500",
  pipeline: "bg-indigo-500",
  margin: "bg-emerald-500",
  ar: "bg-amber-500",
  client_health: "bg-rose-500",
  approvals: "bg-orange-500",
  revenue: "bg-emerald-600",
  billable_ratio: "bg-teal-500",
  overdue_tasks: "bg-red-500",
  team_active: "bg-blue-500",
  active_allocations: "bg-cyan-500",
  my_hours: "bg-sky-500",
  my_billable: "bg-teal-500",
  my_utilization: "bg-indigo-500",
  my_today: "bg-cyan-500",
  my_month_hours: "bg-blue-500",
  my_remaining: "bg-amber-500",
  my_avg_daily: "bg-violet-500",
  my_entries: "bg-sky-600",
  my_drafts: "bg-amber-500",
  my_pending: "bg-orange-500",
  my_tasks: "bg-blue-500",
  my_overdue: "bg-red-500",
};

const statusBadge = (status?: string) => {
  if (status === "healthy") return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
  if (status === "warning") return "border-amber-500/40 text-amber-700 dark:text-amber-300";
  if (status === "critical") return "border-destructive/40 text-destructive";
  return "border-border text-muted-foreground";
};

const ExecutiveDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedTiles, setSelectedTiles] = useState<string[]>([]);
  const [loadPanels, setLoadPanels] = useState(false);

  // Fast path: tiles only
  const {
    data: summaryData,
    isLoading: summaryLoading,
    mutate: mutateSummary,
    isValidating: summaryValidating,
    error: summaryError,
  } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.get_dashboard",
    { include_panels: 0 },
    "dashboard-summary",
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 60000,
      dedupingInterval: 15000,
    }
  );

  const summaryPreview = summaryData?.message as DashboardResponse | undefined;
  const isPersonalPreview =
    summaryPreview?.mode === "personal" || summaryPreview?.persona?.can_view_executive === false;

  // After tiles paint, load lean executive panels (skip for Timesheet User personal mode)
  useEffect(() => {
    if (summaryData?.message && !loadPanels && !isPersonalPreview) {
      const timer = window.setTimeout(() => setLoadPanels(true), 50);
      return () => window.clearTimeout(timer);
    }
  }, [loadPanels, summaryData, isPersonalPreview]);

  const {
    data: panelsData,
    isLoading: panelsLoading,
    mutate: mutatePanels,
    isValidating: panelsValidating,
  } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.get_dashboard_panels",
    undefined,
    loadPanels && !isPersonalPreview ? "dashboard-panels" : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 90000,
      dedupingInterval: 20000,
    }
  );

  const { call: saveLayout, loading: saving } = useFrappePostCall(
    "next_pms.next_pms.api.executive_dashboard.save_layout"
  );

  const summary = summaryData?.message as DashboardResponse | undefined;
  const panelsPayload = panelsData?.message as { panels?: DashboardPanelsData; refreshed_at?: string } | undefined;
  const response = summary;
  const tiles = summary?.tiles ?? [];
  const isPersonal = response?.mode === "personal" || response?.persona?.can_view_executive === false;
  const panels = panelsPayload?.panels;
  const personalPanels = isPersonal ? (summary?.panels as PersonalPanels | undefined) : undefined;
  const dashboardTitle = response?.persona?.title || (isPersonal ? "My Timesheet Dashboard" : "Executive Dashboard");
  const personaLabel = response?.persona?.persona;
  const isValidating = summaryValidating || (!isPersonal && panelsValidating);

  const refresh = () => {
    mutateSummary();
    if (loadPanels) mutatePanels();
  };

  const openCustomize = () => {
    setSelectedTiles(response?.layout?.tiles || tiles.map((tile) => tile.key));
    setCustomizeOpen(true);
  };

  const toggleTile = (key: string) => {
    setSelectedTiles((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const handleSaveLayout = () => {
    saveLayout({ tiles: JSON.stringify(selectedTiles) })
      .then(() => {
        toast({ variant: "success", description: "Dashboard layout saved." });
        setCustomizeOpen(false);
        refresh();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const subtitle = useMemo(() => {
    if (summaryError) return "Could not refresh — try again.";
    if (!response?.refreshed_at) return "Live metrics for your role.";
    return `Updated ${response.refreshed_at}`;
  }, [response?.refreshed_at, summaryError]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20">
      <RootHeader className="shrink-0 border-b bg-background px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Typography variant="h3" className="flex items-center gap-2 text-lg font-semibold">
              <LayoutDashboard className="h-5 w-5 text-primary" />
              {dashboardTitle}
              {personaLabel ? (
                <Badge variant="outline" className="text-[10px] font-normal uppercase">
                  {personaLabel}
                </Badge>
              ) : null}
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              {subtitle}
            </Typography>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={isValidating}>
              <RefreshCw className={mergeClassNames("mr-1 h-4 w-4", isValidating && "animate-spin")} />
              Refresh
            </Button>
            {!isPersonal ? (
              <Button size="sm" variant="outline" onClick={openCustomize}>
                <Settings2 className="mr-1 h-4 w-4" />
                Customize
              </Button>
            ) : null}
          </div>
        </div>
      </RootHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] space-y-5 p-3 sm:p-5">
          {summaryError ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <Typography variant="small" className="text-destructive">
                  {parseFrappeErrorMsg(summaryError) || "Failed to load dashboard."}
                </Typography>
                <Button size="sm" variant="outline" onClick={refresh}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <Typography variant="p" className="text-sm font-semibold tracking-wide text-muted-foreground">
                Key metrics
              </Typography>
            </div>

            {summaryLoading ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: isPersonalPreview ? 12 : 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-28 w-full rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {tiles.map((tile) => {
                  const Icon = TILE_ICONS[tile.key] || LayoutDashboard;
                  const accent = ACCENT[tile.key] || "bg-primary";
                  return (
                    <button
                      key={tile.key}
                      type="button"
                      className="group relative overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      onClick={() => tile.route && navigate(`${BASE_ROUTE}${tile.route}`)}
                    >
                      <div className="p-3 sm:p-4">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="rounded-lg bg-muted p-2 text-foreground">
                            <Icon className="h-4 w-4" />
                          </div>
                          {tile.status ? (
                            <Badge variant="outline" className={mergeClassNames("text-[10px] uppercase", statusBadge(tile.status))}>
                              {tile.status}
                            </Badge>
                          ) : null}
                        </div>
                        <Typography variant="small" className="text-muted-foreground">
                          {tile.label}
                        </Typography>
                        <Typography variant="p" className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
                          {tile.display_value ?? tile.value ?? "—"}
                        </Typography>
                        <Typography variant="small" className="mt-2 line-clamp-2 text-muted-foreground">
                          {tile.description}
                        </Typography>
                        {tile.key === "client_health" && tile.details ? (
                          <Typography variant="small" className="mt-2 text-muted-foreground">
                            {tile.details.green}G · {tile.details.amber}A · {tile.details.red}R
                          </Typography>
                        ) : null}
                        {tile.key === "pipeline" && tile.details ? (
                          <Typography variant="small" className="mt-2 text-muted-foreground">
                            {tile.details.upcoming_demand_hours}h demand · {tile.details.open_projects} projects
                          </Typography>
                        ) : null}
                        {tile.key === "approvals" && tile.details ? (
                          <Typography variant="small" className="mt-2 text-muted-foreground">
                            {tile.details.pending_sheets} sheets pending
                          </Typography>
                        ) : null}
                        {tile.key === "billable_ratio" && tile.details ? (
                          <Typography variant="small" className="mt-2 text-muted-foreground">
                            {tile.details.billable_hours}h billable / {tile.details.logged_hours}h logged
                          </Typography>
                        ) : null}
                        {tile.key === "active_allocations" && tile.details ? (
                          <Typography variant="small" className="mt-2 text-muted-foreground">
                            {tile.details.tentative} tentative
                          </Typography>
                        ) : null}
                      </div>
                      <div className={mergeClassNames("h-1 w-full", accent)} />
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {!summaryLoading && !tiles.length ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Typography variant="small" className="text-muted-foreground">
                  No dashboard tiles are enabled for your role. Use Customize to pick available tiles.
                </Typography>
              </CardContent>
            </Card>
          ) : null}

          {isPersonal && tiles.length ? (
            <section className="space-y-3">
              <Typography variant="p" className="text-sm font-semibold tracking-wide text-muted-foreground">
                My insights
              </Typography>
              {personalPanels ? (
                <PersonalDashboardPanels panels={personalPanels} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-48 w-full rounded-xl" />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {!isPersonal && tiles.length ? (
            <section className="space-y-3">
              <Typography variant="p" className="text-sm font-semibold tracking-wide text-muted-foreground">
                Insights
              </Typography>
              {panelsLoading || !panels ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-48 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <DashboardPanels panels={panels} />
              )}
            </section>
          ) : null}
        </div>
      </div>

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Customize Dashboard</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {(response?.available_tiles || []).map((tile) => (
              <label
                key={tile.key}
                className={mergeClassNames(
                  "flex items-start gap-3 rounded-md border p-3",
                  !tile.enabled_by_role && "opacity-50"
                )}
              >
                <Checkbox
                  checked={selectedTiles.includes(tile.key)}
                  disabled={!tile.enabled_by_role}
                  onCheckedChange={() => tile.enabled_by_role && toggleTile(tile.key)}
                />
                <div>
                  <div className="font-medium">{tile.label}</div>
                  <Typography variant="small" className="text-muted-foreground">
                    {tile.description}
                  </Typography>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={handleSaveLayout} disabled={saving || !selectedTiles.length}>
              Save Layout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ExecutiveDashboard;
