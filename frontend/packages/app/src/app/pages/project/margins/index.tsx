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
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";

/**
 * Internal dependencies.
 */
import { AnalyticsDrilldownSheet } from "@/app/components/analytics/AnalyticsDrilldownSheet";
import type { AnalyticsDrilldownResponse } from "@/app/components/analytics/analyticsDrilldown";
import { Header as RootHeader } from "@/app/layout/root";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type PortfolioRow = {
  key: string;
  label: string;
  group_by: string;
  project_count: number;
  planned_revenue: number;
  planned_cost: number;
  planned_margin: number;
  planned_margin_pct: number;
  recognized_revenue: number;
  incurred_cost: number;
  actual_margin: number;
  actual_margin_pct: number;
  margin_variance: number;
  margin_variance_pct: number;
  labor_cost?: number;
  purchase_cost?: number;
  expense_cost?: number;
  projects?: Array<{
    project: string;
    project_name: string;
    actual_margin: number;
    actual_margin_pct: number;
    margin_variance: number;
  }>;
};

type PortfolioResponse = {
  from_date: string;
  to_date: string;
  group_by: string;
  currency: string;
  summary: PortfolioRow;
  rows: PortfolioRow[];
};

type MarginDriver = {
  driver: string;
  driver_type: string;
  driver_key: string;
  amount: number;
  impact: "positive" | "negative";
};

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const todayStr = today.toISOString().slice(0, 10);

const marginClass = (value: number) => {
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
};

const PortfolioMargins = () => {
  const { toast } = useToast();
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(todayStr);
  const [groupBy, setGroupBy] = useState("customer");
  const [customer, setCustomer] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<MarginDriver | null>(null);
  const [portfolioGroup, setPortfolioGroup] = useState<PortfolioRow | null>(null);
  const [drilldown, setDrilldown] = useState<AnalyticsDrilldownResponse | null>(null);

  const apiArgs = useMemo(
    () => ({
      from_date: fromDate,
      to_date: toDate,
      group_by: groupBy,
      customer: customer || undefined,
    }),
    [fromDate, toDate, groupBy, customer]
  );

  const { data, isLoading, mutate } = useFrappeGetCall(
    fromDate && toDate ? "next_pms.next_pms.api.margin_analytics.get_portfolio_view" : null,
    apiArgs
  );

  const { data: customers } = useFrappeGetDocList("Customer", {
    fields: ["name", "customer_name"],
    limit: 500,
    orderBy: { field: "customer_name", order: "asc" },
  });

  const { call: loadDrilldown, loading: drilldownLoading } = useFrappePostCall(
    "next_pms.next_pms.api.margin_analytics.get_drilldown"
  );

  const response = data?.message as PortfolioResponse | undefined;
  const summary = response?.summary;
  const rows = response?.rows ?? [];

  const portfolioFilterArgs = (row?: PortfolioRow | null) => ({
    ...apiArgs,
    portfolio_group_key: row?.key,
    portfolio_group_label: row?.label,
  });

  const openProjectDrilldown = (
    project: string,
    driver?: MarginDriver,
    row?: PortfolioRow | null
  ) => {
    setSelectedProject(project);
    setSelectedDriver(driver ?? null);
    if (row) {
      setPortfolioGroup(row);
    }
    loadDrilldown({
      project,
      from_date: fromDate,
      to_date: toDate,
      driver: driver?.driver_type,
      driver_key: driver?.driver_key,
      ...portfolioFilterArgs(row ?? portfolioGroup),
    })
      .then((result) => setDrilldown(result?.message as AnalyticsDrilldownResponse))
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const openPortfolioDrilldown = (row: PortfolioRow) => {
    const firstProject = row.projects?.[0]?.project;
    if (!firstProject) {
      toast({ variant: "destructive", description: "No projects available for drill-down." });
      return;
    }
    setPortfolioGroup(row);
    openProjectDrilldown(firstProject, undefined, row);
  };

  const openSummaryMetricDrilldown = (driver?: MarginDriver) => {
    const firstProject = rows.flatMap((row) => row.projects || []).find((project) => project.project)?.project;
    if (!firstProject) {
      toast({ variant: "destructive", description: "No projects available for drill-down." });
      return;
    }
    openProjectDrilldown(firstProject, driver);
  };

  const recognizedRevenueDriver: MarginDriver = {
    driver: "Recognized Revenue",
    driver_type: "revenue",
    driver_key: "recognized_revenue",
    amount: Number(summary?.recognized_revenue || 0),
    impact: "positive",
  };

  return (
    <div className="flex h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-1">
          <Typography variant="h3" className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 className="h-5 w-5" />
            Portfolio Margin
          </Typography>
          <Typography variant="small" className="text-muted-foreground">
            Recognized revenue minus incurred cost, with planned vs actual margin and drill-down to drivers.
          </Typography>
        </div>
      </RootHeader>

      <div className="space-y-4 overflow-auto p-4">
        <Card>
          <CardContent className="grid gap-3 pt-4 md:grid-cols-5">
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger><SelectValue placeholder="Group by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Client</SelectItem>
                <SelectItem value="project_type">Project Type</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={customer || "all"}
              onValueChange={(value) => setCustomer(value === "all" ? "" : value)}
            >
              <SelectTrigger><SelectValue placeholder="Client filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {customers?.map((item) => (
                  <SelectItem key={item.name} value={item.name}>
                    {item.customer_name || item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => mutate()}>
              Refresh
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Recognized Revenue", summary?.recognized_revenue, false, recognizedRevenueDriver],
                ["Incurred Cost", summary?.incurred_cost, true, undefined],
                ["Actual Margin", summary?.actual_margin, false, undefined],
                ["Planned Margin", summary?.planned_margin, false, undefined],
              ].map(([label, value, inverse, driver]) => (
                <button
                  key={label as string}
                  type="button"
                  className="rounded-md border text-left hover:bg-muted/50"
                  onClick={() => openSummaryMetricDrilldown(driver as MarginDriver | undefined)}
                >
                  <Card className="border-0 shadow-none">
                    <CardContent className="pt-4">
                      <Typography variant="small" className="text-muted-foreground">
                        {label}
                      </Typography>
                      <Typography
                        variant="p"
                        className={mergeClassNames(
                          "font-semibold text-lg",
                          !inverse && typeof value === "number" ? marginClass(value) : ""
                        )}
                      >
                        {value ?? 0} {response?.currency}
                      </Typography>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Planned vs Actual</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border p-3">
                  <Typography variant="small" className="text-muted-foreground">
                    Planned Margin %
                  </Typography>
                  <Typography variant="p" className="font-semibold">
                    {summary?.planned_margin_pct ?? 0}%
                  </Typography>
                </div>
                <div className="rounded-md border p-3">
                  <Typography variant="small" className="text-muted-foreground">
                    Actual Margin %
                  </Typography>
                  <Typography variant="p" className={mergeClassNames("font-semibold", marginClass(summary?.actual_margin_pct || 0))}>
                    {summary?.actual_margin_pct ?? 0}%
                  </Typography>
                </div>
                <div className="rounded-md border p-3">
                  <Typography variant="small" className="text-muted-foreground">
                    Variance
                  </Typography>
                  <div className="flex items-center gap-2">
                    {(summary?.margin_variance || 0) >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-destructive" />
                    )}
                    <Typography variant="p" className={mergeClassNames("font-semibold", marginClass(summary?.margin_variance || 0))}>
                      {summary?.margin_variance ?? 0} {response?.currency}
                    </Typography>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Portfolio View</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead>Projects</TableHead>
                      <TableHead>Recognized Revenue</TableHead>
                      <TableHead>Incurred Cost</TableHead>
                      <TableHead>Actual Margin</TableHead>
                      <TableHead>Planned Margin</TableHead>
                      <TableHead>Variance</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.key}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openPortfolioDrilldown(row)}
                      >
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell>{row.project_count}</TableCell>
                        <TableCell>{row.recognized_revenue}</TableCell>
                        <TableCell>{row.incurred_cost}</TableCell>
                        <TableCell className={marginClass(row.actual_margin)}>{row.actual_margin}</TableCell>
                        <TableCell>{row.planned_margin}</TableCell>
                        <TableCell className={marginClass(row.margin_variance)}>{row.margin_variance}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPortfolioDrilldown(row);
                            }}
                          >
                            Drill Down
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {groupBy === "customer" || groupBy === "project" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Projects in Portfolio</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rows.flatMap((row) =>
                    (row.projects || []).map((project) => (
                      <button
                        key={project.project}
                        type="button"
                        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                        onClick={() => openProjectDrilldown(project.project, undefined, row)}
                      >
                        <div>
                          <div className="font-medium">{project.project_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Actual {project.actual_margin_pct}% · Variance {project.margin_variance}
                          </div>
                        </div>
                        <Badge variant="outline">{project.actual_margin}</Badge>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </div>

      <AnalyticsDrilldownSheet
        open={Boolean(drilldown)}
        title="Margin Drivers"
        description={
          selectedProject
            ? `${selectedProject} · ${fromDate} to ${toDate}`
            : `${fromDate} to ${toDate}`
        }
        loading={drilldownLoading}
        payload={drilldown}
        onClose={() => {
          setDrilldown(null);
          setSelectedDriver(null);
        }}
        exportFilename={`margin-drilldown-${selectedProject || "portfolio"}-${fromDate}-to-${toDate}.csv`}
        valueKey="amount"
      >
        {drilldown ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <Typography variant="small" className="text-muted-foreground">
                  Recognized Revenue
                </Typography>
                <Typography variant="p" className="font-semibold">
                  {drilldown.summary?.recognized_revenue as number}
                </Typography>
              </div>
              <div className="rounded-md border p-3">
                <Typography variant="small" className="text-muted-foreground">
                  Incurred Cost
                </Typography>
                <Typography variant="p" className="font-semibold">
                  {drilldown.summary?.incurred_cost as number}
                </Typography>
              </div>
              <div className="rounded-md border p-3 col-span-2">
                <Typography variant="small" className="text-muted-foreground">
                  Actual Margin
                </Typography>
                <Typography variant="p" className={mergeClassNames("font-semibold", marginClass(Number(drilldown.summary?.actual_margin || 0)))}>
                  {drilldown.summary?.actual_margin as number}
                </Typography>
              </div>
            </div>

            <div className="space-y-2">
              <Typography variant="p" className="font-medium">
                Drivers
              </Typography>
              {(drilldown.drivers || []).map((driver) => (
                <button
                  key={`${driver.driver_type}-${driver.driver_key}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => selectedProject && openProjectDrilldown(selectedProject, driver, portfolioGroup)}
                >
                  <div>
                    <div className="font-medium">{driver.driver}</div>
                    <div className="text-sm text-muted-foreground capitalize">{driver.driver_type}</div>
                  </div>
                  <Badge variant={driver.impact === "positive" ? "outline" : "destructive"}>
                    {driver.amount}
                  </Badge>
                </button>
              ))}
            </div>

            {selectedDriver ? (
              <Typography variant="p" className="font-medium">
                {selectedDriver.driver} Details
              </Typography>
            ) : null}
          </div>
        ) : null}
      </AnalyticsDrilldownSheet>
    </div>
  );
};

export default PortfolioMargins;
