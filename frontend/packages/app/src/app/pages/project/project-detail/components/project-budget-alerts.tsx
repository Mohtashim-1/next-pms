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
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  TextArea,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Bell, BellOff, RefreshCw, Settings2 } from "lucide-react";

/**
 * Internal dependencies.
 */
import { parseFrappeErrorMsg } from "@/lib/utils";

type BudgetAlert = {
  name: string;
  scope_label?: string;
  utilization_metric?: string;
  threshold_pct?: number;
  utilization_pct?: number;
  status?: string;
  recommended_action?: string;
  snoozed_until?: string;
  snooze_reason?: string;
  action_taken?: string;
  action_notes?: string;
  message?: string;
  creation?: string;
};

type AlertSettings = {
  enabled?: boolean;
  thresholds?: number[];
  channels?: {
    email?: boolean;
    in_app?: boolean;
    slack?: boolean;
    teams?: boolean;
  };
  has_slack_webhook?: boolean;
  has_teams_webhook?: boolean;
};

type AlertsResponse = {
  alerts: BudgetAlert[];
  settings: AlertSettings;
};

const THRESHOLD_OPTIONS = [50, 75, 90, 100, 110];

const statusVariant = (status?: string) => {
  if (status === "Snoozed") return "secondary";
  if (status === "Actioned" || status === "Acknowledged") return "outline";
  if (status === "Closed") return "outline";
  return "destructive";
};

const ProjectBudgetAlerts = ({ projectId }: { projectId?: string }) => {
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState<BudgetAlert | null>(null);
  const [actionOpen, setActionOpen] = useState<BudgetAlert | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [selectedAction, setSelectedAction] = useState("Escalate");
  const [settingsForm, setSettingsForm] = useState({
    enabled: true,
    thresholds: THRESHOLD_OPTIONS,
    channel_email: true,
    channel_in_app: true,
    channel_slack: false,
    channel_teams: false,
    slack_webhook: "",
    teams_webhook: "",
  });

  const { data, isLoading, mutate } = useFrappeGetCall(
    projectId ? "next_pms.next_pms.api.budget_alerts.get_alerts" : null,
    projectId ? { project: projectId } : undefined
  );

  const { call: saveSettings, loading: savingSettings } = useFrappePostCall(
    "next_pms.next_pms.api.budget_alerts.save_alert_settings"
  );
  const { call: snoozeAlert, loading: snoozing } = useFrappePostCall(
    "next_pms.next_pms.api.budget_alerts.snooze_alert"
  );
  const { call: executeAction, loading: executing } = useFrappePostCall(
    "next_pms.next_pms.api.budget_alerts.execute_action"
  );
  const { call: evaluateNow, loading: evaluating } = useFrappePostCall(
    "next_pms.next_pms.api.budget_alerts.evaluate_now"
  );

  const response = data?.message as AlertsResponse | undefined;
  const alerts = response?.alerts ?? [];
  const settings = response?.settings;

  const openAlerts = useMemo(
    () => alerts.filter((alert) => alert.status !== "Closed"),
    [alerts]
  );

  const openSettings = () => {
    setSettingsForm({
      enabled: settings?.enabled ?? true,
      thresholds: settings?.thresholds?.length ? settings.thresholds : THRESHOLD_OPTIONS,
      channel_email: settings?.channels?.email ?? true,
      channel_in_app: settings?.channels?.in_app ?? true,
      channel_slack: settings?.channels?.slack ?? false,
      channel_teams: settings?.channels?.teams ?? false,
      slack_webhook: "",
      teams_webhook: "",
    });
    setSettingsOpen(true);
  };

  const toggleThreshold = (value: number) => {
    setSettingsForm((prev) => {
      const exists = prev.thresholds.includes(value);
      return {
        ...prev,
        thresholds: exists
          ? prev.thresholds.filter((threshold) => threshold !== value)
          : [...prev.thresholds, value].sort((a, b) => a - b),
      };
    });
  };

  const handleSaveSettings = () => {
    if (!projectId) return;
    saveSettings({
      project: projectId,
      settings: JSON.stringify({
        enabled: settingsForm.enabled,
        thresholds: settingsForm.thresholds,
        channel_email: settingsForm.channel_email,
        channel_in_app: settingsForm.channel_in_app,
        channel_slack: settingsForm.channel_slack,
        channel_teams: settingsForm.channel_teams,
        slack_webhook: settingsForm.slack_webhook || undefined,
        teams_webhook: settingsForm.teams_webhook || undefined,
      }),
    })
      .then(() => {
        toast({ variant: "success", description: "Alert settings saved." });
        setSettingsOpen(false);
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleSnooze = () => {
    if (!snoozeOpen || !snoozeUntil) {
      toast({ variant: "destructive", description: "Snooze until date is required." });
      return;
    }
    snoozeAlert({
      alert: snoozeOpen.name,
      snooze_until: snoozeUntil,
      reason: snoozeReason,
    })
      .then(() => {
        toast({ variant: "success", description: "Alert snoozed." });
        setSnoozeOpen(null);
        setSnoozeUntil("");
        setSnoozeReason("");
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleAction = () => {
    if (!actionOpen) return;
    executeAction({
      alert: actionOpen.name,
      action: selectedAction,
      notes: actionNotes,
    })
      .then(() => {
        toast({ variant: "success", description: `${selectedAction} recorded.` });
        setActionOpen(null);
        setActionNotes("");
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleEvaluate = () => {
    if (!projectId) return;
    evaluateNow({ project: projectId })
      .then((result) => {
        const created = (result?.message as { created?: string[] })?.created?.length ?? 0;
        toast({
          variant: "success",
          description: created ? `${created} new alert(s) created.` : "No new alerts.",
        });
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Budget Alerts
            {openAlerts.length ? (
              <Badge variant="destructive">{openAlerts.length}</Badge>
            ) : null}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleEvaluate} disabled={evaluating}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Check Now
            </Button>
            <Button size="sm" variant="outline" onClick={openSettings}>
              <Settings2 className="h-4 w-4 mr-1" />
              Settings
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {!settings?.enabled ? (
            <Typography variant="small" className="text-muted-foreground flex items-center gap-2">
              <BellOff className="h-4 w-4" />
              Budget alerts are disabled for this project.
            </Typography>
          ) : null}

          {openAlerts.length ? (
            openAlerts.map((alert) => (
              <div key={alert.name} className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{alert.scope_label}</span>
                    <Badge variant="outline">{alert.utilization_metric}</Badge>
                    <Badge variant="outline">{alert.threshold_pct}% threshold</Badge>
                    <Badge variant={statusVariant(alert.status)}>{alert.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {alert.status !== "Actioned" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedAction(alert.recommended_action || "Escalate");
                          setActionOpen(alert);
                        }}
                      >
                        {alert.recommended_action || "Take Action"}
                      </Button>
                    ) : null}
                    {alert.status !== "Snoozed" && alert.status !== "Actioned" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const nextWeek = new Date();
                          nextWeek.setDate(nextWeek.getDate() + 7);
                          setSnoozeUntil(nextWeek.toISOString().slice(0, 16));
                          setSnoozeOpen(alert);
                        }}
                      >
                        Snooze
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Typography variant="small" className="text-muted-foreground">
                  {alert.utilization_pct}% utilized — {alert.message}
                </Typography>
                {alert.snoozed_until ? (
                  <Typography variant="small" className="text-muted-foreground">
                    Snoozed until {alert.snoozed_until}
                    {alert.snooze_reason ? ` — ${alert.snooze_reason}` : ""}
                  </Typography>
                ) : null}
                {alert.action_taken ? (
                  <Typography variant="small" className="text-muted-foreground">
                    Action: {alert.action_taken}
                    {alert.action_notes ? ` — ${alert.action_notes}` : ""}
                  </Typography>
                ) : null}
              </div>
            ))
          ) : (
            <Typography variant="small" className="text-muted-foreground">
              No active budget alerts. Thresholds: {(settings?.thresholds ?? THRESHOLD_OPTIONS).join("%, ")}%.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Budget Alert Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settingsForm.enabled}
                onCheckedChange={(checked) =>
                  setSettingsForm((prev) => ({ ...prev, enabled: Boolean(checked) }))
                }
              />
              Enable budget alerts for this project
            </label>

            <div>
              <Typography variant="small" className="text-muted-foreground mb-2">
                Thresholds (%)
              </Typography>
              <div className="flex flex-wrap gap-2">
                {THRESHOLD_OPTIONS.map((threshold) => (
                  <label key={threshold} className="flex items-center gap-1 text-sm border rounded px-2 py-1">
                    <Checkbox
                      checked={settingsForm.thresholds.includes(threshold)}
                      onCheckedChange={() => toggleThreshold(threshold)}
                    />
                    {threshold}%
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                ["channel_email", "Email"],
                ["channel_in_app", "In-App"],
                ["channel_slack", "Slack"],
                ["channel_teams", "Teams"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={settingsForm[key as keyof typeof settingsForm] as boolean}
                    onCheckedChange={(checked) =>
                      setSettingsForm((prev) => ({ ...prev, [key]: Boolean(checked) }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>

            <Input
              placeholder={settings?.has_slack_webhook ? "Slack webhook (leave blank to keep)" : "Slack webhook URL"}
              value={settingsForm.slack_webhook}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, slack_webhook: event.target.value }))}
            />
            <Input
              placeholder={settings?.has_teams_webhook ? "Teams webhook (leave blank to keep)" : "Teams webhook URL"}
              value={settingsForm.teams_webhook}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, teams_webhook: event.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(snoozeOpen)} onOpenChange={(open) => !open && setSnoozeOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Snooze Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="datetime-local"
              value={snoozeUntil}
              onChange={(event) => setSnoozeUntil(event.target.value)}
            />
            <TextArea
              placeholder="Reason (optional)"
              value={snoozeReason}
              onChange={(event) => setSnoozeReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleSnooze} disabled={snoozing}>
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(actionOpen)} onOpenChange={(open) => !open && setActionOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alert Action</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {["Notify Client", "Request Change Order", "Escalate"].map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={selectedAction === action ? "default" : "outline"}
                  onClick={() => setSelectedAction(action)}
                >
                  {action}
                </Button>
              ))}
            </div>
            <TextArea
              placeholder="Notes (optional)"
              value={actionNotes}
              onChange={(event) => setActionNotes(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleAction} disabled={executing}>
              Confirm Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectBudgetAlerts;
