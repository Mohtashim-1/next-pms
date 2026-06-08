/**
 * External dependencies.
 */
import { useMemo, useState } from "react";
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
  ChevronDown,
  ChevronRight,
  Flag,
  GitBranch,
  Layers,
  ListTree,
  Plus,
  Receipt,
} from "lucide-react";

/**
 * Internal dependencies.
 */
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type StructureTask = {
  name: string;
  subject: string;
  status: string;
  level: "task" | "subtask";
  subtasks?: StructureTask[];
};

type StructurePhase = {
  name: string;
  phase_name: string;
  status: string;
  start_date?: string;
  end_date?: string;
  sequence?: number;
  depends_on?: Array<{ depends_on_phase: string; dependency_type: string }>;
  tasks: StructureTask[];
};

type StructureMilestone = {
  name?: string;
  milestone_name: string;
  milestone_date: string;
  status: string;
  phase?: string;
  billing_trigger?: number;
  billing_amount?: number;
  billing_percentage?: number;
  billing_status?: string;
  sales_invoice?: string;
};

type StructureResponse = {
  phases: StructurePhase[];
  unassigned_tasks: StructureTask[];
  milestones: StructureMilestone[];
};

const PHASE_STATUSES = ["Planned", "In Progress", "Completed", "On Hold", "Cancelled"];
const MILESTONE_STATUSES = ["Planned", "Achieved", "Missed", "Cancelled"];

const billingBadgeClass = (status?: string) => {
  switch (status) {
    case "Invoiced":
      return "bg-success/20";
    case "Ready to Invoice":
      return "bg-sky-100/90 dark:bg-sky-950/50";
    case "Skipped":
      return "bg-muted";
    default:
      return "bg-amber-100/80 dark:bg-amber-950/40";
  }
};

const TaskNode = ({ task, depth = 0 }: { task: StructureTask; depth?: number }) => (
  <div className={mergeClassNames("space-y-1", depth > 0 && "ml-5 border-l pl-3")}>
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <ListTree className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="font-medium truncate">{task.subject}</span>
      <TaskStatus status={task.status} />
    </div>
    {task.subtasks?.map((subtask) => (
      <TaskNode key={subtask.name} task={subtask} depth={depth + 1} />
    ))}
  </div>
);

const ProjectStructure = ({ projectId }: { projectId?: string }) => {
  const { toast } = useToast();
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({});
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [phaseForm, setPhaseForm] = useState({
    phase_name: "",
    status: "Planned",
    start_date: "",
    end_date: "",
    sequence: "0",
    description: "",
  });
  const [milestoneForm, setMilestoneForm] = useState({
    milestone_name: "",
    milestone_date: "",
    status: "Planned",
    phase: "",
    billing_trigger: false,
    billing_amount: "",
    billing_percentage: "",
  });

  const { data, isLoading, mutate } = useFrappeGetCall(
    projectId ? "next_pms.next_pms.api.project_structure.get_structure" : null,
    projectId ? { project: projectId } : undefined
  );

  const { call: savePhase, loading: savingPhase } = useFrappePostCall(
    "next_pms.next_pms.api.project_structure.save_phase"
  );
  const { call: saveMilestone, loading: savingMilestone } = useFrappePostCall(
    "next_pms.next_pms.api.project_structure.save_milestone"
  );
  const { call: updateMilestoneStatus } = useFrappePostCall(
    "next_pms.next_pms.api.project_structure.update_milestone_status"
  );

  const structure = data?.message as StructureResponse | undefined;

  const phaseNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    structure?.phases?.forEach((phase) => {
      map[phase.name] = phase.phase_name;
    });
    return map;
  }, [structure?.phases]);

  const togglePhase = (phaseName: string) => {
    setExpandedPhases((prev) => ({ ...prev, [phaseName]: !prev[phaseName] }));
  };

  const handleCreatePhase = () => {
    if (!projectId) return;
    savePhase({
      phase: JSON.stringify({
        project: projectId,
        ...phaseForm,
        sequence: Number(phaseForm.sequence || 0),
      }),
    })
      .then(() => {
        toast({ variant: "success", description: "Phase created." });
        setPhaseDialogOpen(false);
        setPhaseForm({
          phase_name: "",
          status: "Planned",
          start_date: "",
          end_date: "",
          sequence: "0",
          description: "",
        });
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleCreateMilestone = () => {
    if (!projectId) return;
    saveMilestone({
      milestone: JSON.stringify({
        project: projectId,
        milestone_name: milestoneForm.milestone_name,
        milestone_date: milestoneForm.milestone_date,
        status: milestoneForm.status,
        phase: milestoneForm.phase || undefined,
        billing_trigger: milestoneForm.billing_trigger ? 1 : 0,
        billing_amount: milestoneForm.billing_amount ? Number(milestoneForm.billing_amount) : undefined,
        billing_percentage: milestoneForm.billing_percentage
          ? Number(milestoneForm.billing_percentage)
          : undefined,
      }),
    })
      .then(() => {
        toast({ variant: "success", description: "Milestone created." });
        setMilestoneDialogOpen(false);
        setMilestoneForm({
          milestone_name: "",
          milestone_date: "",
          status: "Planned",
          phase: "",
          billing_trigger: false,
          billing_amount: "",
          billing_percentage: "",
        });
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleMilestoneStatus = (name: string, status: string) => {
    updateMilestoneStatus({ name, status })
      .then((response) => {
        toast({ variant: "success", description: `Milestone marked ${status}.` });
        mutate(response.message, false);
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setPhaseDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Phase
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMilestoneDialogOpen(true)}>
          <Flag className="h-4 w-4 mr-1" />
          Add Milestone
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            Project Hierarchy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {structure?.phases?.length ? (
            structure.phases.map((phase) => {
              const expanded = expandedPhases[phase.name] ?? true;
              return (
                <div key={phase.name} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                    onClick={() => togglePhase(phase.name)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="font-medium truncate">{phase.phase_name}</span>
                      <Badge variant="outline">{phase.status}</Badge>
                    </div>
                    <Typography variant="small" className="text-muted-foreground shrink-0">
                      {phase.start_date ? formatDate(phase.start_date) : "—"} –{" "}
                      {phase.end_date ? formatDate(phase.end_date) : "—"}
                    </Typography>
                  </button>

                  {expanded && (
                    <div className="space-y-3 border-t px-3 py-3">
                      {phase.depends_on?.length ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <GitBranch className="h-3.5 w-3.5" />
                          Depends on:
                          {phase.depends_on.map((dependency) => (
                            <Badge key={`${phase.name}-${dependency.depends_on_phase}`} variant="outline">
                              {phaseNameMap[dependency.depends_on_phase] || dependency.depends_on_phase} (
                              {dependency.dependency_type})
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {phase.tasks?.length ? (
                        phase.tasks.map((task) => <TaskNode key={task.name} task={task} />)
                      ) : (
                        <Typography variant="small" className="text-muted-foreground">
                          No tasks in this phase yet.
                        </Typography>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <Typography variant="small" className="text-muted-foreground">
              No phases defined. Add a phase to organize tasks.
            </Typography>
          )}

          {structure?.unassigned_tasks?.length ? (
            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <Typography variant="small" className="font-medium">
                Unassigned tasks
              </Typography>
              {structure.unassigned_tasks.map((task) => (
                <TaskNode key={task.name} task={task} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flag className="h-4 w-4" />
            Milestones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {structure?.milestones?.length ? (
            structure.milestones.map((milestone) => (
              <div
                key={milestone.name || milestone.milestone_name}
                className="flex flex-col gap-2 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{milestone.milestone_name}</span>
                    <Badge variant="outline">{milestone.status}</Badge>
                    {milestone.billing_trigger ? (
                      <Badge className={billingBadgeClass(milestone.billing_status)}>
                        <Receipt className="h-3 w-3 mr-1" />
                        {milestone.billing_status || "Pending"}
                      </Badge>
                    ) : null}
                  </div>
                  <Typography variant="small" className="text-muted-foreground">
                    {formatDate(milestone.milestone_date)}
                    {milestone.phase ? ` · ${phaseNameMap[milestone.phase] || milestone.phase}` : ""}
                    {milestone.sales_invoice ? ` · Invoice ${milestone.sales_invoice}` : ""}
                  </Typography>
                </div>
                {milestone.name && milestone.status !== "Achieved" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMilestoneStatus(milestone.name!, "Achieved")}
                  >
                    Mark Achieved
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <Typography variant="small" className="text-muted-foreground">
              No milestones yet.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Dialog open={phaseDialogOpen} onOpenChange={setPhaseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Phase</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Phase name"
              value={phaseForm.phase_name}
              onChange={(event) => setPhaseForm((prev) => ({ ...prev, phase_name: event.target.value }))}
            />
            <Select
              value={phaseForm.status}
              onValueChange={(value) => setPhaseForm((prev) => ({ ...prev, status: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHASE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={phaseForm.start_date}
                onChange={(event) => setPhaseForm((prev) => ({ ...prev, start_date: event.target.value }))}
              />
              <Input
                type="date"
                value={phaseForm.end_date}
                onChange={(event) => setPhaseForm((prev) => ({ ...prev, end_date: event.target.value }))}
              />
            </div>
            <TextArea
              placeholder="Description"
              value={phaseForm.description}
              onChange={(event) => setPhaseForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCreatePhase} disabled={savingPhase || !phaseForm.phase_name}>
              Save Phase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={milestoneDialogOpen} onOpenChange={setMilestoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Milestone name"
              value={milestoneForm.milestone_name}
              onChange={(event) =>
                setMilestoneForm((prev) => ({ ...prev, milestone_name: event.target.value }))
              }
            />
            <Input
              type="date"
              value={milestoneForm.milestone_date}
              onChange={(event) =>
                setMilestoneForm((prev) => ({ ...prev, milestone_date: event.target.value }))
              }
            />
            <Select
              value={milestoneForm.phase || "none"}
              onValueChange={(value) =>
                setMilestoneForm((prev) => ({ ...prev, phase: value === "none" ? "" : value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Link to phase (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No phase</SelectItem>
                {structure?.phases?.map((phase) => (
                  <SelectItem key={phase.name} value={phase.name}>
                    {phase.phase_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={milestoneForm.billing_trigger}
                onChange={(event) =>
                  setMilestoneForm((prev) => ({ ...prev, billing_trigger: event.target.checked }))
                }
              />
              Trigger billing when achieved
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Billing amount"
                value={milestoneForm.billing_amount}
                onChange={(event) =>
                  setMilestoneForm((prev) => ({ ...prev, billing_amount: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="Billing %"
                value={milestoneForm.billing_percentage}
                onChange={(event) =>
                  setMilestoneForm((prev) => ({ ...prev, billing_percentage: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreateMilestone}
              disabled={savingMilestone || !milestoneForm.milestone_name || !milestoneForm.milestone_date}
            >
              Save Milestone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectStructure;
