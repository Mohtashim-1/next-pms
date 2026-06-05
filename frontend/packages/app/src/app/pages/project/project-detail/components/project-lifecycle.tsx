/**
 * External dependencies
 */
import { useEffect, useMemo, useState, type ElementType } from "react";
import { formatDate } from "@next-pms/design-system";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
  TaskStatus,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import {
  CalendarCheck,
  CheckCircle2,
  CircleDot,
  Clock3,
  Flag,
  Handshake,
  LifeBuoy,
  ListChecks,
  Rocket,
} from "lucide-react";

/**
 * Internal dependencies
 */
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type LifecycleStage = {
  key: "kickoff" | "planning" | "development" | "handover" | "support";
  label: string;
  status: string;
  start?: string;
  end?: string;
  progress: number;
  description: string;
  count: number;
};

type LifecycleTask = {
  name: string;
  subject: string;
  status: string;
  priority?: string;
  actual_time?: number;
  expected_time?: number;
  start?: string;
  end?: string;
  progress?: number;
  modified_by_name?: string;
};

type LifecycleEvent = {
  type: "Milestone" | "Project Update" | "Task";
  stage: string;
  title: string;
  status?: string;
  date?: string;
  task?: string;
};

type LifecycleData = {
  project: {
    project_name: string;
    status: string;
    customer?: string;
  };
  dates: {
    kickoff?: string;
    delivery?: string;
    support_start?: string;
    support_end?: string;
  };
  stages: LifecycleStage[];
  summary: {
    development_tasks: number;
    development_completed: number;
    support_tasks: number;
    support_completed: number;
    updates: number;
    events: number;
  };
  development_tasks: LifecycleTask[];
  support_tasks: LifecycleTask[];
  events: LifecycleEvent[];
};

type ProjectLifecycleProps = {
  projectId?: string;
};

const STAGE_ICONS: Record<LifecycleStage["key"], ElementType> = {
  kickoff: Handshake,
  planning: CalendarCheck,
  development: Rocket,
  handover: Flag,
  support: LifeBuoy,
};

const ProjectLifecycle = ({ projectId }: ProjectLifecycleProps) => {
  const { toast } = useToast();
  const { data, isLoading, error } = useFrappeGetCall(
    "next_pms.timesheet.api.project.get_project_lifecycle",
    { project: projectId },
    projectId ? undefined : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        description: parseFrappeErrorMsg(error),
      });
    }
  }, [error, toast]);

  if (isLoading || !data?.message) {
    return <LifecycleSkeleton />;
  }

  return <LifecycleContent data={data.message} />;
};

const LifecycleContent = ({ data }: { data: LifecycleData }) => {
  const [selectedStageKey, setSelectedStageKey] = useState<LifecycleStage["key"]>("development");
  const developmentProgress = percent(data.summary.development_completed, data.summary.development_tasks);
  const supportProgress = percent(data.summary.support_completed, data.summary.support_tasks);
  const selectedStage = data.stages.find((stage) => stage.key === selectedStageKey) || data.stages[0];
  const selectedStageTasks = useMemo(
    () => getStageTasks(selectedStageKey, data.development_tasks, data.support_tasks),
    [data.development_tasks, data.support_tasks, selectedStageKey]
  );
  const selectedStageEvents = useMemo(
    () => data.events.filter((event) => event.stage === selectedStageKey),
    [data.events, selectedStageKey]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <Typography variant="small" className="text-muted-foreground">
                  Project Lifecycle
                </Typography>
                <CardTitle className="mt-1 text-xl">{data.project.project_name}</CardTitle>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge>{data.project.status}</Badge>
                  {data.project.customer && <Badge variant="secondary">{data.project.customer}</Badge>}
                </div>
              </div>
              <div className="rounded border px-4 py-3">
                <Typography variant="small" className="text-muted-foreground">
                  Support Window
                </Typography>
                <Typography variant="p" className="mt-1 font-medium">
                  {formatRange(data.dates.support_start, data.dates.support_end)}
                </Typography>
                <Typography variant="small" className="text-muted-foreground">
                  2 to 3 years after delivery
                </Typography>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Metric icon={ListChecks} label="Development Tasks" value={data.summary.development_tasks} />
            <Metric icon={CheckCircle2} label="Development Done" value={data.summary.development_completed} />
            <Metric icon={LifeBuoy} label="Support Tasks" value={data.summary.support_tasks} />
            <Metric icon={Clock3} label="Timeline Events" value={data.summary.events} />
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Work Split</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressLine label="Development" value={developmentProgress} detail={`${data.summary.development_completed}/${data.summary.development_tasks} done`} />
            <ProgressLine label="Support" value={supportProgress} detail={`${data.summary.support_completed}/${data.summary.support_tasks} done`} />
            <div className="grid grid-cols-3 gap-2 text-center">
              <DateBlock label="Kickoff" value={data.dates.kickoff} />
              <DateBlock label="Delivery" value={data.dates.delivery} />
              <DateBlock label="Support End" value={data.dates.support_end} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lifecycle Stages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {data.stages.map((stage) => (
              <StageCard
                key={stage.key}
                stage={stage}
                isSelected={stage.key === selectedStageKey}
                onSelect={() => setSelectedStageKey(stage.key)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <StageDetail stage={selectedStage} tasks={selectedStageTasks} events={selectedStageEvents} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TaskSection title="Development Tasks" tasks={data.development_tasks} emptyText="No development tasks found." />
        <TaskSection title="Support Tasks" tasks={data.support_tasks} emptyText="No support tasks found yet." />
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-3 before:absolute before:left-[0.55rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
            {data.events.length ? (
              data.events.map((event, index) => <TimelineEvent key={`${event.type}-${event.title}-${index}`} event={event} />)
            ) : (
              <div className="rounded border p-8 text-center text-sm text-muted-foreground">No lifecycle events found.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const StageCard = ({
  stage,
  isSelected,
  onSelect,
}: {
  stage: LifecycleStage;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const Icon = STAGE_ICONS[stage.key];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={mergeClassNames(
        "rounded border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5",
        isSelected && "border-primary bg-primary/5 shadow-sm"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <Typography variant="p" className="truncate font-medium">
              {stage.label}
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              {stage.count} item{stage.count === 1 ? "" : "s"}
            </Typography>
          </div>
        </div>
        <Badge variant="secondary">{stage.status}</Badge>
      </div>
      <Typography variant="small" className="mt-3 line-clamp-2 text-muted-foreground">
        {stage.description}
      </Typography>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>{formatRange(stage.start, stage.end)}</span>
          <span>{Math.round(stage.progress || 0)}%</span>
        </div>
        <Progress value={stage.progress || 0} className="h-2" />
      </div>
    </button>
  );
};

const StageDetail = ({
  stage,
  tasks,
  events,
}: {
  stage?: LifecycleStage;
  tasks: LifecycleTask[];
  events: LifecycleEvent[];
}) => {
  if (!stage) return null;
  const Icon = STAGE_ICONS[stage.key];

  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              {stage.label} Detail
            </CardTitle>
            <Typography variant="small" className="mt-2 max-w-3xl text-muted-foreground">
              {stage.description}
            </Typography>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{stage.status}</Badge>
            <Badge variant="secondary">{stage.count} item{stage.count === 1 ? "" : "s"}</Badge>
            <Badge variant="secondary">{Math.round(stage.progress || 0)}%</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-4">
        <div className="space-y-4">
          <div className="rounded border p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Stage Progress</span>
              <span className="text-muted-foreground">{formatRange(stage.start, stage.end)}</span>
            </div>
            <Progress value={stage.progress || 0} className="h-2" />
          </div>

          <div className="rounded border">
            <div className="border-b px-3 py-2 text-sm font-medium">Stage Tasks</div>
            <div className="max-h-96 overflow-y-auto p-3">
              {tasks.length ? (
                <div className="space-y-3">
                  {tasks.map((task) => <LifecycleTaskCard key={task.name} task={task} />)}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No direct tasks found for this stage.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded border">
          <div className="border-b px-3 py-2 text-sm font-medium">Stage Timeline</div>
          <div className="max-h-[31rem] overflow-y-auto p-3">
            <div className="relative space-y-3 before:absolute before:left-[0.55rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
              {events.length ? (
                events.map((event, index) => (
                  <TimelineEvent key={`${event.type}-${event.title}-${index}`} event={event} />
                ))
              ) : (
                <div className="rounded border p-8 text-center text-sm text-muted-foreground">
                  No timeline events found for this stage.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const TaskSection = ({ title, tasks, emptyText }: { title: string; tasks: LifecycleTask[]; emptyText: string }) => (
  <Card className="rounded-lg shadow-none">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-3">
        {tasks.length ? (
          tasks.map((task) => <LifecycleTaskCard key={task.name} task={task} />)
        ) : (
          <div className="rounded border p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
        )}
      </div>
    </CardContent>
  </Card>
);

const LifecycleTaskCard = ({ task }: { task: LifecycleTask }) => (
  <div className="rounded border p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Typography variant="p" className="truncate font-medium" title={task.subject || task.name}>
          {task.subject || task.name}
        </Typography>
        <Typography variant="small" className="mt-1 text-muted-foreground">
          {task.name} {task.modified_by_name ? `by ${task.modified_by_name}` : ""}
        </Typography>
      </div>
      <TaskStatus status={task.status} />
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
      <span className="text-muted-foreground">Timeline</span>
      <span className="truncate text-right">{formatRange(task.start, task.end)}</span>
      <span className="text-muted-foreground">Hours</span>
      <span className="text-right">{Number(task.actual_time || 0).toFixed(1)} / {Number(task.expected_time || 0).toFixed(1)}</span>
    </div>
    <div className="mt-3">
      <Progress value={task.progress || 0} className="h-2" />
    </div>
  </div>
);

const TimelineEvent = ({ event }: { event: LifecycleEvent }) => (
  <div className="relative flex gap-3 pl-7">
    <span className="absolute left-0 top-1.5 grid h-5 w-5 place-items-center rounded-full border bg-background">
      <CircleDot className="h-3 w-3 text-primary" />
    </span>
    <div className="flex-1 rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Typography variant="p" className="truncate font-medium">
            {event.title}
          </Typography>
          <Typography variant="small" className="text-muted-foreground">
            {event.type} · {capitalize(event.stage)}
          </Typography>
        </div>
        {event.status && <Badge variant="secondary">{event.status}</Badge>}
      </div>
      {event.date && (
        <Typography variant="small" className="mt-2 text-muted-foreground">
          {formatDate(event.date)}
        </Typography>
      )}
    </div>
  </div>
);

const Metric = ({ icon: Icon, label, value }: { icon: ElementType; label: string; value: number }) => (
  <div className="rounded border p-3">
    <div className="flex items-center justify-between gap-2">
      <Typography variant="small" className="text-muted-foreground">
        {label}
      </Typography>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
    <div className="mt-2 text-2xl font-semibold">{value}</div>
  </div>
);

const ProgressLine = ({ label, value, detail }: { label: string; value: number; detail: string }) => (
  <div>
    <div className="mb-2 flex justify-between text-sm">
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </div>
    <Progress value={value} className="h-2" />
  </div>
);

const DateBlock = ({ label, value }: { label: string; value?: string }) => (
  <div className="rounded border p-2">
    <Typography variant="small" className="text-muted-foreground">
      {label}
    </Typography>
    <Typography variant="small" className="mt-1 truncate font-medium">
      {value ? formatDate(value) : "-"}
    </Typography>
  </div>
);

const LifecycleSkeleton = () => (
  <div className="grid gap-4 p-4">
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-48 w-full" />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
    <Skeleton className="h-96 w-full" />
  </div>
);

const getStageTasks = (
  stage: LifecycleStage["key"],
  developmentTasks: LifecycleTask[],
  supportTasks: LifecycleTask[]
) => {
  if (stage === "development") return developmentTasks;
  if (stage === "support") return supportTasks;
  return [];
};

const formatRange = (start?: string, end?: string) => {
  if (start && end && start !== end) return `${formatDate(start)} - ${formatDate(end)}`;
  if (start) return formatDate(start);
  if (end) return formatDate(end);
  return "-";
};

const percent = (complete: number, total: number) => (total ? Math.round((complete / total) * 100) : 0);

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default ProjectLifecycle;
