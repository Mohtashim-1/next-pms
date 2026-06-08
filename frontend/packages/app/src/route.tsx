/**
 * External dependencies.
 */
import { lazy, useContext, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Route, Outlet, Navigate } from "react-router-dom";
import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { useContextSelector } from "use-context-selector";
/**
 * Internal dependencies.
 */
import { TIMESHEET, HOME, DASHBOARD, TEAM, TASK, PROJECT, RESOURCE_MANAGEMENT, ROLES } from "@/lib/constant";
import { UserContext } from "@/lib/UserProvider";
import { default as Layout } from "./app/layout";
import { RootState } from "./store";
import { setCurrency, setHasBuField, setHasIndustryField } from "./store/user";
import { setRole } from "./store/user";
import { setViews } from "./store/view";
/**
 * Lazy load components.
 */
const Timesheet = lazy(() => import("@/app/pages/timesheet"));
const Home = lazy(() => import("@/app/pages/home"));
const Team = lazy(() => import("@/app/pages/team"));
const TeamApprovals = lazy(() => import("@/app/pages/team/approvals"));
const ResourceTeam = lazy(() => import("@/app/pages/resource-management/team"));
const ResourceProject = lazy(() => import("@/app/pages/resource-management/project"));
const ResourceTimeLine = lazy(() => import("@/app/pages/resource-management/timeline"));
const PersonalAssignments = lazy(() => import("@/app/pages/resource-management/personal"));
const CapacityDemand = lazy(() => import("@/app/pages/resource-management/capacity"));
const TimeAllocation = lazy(() => import("@/app/pages/resource-management/time-allocation"));
const TalentFinder = lazy(() => import("@/app/pages/resource-management/talent-finder"));
const EmployeeDetail = lazy(() => import("@/app/pages/team/employee-detail"));
const Task = lazy(() => import("@/app/pages/task"));
const Project = lazy(() => import("@/app/pages/project"));
const ProjectDetail = lazy(() => import("@/app/pages/project/project-detail"));
const ClientInvoicing = lazy(() => import("@/app/pages/project/invoicing"));
const PortfolioMargins = lazy(() => import("@/app/pages/project/margins"));
const BudgetBurnShare = lazy(() => import("@/app/pages/project/budget-burn-share"));
const ExecutiveDashboard = lazy(() => import("@/app/pages/dashboard"));
const NotFound = lazy(() => import("@/app/pages/404"));

export function Router() {
  return (
    <Route>
      <Route path="/share/budget-burn/:token" element={<BudgetBurnShare />} />
      <Route element={<AuthenticatedRoute />}>
        <Route path="/" element={<Navigate to={TIMESHEET} replace />} />
        <Route path={TIMESHEET} element={<Timesheet />} />
        <Route element={<PmRoute />}>
          <Route path={DASHBOARD} element={<ExecutiveDashboard />} />
          <Route path={HOME} element={<Home />} />
          <Route path={TEAM}>
            <Route path={`${TEAM}/`} element={<Team />} />
            <Route path="approvals" element={<TeamApprovals />} />
            <Route path={`${TEAM}/employee/:id?`} element={<EmployeeDetail />} />
          </Route>
          <Route path={PROJECT}>
            <Route path={`${PROJECT}/`} element={<Project />} />
            <Route path={`${PROJECT}/invoicing`} element={<ClientInvoicing />} />
            <Route path={`${PROJECT}/invoicing/:draftId`} element={<ClientInvoicing />} />
            <Route path={`${PROJECT}/margins`} element={<PortfolioMargins />} />
            <Route path={`${PROJECT}/:projectId`} element={<ProjectDetail />} />
          </Route>
        </Route>
        <Route path={TASK} element={<Task />} />
        <Route path={`${RESOURCE_MANAGEMENT}/my-assignments`} element={<PersonalAssignments />} />
        <Route path={`${RESOURCE_MANAGEMENT}/capacity`} element={<CapacityDemand />} />
        <Route path={`${RESOURCE_MANAGEMENT}/time-allocation`} element={<TimeAllocation />} />
        <Route path={`${RESOURCE_MANAGEMENT}/talent-finder`} element={<TalentFinder />} />
        <Route path={`${RESOURCE_MANAGEMENT}/timeline`} element={<ResourceTimeLine />} />
        <Route path={`${RESOURCE_MANAGEMENT}/team`} element={<ResourceTeam />} />
        <Route path={`${RESOURCE_MANAGEMENT}/project`} element={<ResourceProject />} />
      </Route>
      <Route path={TASK} element={<Task />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  );
}

const AuthenticatedRoute = () => {
  const { currentUser, isLoading } = useContextSelector(UserContext, (value) => value.state);
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const user = useSelector((state: RootState) => state.user);
  const views = useSelector((state: RootState) => state.view);
  const dispatch = useDispatch();

  useEffect(() => {
    if (user.roles.length < 1) {
      call.get("next_pms.timesheet.api.app.get_data").then((res) => {
        dispatch(setRole(res.message.roles));
        dispatch(setCurrency(res.message.currencies));
        dispatch(setHasBuField(res.message.has_business_unit));
        dispatch(setHasIndustryField(res.message.has_industry));
      });
    }
    if (views.views.length < 1) {
      call.get("next_pms.timesheet.doctype.pms_view_setting.pms_view_setting.get_views").then((res) => {
        dispatch(setViews(res.message));
      });
    }
  }, [call, dispatch, user.roles.length, views.views.length]);

  if (isLoading) {
    return <></>;
  } else if (!currentUser || currentUser === "Guest") {
    window.location.replace("/login?redirect-to=/next-pms/timesheet");
  }

  if (!isLoading && currentUser && currentUser !== "Guest") {
    return (
      <Layout>
        <Outlet />
      </Layout>
    );
  }
};

const PmRoute = () => {
  const user = useSelector((state: RootState) => state.user);
  const hasAccess = user.roles.some((role: string) => ROLES.includes(role));

  if (!hasAccess) {
    return <Navigate to={TIMESHEET} />;
  }

  return <Outlet />;
};
