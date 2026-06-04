/**
 * External dependencies
 */
import { useEffect, useMemo, useState, type ElementType } from "react";
import { formatDate } from "@next-pms/design-system";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TaskStatus,
  TextArea,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ListChecks,
  Plus,
  Search,
  UserRound,
} from "lucide-react";

/**
 * Internal dependencies
 */
import { TaskLog } from "@/app/pages/task/components/taskLog";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type ProjectTask = {
  name: string;
  subject: string;
  status: string;
  priority?: string;
  expected_time?: number;
  actual_time?: number;
  exp_start_date?: string;
  exp_end_date?: string;
  owner_name?: string;
  modified?: string;
  modified_by_name?: string;
  assigned_user_names?: string[];
  is_overdue?: boolean;
  progress?: number;
};

type StatusCount = {
  status: string;
  count: number;
};

type ProjectTaskResponse = {
  tasks: ProjectTask[];
  status_counts: StatusCount[];
  summary: {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    visible: number;
  };
};

type ProjectTasksProps = {
  projectId?: string;
};

const STATUS_OPTIONS = ["All", "Open", "Working", "Pending Review", "Overdue", "Completed", "Cancelled"];

const ProjectTasks = ({ projectId }: ProjectTasksProps) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [selectedTask, setSelectedTask] = useState("");
  const [isTaskLogOpen, setIsTaskLogOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data, isLoading, error, mutate } = useFrappeGetCall(
    "next_pms.timesheet.api.project.get_project_tasks",
    {
      project: projectId,
      search,
      status,
    },
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

  const payload = data?.message as ProjectTaskResponse | undefined;
  const tasks = payload?.tasks || [];
  const statusSegments = useMemo(() => buildStatusSegments(payload?.status_counts || []), [payload?.status_counts]);

  const openTaskLog = (taskName: string) => {
    setSelectedTask(taskName);
    setIsTaskLogOpen(true);
  };

  if (isLoading || !payload) {
    return <ProjectTasksSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {isTaskLogOpen && (
        <TaskLog
          task={selectedTask}
          isOpen={isTaskLogOpen}
          onOpenChange={(open) => {
            setIsTaskLogOpen(open);
            if (!open) setSelectedTask("");
          }}
        />
      )}
      <CreateTaskDialog
        projectId={projectId}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreated={() => mutate()}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.7fr] gap-4">
        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <Typography variant="small" className="text-muted-foreground">
                  Project Tasks
                </Typography>
                <CardTitle className="mt-1 flex items-center gap-2 text-xl">
                  <ListChecks className="h-5 w-5" />
                  Task Board
                </CardTitle>
              </div>
              <Button className="gap-2" onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New Task
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Metric label="Total" value={payload.summary.total} icon={ListChecks} />
            <Metric label="Completed" value={payload.summary.completed} icon={CheckCircle2} />
            <Metric label="Pending" value={payload.summary.pending} icon={Clock3} />
            <Metric label="Overdue" value={payload.summary.overdue} icon={AlertTriangle} danger />
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <StackedBar segments={statusSegments} total={payload.summary.total} />
            <div className="grid grid-cols-2 gap-2">
              {statusSegments.map((segment) => (
                <div key={segment.label} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={mergeClassNames("h-2.5 w-2.5 shrink-0 rounded-full", segment.color)} />
                    <span className="truncate">{segment.label}</span>
                  </span>
                  <span className="font-medium">{segment.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Tasks</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tasks"
                  className="w-full pl-9 sm:w-64"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {tasks.length ? (
              tasks.map((task) => <TaskCard key={task.name} task={task} onOpen={openTaskLog} />)
            ) : (
              <div className="rounded border p-10 text-center text-sm text-muted-foreground xl:col-span-2">
                No tasks found for this project.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const TaskCard = ({ task, onOpen }: { task: ProjectTask; onOpen: (taskName: string) => void }) => {
  const progress = normalizePercent(task.progress || 0);
  const assignees = task.assigned_user_names || [];

  return (
    <button
      type="button"
      onClick={() => onOpen(task.name)}
      className="rounded border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Typography variant="p" className="truncate font-medium" title={task.subject || task.name}>
            {task.subject || task.name}
          </Typography>
          <Typography variant="small" className="mt-1 text-muted-foreground">
            {task.name}
          </Typography>
        </div>
        <TaskStatus status={task.is_overdue ? "Overdue" : task.status} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoBlock icon={CalendarDays} label="Due" value={task.exp_end_date ? formatDate(task.exp_end_date) : "-"} />
        <InfoBlock icon={Clock3} label="Hours" value={`${Number(task.actual_time || 0).toFixed(1)} / ${Number(task.expected_time || 0).toFixed(1)}`} />
        <InfoBlock icon={UserRound} label="Owner" value={task.owner_name || "-"} />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {task.priority && <Badge variant="secondary">{task.priority}</Badge>}
        {assignees.slice(0, 3).map((user) => (
          <Badge key={user} variant="secondary">
            {user}
          </Badge>
        ))}
        {assignees.length > 3 && <Badge variant="secondary">+{assignees.length - 3}</Badge>}
        {task.modified && (
          <Typography variant="small" className="ml-auto text-muted-foreground">
            Updated {formatDate(task.modified)}
          </Typography>
        )}
      </div>
    </button>
  );
};

const CreateTaskDialog = ({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) => {
  const { toast } = useToast();
  const { call } = useFrappePostCall("next_pms.timesheet.api.task.add_task");
  const [subject, setSubject] = useState("");
  const [expectedTime, setExpectedTime] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setSubject("");
    setExpectedTime("");
    setDescription("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const handleSubmit = () => {
    if (!projectId || !subject.trim()) return;
    setIsSubmitting(true);
    call({
      subject: subject.trim(),
      expected_time: expectedTime.trim() || "0",
      project: projectId,
      description: description.trim(),
    })
      .then((res) => {
        toast({
          variant: "success",
          description: res.message,
        });
        reset();
        onOpenChange(false);
        onCreated();
      })
      .catch((err) => {
        toast({
          variant: "destructive",
          description: parseFrappeErrorMsg(err),
        });
      })
      .finally(() => setIsSubmitting(false));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-description="" aria-describedby="" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Typography variant="small" className="font-medium">
              Subject
            </Typography>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Task subject" />
          </div>
          <div className="grid gap-1.5">
            <Typography variant="small" className="font-medium">
              Expected Time
            </Typography>
            <Input
              value={expectedTime}
              onChange={(event) => setExpectedTime(event.target.value)}
              placeholder="Hours"
              type="number"
              min="0"
              step="0.25"
            />
          </div>
          <div className="grid gap-1.5">
            <Typography variant="small" className="font-medium">
              Description
            </Typography>
            <TextArea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add task details"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !subject.trim()}>
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Metric = ({
  label,
  value,
  icon: Icon,
  danger,
}: {
  label: string;
  value: number;
  icon: ElementType;
  danger?: boolean;
}) => (
  <div className="rounded border p-3">
    <div className="flex items-center justify-between gap-2">
      <Typography variant="small" className="text-muted-foreground">
        {label}
      </Typography>
      <Icon className={mergeClassNames("h-4 w-4 text-muted-foreground", danger && "text-destructive")} />
    </div>
    <div className="mt-2 text-2xl font-semibold">{value}</div>
  </div>
);

const InfoBlock = ({
  icon: Icon,
  label,
  value,
}: {
  icon: ElementType;
  label: string;
  value: string;
}) => (
  <div className="min-w-0 rounded border bg-muted/20 p-2">
    <Typography variant="small" className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Typography>
    <Typography variant="small" className="mt-1 truncate font-medium" title={value}>
      {value}
    </Typography>
  </div>
);

const StackedBar = ({
  segments,
  total,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  total: number;
}) => (
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

const ProjectTasksSkeleton = () => (
  <div className="grid gap-4 p-4">
    <Skeleton className="h-36 w-full" />
    <Skeleton className="h-20 w-full" />
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  </div>
);

const buildStatusSegments = (items: StatusCount[]) => {
  const colors = ["bg-primary", "bg-amber-500", "bg-blue-500", "bg-success", "bg-destructive", "bg-slate-400"];
  return items.length
    ? items.map((item, index) => ({
        label: item.status || "Not Set",
        value: Number(item.count || 0),
        color: colors[index % colors.length],
      }))
    : [{ label: "No Tasks", value: 0, color: "bg-slate-300" }];
};

const normalizePercent = (value: number) => Math.max(0, Math.min(100, Math.round(Number(value || 0))));

export default ProjectTasks;
