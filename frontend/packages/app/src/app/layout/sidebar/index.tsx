/**
 * External dependencies.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { NavLink } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { ErrorFallback, Typography, Button } from "@next-pms/design-system/components";
import {
  ArrowLeftToLine,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ListChecks,
  Clock3,
  BarChart3,
  FileText,
  FolderDot,
  FolderKanban,
  BookUser,
  PieChart,
  GanttChartSquareIcon,
  Home,
  LayoutDashboard,
  Search,
  UserCircle2,
  Users,
} from "lucide-react";
/**
 * Internal dependencies.
 */
import {
  DASHBOARD,
  HOME,
  PROJECT,
  RESOURCE_MANAGEMENT,
  PM_ACCESS_ROLES,
  REPORT_ACCESS_ROLES,
  REPORTS,
  TASK,
  TEAM,
  TIMESHEET,
  WORK_ENTRIES,
} from "@/lib/constant";
import { useFrappeGetCall } from "frappe-react-sdk";
import { setLocalStorage } from "@/lib/storage";
import { checkIsMobile, mergeClassNames } from "@/lib/utils";
import { setSidebarCollapsed } from "@/store/user";
import type { NestedRoute, Route } from "./types";
import UserNavigation from "./userNavigation";
import ViewLoader from "./viewLoader";
import { RootState } from "../../../store";
import type { ViewData } from "../../../store/view";

const isExternalUrl = (url?: string) =>
  Boolean(url && (url.startsWith("/desk") || url.startsWith("http://") || url.startsWith("https://")));

const toSidebarPath = (url: string) => {
  if (isExternalUrl(url)) return url;
  if (url.startsWith("/next-pms/")) return url.replace(/^\/next-pms/, "") || "/";
  return url;
};

const Sidebar = () => {
  const user = useSelector((state: RootState) => state.user);
  const viewInfo = useSelector((state: RootState) => state.view);
  const dispatch = useDispatch();
  const location = useLocation();

  const [openRoutes, setOpenRoutes] = useState<{ [key: string]: boolean }>({
    "dashboards-tools": true,
  });

  const hasPmRole = user.roles.some((role: string) => PM_ACCESS_ROLES.includes(role));
  const hasReportAccess = user.roles.some((role: string) => REPORT_ACCESS_ROLES.includes(role));
  const { data: approvalCountData } = useFrappeGetCall(
    "next_pms.timesheet.api.approval_queue.get_approval_queue_count",
    {},
    hasPmRole ? "approval-queue-count" : null,
    {
      revalidateOnFocus: true,
      refreshInterval: 60000,
    }
  );
  const { data: reportsCatalogData } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.get_reports_catalog",
    undefined,
    hasReportAccess ? "sidebar-tools-catalog-v2" : null,
    { revalidateOnFocus: false }
  );
  const tools =
    (reportsCatalogData?.message?.tools as { name: string; url: string; kind?: string }[] | undefined) ||
    (
      reportsCatalogData?.message?.by_category as
        | { category: string; is_tools?: boolean; reports: { name: string; url: string; kind?: string }[] }[]
        | undefined
    )?.find((cat) => cat.is_tools || cat.category === "Dashboards & Tools")?.reports ||
    [];
  const reportCategories = (() => {
    const fromApi = reportsCatalogData?.message?.report_categories as
      | { category: string; reports: { name: string; url: string; kind?: string }[] }[]
      | undefined;
    if (fromApi?.length) return fromApi;

    // Fallback: group portal query reports from the flat catalog
    // (covers older API responses that omit report_categories)
    const reports = (reportsCatalogData?.message?.reports as
      | { name: string; url: string; kind?: string; category?: string }[]
      | undefined) || [];
    const portal = reports.filter((r) => r.kind === "portal" && r.category);
    const grouped = new Map<string, { name: string; url: string; kind?: string }[]>();
    for (const report of portal) {
      const category = report.category as string;
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push({ name: report.name, url: report.url, kind: report.kind });
    }
    return Array.from(grouped.entries()).map(([category, items]) => ({
      category,
      reports: items,
    }));
  })();

  const approvalQueueCount = approvalCountData?.message?.count ?? 0;
  const privateViews = viewInfo.views.filter(
    (view: ViewData) => view.user === user.user && !view.default && !view.public
  );
  const publicViews = viewInfo.views.filter((view: ViewData) => view.public && !view.default);
  const routes: Array<Route> = [
    {
      to: DASHBOARD,
      icon: LayoutDashboard,
      label: "Dashboard",
      key: "dashboard",
      isPmRoute: false,
    },
    {
      to: HOME,
      icon: Home,
      label: "Home",
      key: "home",
      isPmRoute: true,
    },
    {
      to: TIMESHEET,
      icon: Clock3,
      label: "Timesheet",
      key: "timesheet",
      isPmRoute: false,
    },
    {
      to: WORK_ENTRIES,
      icon: ListChecks,
      label: "Work Entries",
      key: "work-entries",
      isPmRoute: false,
    },
    {
      to: TEAM,
      icon: Users,
      label: "Team",
      key: "team",
      isPmRoute: true,
    },
    {
      to: PROJECT,
      icon: FolderDot,
      label: "Project",
      key: "project",
      isPmRoute: true,
      children: [
        {
          to: PROJECT,
          label: "Projects",
          key: "project-list",
          icon: FolderDot,
        },
        {
          to: `${PROJECT}/invoicing`,
          label: "Client Invoicing",
          key: "client-invoicing",
          icon: FileText,
        },
        {
          to: `${PROJECT}/margins`,
          label: "Portfolio Margin",
          key: "portfolio-margin",
          icon: BarChart3,
        },
        {
          to: `${PROJECT}/profitability`,
          label: "Profitability Dashboard",
          key: "project-profitability",
          icon: PieChart,
        },
      ],
    },
    {
      to: TASK,
      icon: ClipboardList,
      label: "Task",
      key: "task",
      isPmRoute: false,
    },
  ];
  if (hasReportAccess && tools.length) {
    routes.splice(1, 0, {
      to: DASHBOARD,
      icon: PieChart,
      label: "Dashboards & Tools",
      key: "dashboards-tools",
      isPmRoute: false,
      children: tools.map((tool) => {
        const path = toSidebarPath(tool.url);
        return {
          to: path,
          label: tool.name,
          key: `tool-${tool.name}`,
          external: isExternalUrl(tool.url) || tool.kind === "desk",
        };
      }),
    });
  }
  if (hasReportAccess && reportCategories.length) {
    const toolsIndex = routes.findIndex((route) => route.key === "dashboards-tools");
    routes.splice(toolsIndex >= 0 ? toolsIndex + 1 : 1, 0, {
      to: `/${REPORTS}`,
      icon: FileText,
      label: "Reports",
      key: "reports",
      isPmRoute: false,
      children: reportCategories.map((category) => ({
        label: category.category,
        key: `report-category-${category.category}`,
        children: category.reports.map((report) => ({
          to: toSidebarPath(report.url),
          label: report.name,
          key: `report-${report.name}`,
          external: isExternalUrl(report.url) || report.kind === "desk",
        })),
      })),
    });
  }
  if (
    hasPmRole &&
    (!user.roles.includes("Contractor") || user.user === "Administrator")
  ) {
    routes.push({
      to: RESOURCE_MANAGEMENT,
      label: "Resource Management",
      key: "resource-management",
      isPmRoute: true,
      children: [
        {
          to: RESOURCE_MANAGEMENT + "/my-assignments",
          label: "My Assignments",
          key: "my-assignments",
          icon: UserCircle2,
        },
        {
          to: RESOURCE_MANAGEMENT + "/capacity",
          label: "Capacity Planning",
          key: "capacity-planning",
          icon: BarChart3,
        },
        {
          to: RESOURCE_MANAGEMENT + "/time-allocation",
          label: "Time Allocation",
          key: "time-allocation",
          icon: PieChart,
        },
        {
          to: RESOURCE_MANAGEMENT + "/talent-finder",
          label: "Talent Finder",
          key: "talent-finder",
          icon: Search,
        },
        {
          to: RESOURCE_MANAGEMENT + "/timeline",
          label: "Timeline",
          key: "timeline-view",
          icon: GanttChartSquareIcon,
        },
        {
          to: RESOURCE_MANAGEMENT + "/team",
          label: "Team",
          key: "team-view",
          icon: BookUser,
        },
        {
          to: RESOURCE_MANAGEMENT + "/project",
          label: "Project",
          key: "project-view",
          icon: FolderKanban,
        },
      ],
    });
  }
  const toggleNestedRoutes = (key: string) => {
    setOpenRoutes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSidebarCollapse = useCallback(() => {
    dispatch(setSidebarCollapsed(checkIsMobile()));
  }, [dispatch]);

  useEffect(() => {
    setLocalStorage("next-pms:isSidebarCollapsed", user.isSidebarCollapsed);
  }, [user.isSidebarCollapsed]);
  useEffect(() => {
    if (checkIsMobile()) {
      dispatch(setSidebarCollapsed(true));
    }
    window.addEventListener("resize", handleSidebarCollapse);
    return () => window.removeEventListener("resize", handleSidebarCollapse);
  }, [dispatch, handleSidebarCollapse]);

  return (
    <ErrorFallback>
      <aside
        className={mergeClassNames(
          "bg-card w-1/5 px-4 py-4 flex flex-col border-r",
          user.isSidebarCollapsed && "w-16 items-center"
        )}
      >
        <div
          className={mergeClassNames("flex shrink-0 gap-x-2 items-center", !user.isSidebarCollapsed && "px-2")}
          id="app-logo"
        >
          <Typography
            title="Project Management"
            variant="h5"
            className={mergeClassNames(
              "transition-all cursor-pointer duration-300 truncate  max-md:hidden",
              user.isSidebarCollapsed && "hidden"
            )}
          >
            Project Management
          </Typography>
        </div>
        <div className="overflow-y-auto no-scrollbar">
          <div className="pt-3 h-fit  flex flex-col gap-y-2  ">
            {routes.map((route: Route) => {
              if (route.isPmRoute && !hasPmRole) return null;
              return route.children ? (
                <React.Fragment key={route.key}>
                  <Button
                    key={route.key}
                    variant="ghost"
                    title={route.label}
                    className={mergeClassNames(
                      "flex items-center gap-x-2 justify-start w-full text-left p-2 hover:bg-accent rounded-lg",
                      user.isSidebarCollapsed && "hidden"
                    )}
                    onClick={() => toggleNestedRoutes(route.key)}
                  >
                    {openRoutes[route.key] ? (
                      <ChevronUp className=" w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronDown className=" w-4 h-4 shrink-0" />
                    )}
                    <Typography
                      variant="p"
                      className={mergeClassNames("  truncate", user.isSidebarCollapsed && "hidden")}
                    >
                      {route.label}
                    </Typography>
                  </Button>
                  <div
                    className={mergeClassNames(
                      "flex flex-col gap-y-1",
                      openRoutes[route.key] ? "flex" : "hidden",
                      user.isSidebarCollapsed ? "flex" : "pl-2"
                    )}
                  >
                    {route.children.map((child: NestedRoute) => {
                      if (child.children?.length) {
                        const catKey = child.key;
                        const isCatOpen = openRoutes[catKey];
                        return (
                          <React.Fragment key={child.key}>
                            <Button
                              variant="ghost"
                              title={child.label}
                              className={mergeClassNames(
                                "flex h-8 w-full items-center justify-start gap-x-2 rounded-lg p-2 text-left hover:bg-accent",
                                user.isSidebarCollapsed && "hidden"
                              )}
                              onClick={() => toggleNestedRoutes(catKey)}
                            >
                              {isCatOpen ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                              )}
                              <Typography variant="p" className="truncate text-xs font-medium text-muted-foreground">
                                {child.label}
                              </Typography>
                            </Button>
                            <div
                              className={mergeClassNames(
                                "flex flex-col gap-y-0.5",
                                isCatOpen ? "flex" : "hidden",
                                !user.isSidebarCollapsed && "pl-3"
                              )}
                            >
                              {child.children.map((report) => {
                                if (!report.to) return null;
                                const isReportActive =
                                  location.pathname === report.to ||
                                  location.pathname === decodeURIComponent(report.to) ||
                                  decodeURIComponent(location.pathname) === decodeURIComponent(report.to);
                                return (
                                  <NavLink
                                    to={report.to}
                                    key={report.key}
                                    title={report.label}
                                    className="group flex h-8 items-center"
                                  >
                                    <div
                                      className={mergeClassNames(
                                        "flex w-full items-center gap-x-2 rounded-lg p-1.5 text-foreground hover:bg-accent max-md:justify-center",
                                        isReportActive && "border-l-2 border-primary bg-accent shadow-md",
                                        !user.isSidebarCollapsed && "pl-2"
                                      )}
                                    >
                                      <Typography
                                        variant="p"
                                        className={mergeClassNames(
                                          "truncate text-xs text-foreground",
                                          user.isSidebarCollapsed && "hidden"
                                        )}
                                      >
                                        {report.label}
                                      </Typography>
                                    </div>
                                  </NavLink>
                                );
                              })}
                            </div>
                          </React.Fragment>
                        );
                      }

                      if (!child.to) return null;
                      const isExternal = child.external || isExternalUrl(child.to);
                      const isChildActive =
                        !isExternal &&
                        (child.to === location.pathname || location.pathname.startsWith(`${child.to}/`));
                      const linkClassName = "group flex h-9 items-center";
                      const inner = (
                        <div
                          className={mergeClassNames(
                            "flex w-full items-center gap-x-2 rounded-lg p-2 text-foreground hover:bg-accent max-md:justify-center",
                            isChildActive && "border-l-2 border-primary bg-accent shadow-md",
                            !user.isSidebarCollapsed && "pl-3"
                          )}
                        >
                          {child.icon && (
                            <child.icon
                              className={mergeClassNames(
                                "h-4 w-4 shrink-0 stroke-foreground",
                                isChildActive && "stroke-primary"
                              )}
                            />
                          )}
                          <Typography
                            variant="p"
                            className={mergeClassNames(
                              "truncate text-foreground",
                              isChildActive && "text-foreground",
                              user.isSidebarCollapsed && "hidden"
                            )}
                          >
                            {child.label}
                          </Typography>
                        </div>
                      );
                      if (isExternal) {
                        return (
                          <a
                            href={child.to}
                            key={child.key}
                            title={child.label}
                            className={linkClassName}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {inner}
                          </a>
                        );
                      }
                      return (
                        <NavLink to={child.to} key={child.key} title={child.label} className={linkClassName}>
                          {inner}
                        </NavLink>
                      );
                    })}
                  </div>
                </React.Fragment>
              ) : (
                <NavLink to={route.to} key={route.key} title={route.label} className="  flex items-center h-9 group">
                  {({ isActive }) => (
                    <div
                      className={mergeClassNames(
                        "flex w-full pl-2 rounded-lg items-center p-2 hover:bg-accent gap-x-2 max-md:justify-center",
                        isActive &&
                          "border-l-2 border-primary bg-accent shadow-md"
                      )}
                    >
                      <route.icon
                        className={mergeClassNames(
                          "shrink-0 stroke-foreground h-4 w-4",
                          isActive && "stroke-primary"
                        )}
                      />
                      <Typography
                        variant="p"
                        className={mergeClassNames(
                          "text-foreground",
                          isActive && "text-foreground",
                          user.isSidebarCollapsed && "hidden"
                        )}
                      >
                        {route.label}
                      </Typography>
                      {route.key === "team" && approvalQueueCount > 0 && (
                        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[0.65rem] font-semibold text-destructive-foreground">
                          {approvalQueueCount > 99 ? "99+" : approvalQueueCount}
                        </span>
                      )}
                    </div>
                  )}
                </NavLink>
              );
            })}
          </div>
          <ViewLoader
            label="Private Views"
            isSidebarCollapsed={user.isSidebarCollapsed}
            openRoutes={openRoutes}
            hasPmRole={hasPmRole}
            id="private_view"
            views={privateViews}
            onClick={() => toggleNestedRoutes("private_view")}
          />
          <ViewLoader
            label="Public Views"
            isSidebarCollapsed={user.isSidebarCollapsed}
            openRoutes={openRoutes}
            hasPmRole={hasPmRole}
            views={publicViews}
            id="public_view"
            onClick={() => toggleNestedRoutes("public_view")}
          />
        </div>
        <div className="grow"></div>
        <div className={mergeClassNames("flex justify-between items-center", user.isSidebarCollapsed && "flex-col")}>
          <UserNavigation user={user} />

          <Button
            variant="ghost"
            className="justify-end shrink-0 gap-x-2 max-md:hidden   h-6"
            onClick={() => dispatch(setSidebarCollapsed(!user.isSidebarCollapsed))}
          >
            <ArrowLeftToLine
              className={mergeClassNames(
                "stroke-primary h-4 w-4 transition-all duration-600",
                user.isSidebarCollapsed && "rotate-180"
              )}
            />
          </Button>
        </div>
      </aside>
    </ErrorFallback>
  );
};

export default Sidebar;
