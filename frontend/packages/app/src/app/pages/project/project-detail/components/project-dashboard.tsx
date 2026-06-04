/**
 * External dependencies
 */
import { useMemo } from "react";
import { formatDate } from "@next-pms/design-system";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ListChecks,
  Users,
} from "lucide-react";

/**
 * Internal dependencies
 */
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type DashboardUser = {
  id: string;
  name: string;
  type: "User" | "Allocation";
};

type Allocation = {
  name: string;
  employee: string;
  employee_name: string;
  status: string;
  total_allocated_hours: number;
  hours_allocated_per_day: number;
  allocation_start_date?: string;
  allocation_end_date?: string;
  is_billable?: 0 | 1;
};

type TaskStatus = {
  status: string;
  count: number;
};

type ActivityItem = {
  type: "Project Update" | "Task";
  title: string;
  status?: string;
  user?: string;
  when?: string;
};

type ProjectDashboardData = {
  project: {
    project_name: string;
    status: string;
    percent_complete: number;
    customer?: string;
    project_type?: string;
    billing_type?: string;
    currency?: string;
  };
  timeline: {
    start?: string;
    end?: string;
  };
  users: DashboardUser[];
  allocations: Allocation[];
  tasks: {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    completion: number;
    by_status: TaskStatus[];
  };
  recent_activity: ActivityItem[];
};

type ProjectDashboardProps = {
  projectId?: string;
};

const ProjectDashboard = ({ projectId }: ProjectDashboardProps) => {
  const { toast } = useToast();
  const { data, isLoading, error } = useFrappeGetCall(
    "next_pms.timesheet.api.project.get_project_dashboard",
    { project: projectId },
    projectId ? undefined : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  if (error) {
    toast({
      variant: "destructive",
      description: parseFrappeErrorMsg(error),
    });
  }

  if (isLoading || !data?.message) {
    return <DashboardSkeleton />;
  }

  return <DashboardContent data={data.message} />;
};

const DashboardContent = ({ data }: { data: ProjectDashboardData }) => {
  const completion = normalizePercent(data.tasks.completion || data.project.percent_complete);
  const taskSegments = useMemo(() => buildTaskSegments(data.tasks.by_status), [data.tasks.by_status]);
  const allocationTotal = data.allocations.reduce((total, item) => total + (Number(item.total_allocated_hours) || 0), 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.7fr] gap-4">
        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <Typography variant="small" className="text-muted-foreground">
                  Project Dashboard
                </Typography>
                <CardTitle className="mt-1 text-xl leading-tight truncate">{data.project.project_name}</CardTitle>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge>{data.project.status}</Badge>
                  {data.project.project_type && <Badge variant="secondary">{data.project.project_type}</Badge>}
                  {data.project.billing_type && <Badge variant="secondary">{data.project.billing_type}</Badge>}
                  {data.project.customer && <Badge variant="secondary">{data.project.customer}</Badge>}
                </div>
              </div>
              <ProgressRing value={completion} label="Complete" />
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Metric icon={ListChecks} label="Tasks" value={data.tasks.total} subValue={`${data.tasks.pending} pending`} />
            <Metric icon={CheckCircle2} label="Completed" value={data.tasks.completed} subValue={`${completion}% done`} />
            <Metric icon={AlertTriangle} label="Overdue" value={data.tasks.overdue} subValue="Need attention" tone="danger" />
            <Metric icon={Users} label="People" value={data.users.length} subValue={`${data.allocations.length} allocations`} />
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" />
              Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <DateBlock label="Start" value={data.timeline.start} />
              <DateBlock label="End" value={data.timeline.end} />
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                <span>Overall progress</span>
                <span>{completion}%</span>
              </div>
              <Progress value={completion} className="h-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              Task Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <StackedBar segments={taskSegments} total={data.tasks.total} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {taskSegments.map((segment) => (
                <div key={segment.label} className="flex items-center justify-between rounded border p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={mergeClassNames("h-2.5 w-2.5 rounded-full shrink-0", segment.color)} />
                    <Typography variant="small" className="truncate">
                      {segment.label}
                    </Typography>
                  </div>
                  <Typography variant="small" className="font-medium">
                    {segment.value}
                  </Typography>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Project Team
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {data.users.length ? (
                data.users.slice(0, 12).map((user) => <PersonPill key={`${user.type}-${user.id}`} user={user} />)
              ) : (
                <Typography variant="small" className="text-muted-foreground">
                  No users allocated yet.
                </Typography>
              )}
            </div>
            <div className="rounded border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>Allocation</span>
                <span>Hours</span>
                <span>Status</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {data.allocations.length ? (
                  data.allocations.slice(0, 8).map((allocation) => (
                    <div key={allocation.name} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm">
                      <span className="truncate">{allocation.employee_name || allocation.employee}</span>
                      <span>{Number(allocation.total_allocated_hours || 0).toFixed(1)}</span>
                      <Badge variant={allocation.status === "Confirmed" ? "default" : "secondary"}>
                        {allocation.status}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">No resource allocations found.</div>
                )}
              </div>
            </div>
            <Typography variant="small" className="text-muted-foreground">
              {allocationTotal.toFixed(1)} total allocated hours
            </Typography>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.recent_activity.length ? (
              data.recent_activity.map((activity, index) => (
                <div key={`${activity.type}-${activity.title}-${index}`} className="rounded border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Typography variant="p" className="truncate font-medium">
                        {activity.title}
                      </Typography>
                      <Typography variant="small" className="text-muted-foreground">
                        {activity.type} by {activity.user || "Unknown"}
                      </Typography>
                    </div>
                    {activity.status && <Badge variant="secondary">{activity.status}</Badge>}
                  </div>
                  {activity.when && (
                    <Typography variant="small" className="mt-2 text-muted-foreground">
                      {formatDate(activity.when)}
                    </Typography>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded border p-8 text-center text-sm text-muted-foreground lg:col-span-2">
                No recent activity found.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const Metric = ({
  icon: Icon,
  label,
  value,
  subValue,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subValue: string;
  tone?: "danger";
}) => (
  <div className="rounded border p-3">
    <div className="flex items-center justify-between gap-2">
      <Typography variant="small" className="text-muted-foreground">
        {label}
      </Typography>
      <Icon className={mergeClassNames("h-4 w-4 text-muted-foreground", tone === "danger" && "text-red-500")} />
    </div>
    <div className="mt-2 text-2xl font-semibold">{value}</div>
    <Typography variant="small" className="text-muted-foreground">
      {subValue}
    </Typography>
  </div>
);

const DateBlock = ({ label, value }: { label: string; value?: string }) => (
  <div className="rounded border p-3">
    <Typography variant="small" className="text-muted-foreground">
      {label}
    </Typography>
    <Typography variant="p" className="mt-1 font-medium">
      {value ? formatDate(value) : "-"}
    </Typography>
  </div>
);

const PersonPill = ({ user }: { user: DashboardUser }) => (
  <div className="flex items-center gap-2 rounded border px-2 py-1.5">
    <Avatar className="h-6 w-6">
      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
    </Avatar>
    <span className="max-w-40 truncate text-sm">{user.name}</span>
    <Badge variant="secondary">{user.type}</Badge>
  </div>
);

const ProgressRing = ({ value, label }: { value: number; label: string }) => (
  <div
    className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
    style={{ background: `conic-gradient(hsl(var(--primary)) ${value * 3.6}deg, hsl(var(--secondary)) 0deg)` }}
  >
    <div className="grid h-20 w-20 place-items-center rounded-full bg-background text-center">
      <div>
        <div className="text-xl font-semibold">{value}%</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  </div>
);

const StackedBar = ({ segments, total }: { segments: Array<{ label: string; value: number; color: string }>; total: number }) => (
  <div className="flex h-3 overflow-hidden rounded bg-secondary">
    {segments.map((segment) => (
      <div
        key={segment.label}
        className={segment.color}
        style={{ width: `${total ? (segment.value / total) * 100 : 0}%` }}
        title={`${segment.label}: ${segment.value}`}
      />
    ))}
  </div>
);

const DashboardSkeleton = () => (
  <div className="grid gap-4 p-4">
    <Skeleton className="h-44 w-full" />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
    <Skeleton className="h-64 w-full" />
  </div>
);

const buildTaskSegments = (items: TaskStatus[]) => {
  const colors = ["bg-emerald-500", "bg-amber-500", "bg-blue-500", "bg-slate-400", "bg-red-500", "bg-violet-500"];
  return items.length
    ? items.map((item, index) => ({
        label: item.status || "Not Set",
        value: Number(item.count || 0),
        color: colors[index % colors.length],
      }))
    : [{ label: "No Tasks", value: 0, color: "bg-slate-300" }];
};

const normalizePercent = (value: number) => Math.max(0, Math.min(100, Math.round(Number(value || 0))));

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";

export default ProjectDashboard;
