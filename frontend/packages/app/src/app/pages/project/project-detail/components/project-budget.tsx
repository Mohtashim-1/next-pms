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
  TextArea,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { DollarSign, History, Plus, Trash2 } from "lucide-react";

/**
 * Internal dependencies.
 */
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";
import ProjectBudgetAlerts from "./project-budget-alerts";
import ProjectBudgetBurn from "./project-budget-burn";

type BudgetAllocation = {
  name: string;
  scope_type: "Total" | "Phase" | "Task";
  project_phase?: string;
  task?: string;
  phase_name?: string;
  task_subject?: string;
  allocation_type: "Billable" | "Non-Billable";
  metric_type: "Hours" | "Dollars" | "Both";
  budget_hours?: number;
  budget_amount?: number;
  consumed_hours?: number;
  consumed_amount?: number;
  remaining_hours?: number;
  remaining_amount?: number;
  utilization_hours_pct?: number;
  utilization_amount_pct?: number;
  notes?: string;
};

type BudgetAuditLog = {
  name: string;
  budget_allocation?: string;
  action: string;
  changed_by?: string;
  changed_on?: string;
  change_reason?: string;
};

type BudgetViewResponse = {
  allocations: BudgetAllocation[];
  audit_logs: BudgetAuditLog[];
  summary: Record<string, number>;
};

const defaultForm = {
  scope_type: "Total",
  project_phase: "",
  task: "",
  allocation_type: "Billable",
  metric_type: "Both",
  budget_hours: "",
  budget_amount: "",
  notes: "",
  change_reason: "",
};

const utilizationClass = (pct: number) => {
  if (pct >= 100) return "text-destructive";
  if (pct >= 80) return "text-amber-600";
  return "text-foreground";
};

const ProjectBudget = ({ projectId }: { projectId?: string }) => {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetAllocation | null>(null);
  const [form, setForm] = useState(defaultForm);

  const { data: structureData } = useFrappeGetCall(
    projectId ? "next_pms.next_pms.api.project_structure.get_structure" : null,
    projectId ? { project: projectId } : undefined
  );

  const { data, isLoading, mutate } = useFrappeGetCall(
    projectId ? "next_pms.next_pms.api.project_budget.get_budget_view" : null,
    projectId ? { project: projectId } : undefined
  );

  const { call: saveAllocation, loading: saving } = useFrappePostCall(
    "next_pms.next_pms.api.project_budget.save_budget_allocation"
  );
  const { call: deleteAllocation, loading: deleting } = useFrappePostCall(
    "next_pms.next_pms.api.project_budget.delete_budget_allocation"
  );

  const view = data?.message as BudgetViewResponse | undefined;
  const phases = structureData?.message?.phases ?? [];

  const taskOptions = useMemo(() => {
    const tasks: Array<{ name: string; subject: string }> = [];
    phases.forEach((phase: { tasks?: Array<{ name: string; subject: string; subtasks?: Array<{ name: string; subject: string }> }> }) => {
      phase.tasks?.forEach((task) => {
        tasks.push({ name: task.name, subject: task.subject });
        task.subtasks?.forEach((subtask) => tasks.push({ name: subtask.name, subject: subtask.subject }));
      });
    });
    structureData?.message?.unassigned_tasks?.forEach((task: { name: string; subject: string; subtasks?: Array<{ name: string; subject: string }> }) => {
      tasks.push({ name: task.name, subject: task.subject });
      task.subtasks?.forEach((subtask) => tasks.push({ name: subtask.name, subject: subtask.subject }));
    });
    return tasks;
  }, [phases, structureData?.message?.unassigned_tasks]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (allocation: BudgetAllocation) => {
    setEditing(allocation);
    setForm({
      scope_type: allocation.scope_type,
      project_phase: allocation.project_phase || "",
      task: allocation.task || "",
      allocation_type: allocation.allocation_type,
      metric_type: allocation.metric_type,
      budget_hours: allocation.budget_hours?.toString() || "",
      budget_amount: allocation.budget_amount?.toString() || "",
      notes: allocation.notes || "",
      change_reason: "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!projectId || !form.change_reason.trim()) {
      toast({ variant: "destructive", description: "Change reason is required." });
      return;
    }

    saveAllocation({
      allocation: JSON.stringify({
        name: editing?.name,
        project: projectId,
        scope_type: form.scope_type,
        project_phase: form.scope_type === "Phase" ? form.project_phase : undefined,
        task: form.scope_type === "Task" ? form.task : undefined,
        allocation_type: form.allocation_type,
        metric_type: form.metric_type,
        budget_hours: form.metric_type !== "Dollars" ? Number(form.budget_hours || 0) : 0,
        budget_amount: form.metric_type !== "Hours" ? Number(form.budget_amount || 0) : 0,
        notes: form.notes,
      }),
      change_reason: form.change_reason,
    })
      .then(() => {
        toast({ variant: "success", description: "Budget saved." });
        setDialogOpen(false);
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleDelete = (allocation: BudgetAllocation) => {
    const reason = window.prompt("Reason for deleting this budget limit:");
    if (!reason?.trim()) return;

    deleteAllocation({ name: allocation.name, change_reason: reason })
      .then(() => {
        toast({ variant: "success", description: "Budget allocation deleted." });
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const scopeLabel = (allocation: BudgetAllocation) => {
    if (allocation.scope_type === "Phase") return allocation.phase_name || allocation.project_phase;
    if (allocation.scope_type === "Task") return allocation.task_subject || allocation.task;
    return "Project Total";
  };

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4 p-4">
      <ProjectBudgetBurn projectId={projectId} />
      <ProjectBudgetAlerts projectId={projectId} />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add Budget Limit
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Billable Hours", view?.summary?.billable_hours_consumed, view?.summary?.billable_hours_budget],
          ["Non-Billable Hours", view?.summary?.non_billable_hours_consumed, view?.summary?.non_billable_hours_budget],
          ["Billable $", view?.summary?.billable_amount_consumed, view?.summary?.billable_amount_budget],
          ["Non-Billable $", view?.summary?.non_billable_amount_consumed, view?.summary?.non_billable_amount_budget],
        ].map(([label, consumed, budget]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <Typography variant="small" className="text-muted-foreground">
                {label}
              </Typography>
              <Typography variant="p" className="font-semibold">
                {consumed ?? 0} / {budget ?? 0}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4" />
            Budget Limits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {view?.allocations?.length ? (
            view.allocations.map((allocation) => (
              <div key={allocation.name} className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{scopeLabel(allocation)}</span>
                    <Badge variant="outline">{allocation.scope_type}</Badge>
                    <Badge variant="outline">{allocation.allocation_type}</Badge>
                    <Badge variant="outline">{allocation.metric_type}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(allocation)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleting}
                      onClick={() => handleDelete(allocation)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  {allocation.metric_type !== "Dollars" && (
                    <div>
                      Hours: {allocation.consumed_hours} / {allocation.budget_hours}
                      <span className={mergeClassNames("ml-2", utilizationClass(allocation.utilization_hours_pct || 0))}>
                        ({allocation.utilization_hours_pct}%)
                      </span>
                    </div>
                  )}
                  {allocation.metric_type !== "Hours" && (
                    <div>
                      Amount: {allocation.consumed_amount} / {allocation.budget_amount}
                      <span className={mergeClassNames("ml-2", utilizationClass(allocation.utilization_amount_pct || 0))}>
                        ({allocation.utilization_amount_pct}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <Typography variant="small" className="text-muted-foreground">
              No budget limits configured yet.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {view?.audit_logs?.length ? (
            view.audit_logs.map((log) => (
              <div key={log.name} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{log.action}</Badge>
                  <span>{log.changed_by}</span>
                  <span className="text-muted-foreground">{log.changed_on}</span>
                </div>
                {log.change_reason ? (
                  <Typography variant="small" className="text-muted-foreground mt-1">
                    {log.change_reason}
                  </Typography>
                ) : null}
              </div>
            ))
          ) : (
            <Typography variant="small" className="text-muted-foreground">
              Budget changes will appear here with reasons.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Budget Limit" : "Add Budget Limit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={form.scope_type} onValueChange={(value) => setForm((prev) => ({ ...prev, scope_type: value }))}>
              <SelectTrigger><SelectValue placeholder="Scope" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Total">Total (Project)</SelectItem>
                <SelectItem value="Phase">Phase</SelectItem>
                <SelectItem value="Task">Task</SelectItem>
              </SelectContent>
            </Select>

            {form.scope_type === "Phase" && (
              <Select
                value={form.project_phase || "none"}
                onValueChange={(value) => setForm((prev) => ({ ...prev, project_phase: value === "none" ? "" : value }))}
              >
                <SelectTrigger><SelectValue placeholder="Select phase" /></SelectTrigger>
                <SelectContent>
                  {phases.map((phase: { name: string; phase_name: string }) => (
                    <SelectItem key={phase.name} value={phase.name}>{phase.phase_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {form.scope_type === "Task" && (
              <Select
                value={form.task || "none"}
                onValueChange={(value) => setForm((prev) => ({ ...prev, task: value === "none" ? "" : value }))}
              >
                <SelectTrigger><SelectValue placeholder="Select task" /></SelectTrigger>
                <SelectContent>
                  {taskOptions.map((task) => (
                    <SelectItem key={task.name} value={task.name}>{task.subject}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Select
                value={form.allocation_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, allocation_type: value }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Billable">Billable</SelectItem>
                  <SelectItem value="Non-Billable">Non-Billable</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={form.metric_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, metric_type: value }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hours">Hours</SelectItem>
                  <SelectItem value="Dollars">Dollars</SelectItem>
                  <SelectItem value="Both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.metric_type !== "Dollars" && (
              <Input
                type="number"
                placeholder="Budget hours"
                value={form.budget_hours}
                onChange={(event) => setForm((prev) => ({ ...prev, budget_hours: event.target.value }))}
              />
            )}
            {form.metric_type !== "Hours" && (
              <Input
                type="number"
                placeholder="Budget amount"
                value={form.budget_amount}
                onChange={(event) => setForm((prev) => ({ ...prev, budget_amount: event.target.value }))}
              />
            )}

            <TextArea
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
            <TextArea
              placeholder="Change reason (required)"
              value={form.change_reason}
              onChange={(event) => setForm((prev) => ({ ...prev, change_reason: event.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={saving}>
              Save Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectBudget;
