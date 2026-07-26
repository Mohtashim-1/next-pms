/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Typography,
} from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import {
  Activity,
  Briefcase,
  Clock3,
  ExternalLink,
  FileBarChart,
  Filter,
  FolderKanban,
  LayoutGrid,
  List,
  Search,
  Shield,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

/**
 * Internal dependencies.
 */
import { Header as RootHeader } from "@/app/layout/root";
import { mergeClassNames } from "@/lib/utils";

type ReportItem = {
  name: string;
  description: string;
  category: string;
  audience: string[];
  url: string;
  detail?: "deep" | "high" | "summary";
  tags?: string[];
  kind?: "desk" | "app" | "portal";
};

type ReportsResponse = {
  allowed: boolean;
  reports: ReportItem[];
  categories?: string[];
  counts?: { total: number; deep: number; desk?: number; portal?: number; app: number };
  persona?: { persona?: string; title?: string };
};

const CATEGORY_META: Record<string, { icon: typeof Clock3; blurb: string }> = {
  Timesheet: { icon: Clock3, blurb: "Hours, compliance, billing leakage, WIP" },
  Resource: { icon: Activity, blurb: "Capacity, bench, skills, planned vs actual" },
  Project: { icon: FolderKanban, blurb: "Health, EVM, milestones, risks, scorecards" },
  Finance: { icon: Wallet, blurb: "Margins, client P&L, AR, overhead" },
  People: { icon: Users, blurb: "Leave, attendance, appraisals, team KPIs" },
};

const Reports = () => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [detailFilter, setDetailFilter] = useState<"all" | "deep" | "live">("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  const { data, isLoading, error } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.get_reports_catalog",
    undefined,
    "next-pms-reports-catalog",
    { revalidateOnFocus: false }
  );

  const response = data?.message as ReportsResponse | undefined;
  const reports = response?.reports ?? [];
  const categories = response?.categories ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      if (category !== "All" && report.category !== category) return false;
      if (detailFilter === "deep" && report.detail !== "deep") return false;
      if (detailFilter === "live" && report.kind !== "app") return false;
      if (!q) return true;
      const hay = `${report.name} ${report.description} ${(report.tags || []).join(" ")} ${report.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [reports, query, category, detailFilter]);

  const featured = useMemo(
    () => filtered.filter((r) => r.detail === "deep" || r.kind === "app").slice(0, 4),
    [filtered]
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, ReportItem[]>();
    for (const report of filtered) {
      const list = map.get(report.category) || [];
      list.push(report);
      map.set(report.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-background via-background to-muted/20">
      <RootHeader className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Typography variant="h3" className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileBarChart className="h-5 w-5" />
              </span>
              Reports library
              {response?.persona?.persona ? (
                <Badge variant="outline" className="text-[10px] uppercase font-normal">
                  {response.persona.persona}
                </Badge>
              ) : null}
            </Typography>
            <Typography variant="small" className="max-w-2xl text-muted-foreground">
              Deep operational, delivery, and finance reports for System Managers, Team Leads, and
              Project Managers. Search, filter by category, or jump into live Next PMS boards.
            </Typography>
            {response?.counts ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="secondary">{response.counts.total} reports</Badge>
                <Badge variant="outline">{response.counts.deep} deep-dive</Badge>
                <Badge variant="outline">{response.counts.app} live boards</Badge>
                <Badge variant="outline">
                  {(response.counts.portal ?? response.counts.desk) || 0} in portal
                </Badge>
              </div>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-2 sm:max-w-md">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search reports, tags, categories…"
                className="h-10 pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={detailFilter === "all" ? "default" : "outline"}
                onClick={() => setDetailFilter("all")}
              >
                <Filter className="mr-1 h-3.5 w-3.5" />
                All
              </Button>
              <Button
                size="sm"
                variant={detailFilter === "deep" ? "default" : "outline"}
                onClick={() => setDetailFilter("deep")}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Deep dive
              </Button>
              <Button
                size="sm"
                variant={detailFilter === "live" ? "default" : "outline"}
                onClick={() => setDetailFilter("live")}
              >
                <Briefcase className="mr-1 h-3.5 w-3.5" />
                Live boards
              </Button>
              <div className="ml-auto flex rounded-md border p-0.5">
                <button
                  type="button"
                  className={mergeClassNames(
                    "rounded px-2 py-1",
                    view === "grid" ? "bg-muted" : "text-muted-foreground"
                  )}
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={mergeClassNames(
                    "rounded px-2 py-1",
                    view === "list" ? "bg-muted" : "text-muted-foreground"
                  )}
                  onClick={() => setView("list")}
                  aria-label="List view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </RootHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 p-3 sm:p-5 lg:flex-row">
          <aside className="w-full shrink-0 space-y-2 lg:w-56">
            <Typography variant="small" className="px-1 font-medium text-muted-foreground">
              Categories
            </Typography>
            <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {["All", ...categories].map((cat) => {
                const count =
                  cat === "All" ? reports.length : reports.filter((r) => r.category === cat).length;
                const MetaIcon = cat !== "All" ? CATEGORY_META[cat]?.icon || FileBarChart : FileBarChart;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={mergeClassNames(
                      "flex min-w-[9rem] items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition lg:min-w-0",
                      category === cat
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "bg-card/60 text-muted-foreground hover:bg-card"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <MetaIcon className="h-4 w-4" />
                      {cat}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {count}
                    </Badge>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="min-w-0 flex-1 space-y-6">
            {isLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-2xl" />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
                <div className="flex items-start gap-3">
                  <Shield className="mt-0.5 h-5 w-5 text-destructive" />
                  <div>
                    <Typography variant="p" className="font-medium">
                      Access restricted
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      Reports are limited to System Managers, Team Leads, and Project Managers.
                    </Typography>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {featured.length && category === "All" && detailFilter === "all" && !query ? (
                  <section className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <Typography variant="p" className="font-semibold">
                        Recommended deep dives
                      </Typography>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {featured.map((report) => (
                        <ReportCard key={`feat-${report.name}`} report={report} featured />
                      ))}
                    </div>
                  </section>
                ) : null}

                {byCategory.map(([cat, items]) => {
                  const meta = CATEGORY_META[cat];
                  const Icon = meta?.icon || FileBarChart;
                  return (
                    <section key={cat} className="space-y-3">
                      <div className="flex items-end justify-between gap-3 border-b border-border/60 pb-2">
                        <div>
                          <Typography variant="p" className="flex items-center gap-2 font-semibold">
                            <Icon className="h-4 w-4 text-primary" />
                            {cat}
                          </Typography>
                          {meta?.blurb ? (
                            <Typography variant="small" className="text-muted-foreground">
                              {meta.blurb}
                            </Typography>
                          ) : null}
                        </div>
                        <Badge variant="secondary">{items.length}</Badge>
                      </div>
                      <div
                        className={mergeClassNames(
                          view === "grid" ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"
                        )}
                      >
                        {items.map((report) => (
                          <ReportCard key={report.name} report={report} compact={view === "list"} />
                        ))}
                      </div>
                    </section>
                  );
                })}

                {!filtered.length ? (
                  <div className="rounded-2xl border border-dashed p-8 text-center">
                    <Typography variant="p" className="font-medium">
                      No reports match your filters
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      Try another category or clear the search.
                    </Typography>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReportCard = ({
  report,
  featured = false,
  compact = false,
}: {
  report: ReportItem;
  featured?: boolean;
  compact?: boolean;
}) => {
  const inPortal = report.kind === "app" || report.kind === "portal";
  const to = report.url.startsWith("/next-pms/")
    ? report.url.replace(/^\/next-pms/, "") || "/"
    : report.url;

  const body = (
    <>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Typography variant="p" className="font-semibold leading-snug">
            {report.name}
          </Typography>
          <div className="flex flex-wrap gap-1.5">
            {report.detail === "deep" ? (
              <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Deep dive</Badge>
            ) : null}
            {report.kind === "app" ? (
              <Badge variant="secondary">Live board</Badge>
            ) : report.kind === "portal" ? (
              <Badge variant="secondary">In portal</Badge>
            ) : (
              <Badge variant="outline">Desk report</Badge>
            )}
          </div>
        </div>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
      </div>
      {!compact ? (
        <Typography variant="small" className="line-clamp-2 text-muted-foreground">
          {report.description}
        </Typography>
      ) : null}
      {!compact && report.tags?.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {report.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );

  const className = mergeClassNames(
    "group block rounded-2xl border bg-card/80 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg",
    featured && "border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card",
    compact ? "p-3" : "p-4"
  );

  if (inPortal) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <a href={report.url} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  );
};

export default Reports;
