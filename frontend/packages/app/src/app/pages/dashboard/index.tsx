/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
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
  panels?: DashboardPanelsData;
  available_tiles: Array<{ key: string; label: string; description?: string; enabled_by_role?: boolean }>;
  layout?: { tiles?: string[] };
  refreshed_at?: string;
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
};

const statusClass = (status?: string) => {
  if (status === "healthy") return "border-emerald-500/40 bg-emerald-500/5";
  if (status === "warning") return "border-amber-500/40 bg-amber-500/5";
  if (status === "critical") return "border-destructive/40 bg-destructive/5";
  return "border-border bg-card";
};

const ExecutiveDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedTiles, setSelectedTiles] = useState<string[]>([]);

  const { data, isLoading, mutate, isValidating } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.get_dashboard",
    undefined,
    undefined,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: 30000,
      dedupingInterval: 0,
    }
  );

  const { call: saveLayout, loading: saving } = useFrappePostCall(
    "next_pms.next_pms.api.executive_dashboard.save_layout"
  );

  const response = data?.message as DashboardResponse | undefined;
  const tiles = response?.tiles ?? [];
  const panels = response?.panels;

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
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const subtitle = useMemo(() => {
    if (!response?.refreshed_at) return "Live metrics — refreshes on focus and every 30 seconds.";
    return `Live as of ${response.refreshed_at} — auto-refresh every 30s`;
  }, [response?.refreshed_at]);

  return (
    <div className="flex min-h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Typography variant="h3" className="flex items-center gap-2 text-lg font-semibold">
              <LayoutDashboard className="h-5 w-5" />
              Executive Dashboard
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              {subtitle}
            </Typography>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isValidating}>
              <RefreshCw className={mergeClassNames("mr-1 h-4 w-4", isValidating && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={openCustomize}>
              <Settings2 className="mr-1 h-4 w-4" />
              Customize
            </Button>
          </div>
        </div>
      </RootHeader>

      <div className="flex-1 space-y-4 p-3 sm:p-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {tiles.map((tile) => {
              const Icon = TILE_ICONS[tile.key] || LayoutDashboard;
              return (
                <button
                  key={tile.key}
                  type="button"
                  className={mergeClassNames(
                    "rounded-xl border p-3 text-left transition hover:shadow-md sm:p-4",
                    statusClass(tile.status)
                  )}
                  onClick={() => tile.route && navigate(`${BASE_ROUTE}${tile.route}`)}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="rounded-md bg-background/80 p-2">
                      <Icon className="h-4 w-4" />
                    </div>
                    {tile.status ? (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {tile.status}
                      </Badge>
                    ) : null}
                  </div>
                  <Typography variant="small" className="text-muted-foreground">
                    {tile.label}
                  </Typography>
                  <Typography variant="p" className="mt-1 text-xl font-semibold sm:text-2xl">
                    {tile.display_value ?? tile.value ?? "-"}
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
                </button>
              );
            })}
          </div>
        )}

        {!isLoading && !tiles.length ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Typography variant="small" className="text-muted-foreground">
                No dashboard tiles are enabled for your role. Use Customize to pick available tiles.
              </Typography>
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && tiles.length ? <DashboardPanels panels={panels} /> : null}
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
