/**
 * External dependencies.
 */
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Skeleton,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { CalendarClock, Copy, Flame, Link2, Mail, TrendingUp } from "lucide-react";

/**
 * Internal dependencies.
 */
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type Comparison = {
  target: number;
  actual: number;
  variance: number;
  variance_pct: number;
  utilization_pct: number;
  remaining: number;
};

type BurnMetrics = {
  project_name?: string;
  currency?: string;
  as_of_date?: string;
  projected_finish_date?: string;
  schedule_variance_days?: number | null;
  burn_to_date?: { amount: number; hours: number };
  burn_rate?: { daily: number; weekly: number; monthly: number };
  budget_total?: number;
  baseline_total?: number;
  vs_budget?: Comparison;
  vs_baseline?: Comparison;
  weekly_report_enabled?: boolean;
  weekly_email_team?: boolean;
  weekly_email_client?: boolean;
  share?: {
    enabled?: boolean;
    share_url?: string | null;
    expires_on?: string | null;
    last_emailed_on?: string | null;
  };
};

const varianceClass = (pct: number) => {
  if (pct >= 100) return "text-destructive";
  if (pct >= 80) return "text-amber-600";
  return "text-emerald-600";
};

const ComparisonRow = ({ label, data, currency }: { label: string; data?: Comparison; currency?: string }) => {
  if (!data) return null;
  return (
    <div className="rounded-md border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Typography variant="small" className="font-medium">
          {label}
        </Typography>
        <Badge variant="outline">{data.utilization_pct}% used</Badge>
      </div>
      <Typography variant="small" className="text-muted-foreground">
        {data.actual} / {data.target} {currency}
      </Typography>
      <Typography variant="small" className={mergeClassNames("font-medium", varianceClass(data.utilization_pct))}>
        {data.variance >= 0 ? "+" : ""}
        {data.variance} {currency} ({data.variance_pct}%)
      </Typography>
      <Typography variant="small" className="text-muted-foreground">
        Remaining: {data.remaining} {currency}
      </Typography>
    </div>
  );
};

const ProjectBudgetBurn = ({ projectId }: { projectId?: string }) => {
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    weekly_report_enabled: false,
    weekly_email_team: true,
    weekly_email_client: false,
    baseline_amount: "",
  });

  const { data, isLoading, mutate } = useFrappeGetCall(
    projectId ? "next_pms.next_pms.api.budget_burn.get_burn_view" : null,
    projectId ? { project: projectId } : undefined
  );

  const { call: saveSettings, loading: savingSettings } = useFrappePostCall(
    "next_pms.next_pms.api.budget_burn.save_report_settings"
  );
  const { call: enableShare, loading: enablingShare } = useFrappePostCall(
    "next_pms.next_pms.api.budget_burn.enable_share"
  );
  const { call: disableShare, loading: disablingShare } = useFrappePostCall(
    "next_pms.next_pms.api.budget_burn.disable_share"
  );
  const { call: sendReport, loading: sendingReport } = useFrappePostCall(
    "next_pms.next_pms.api.budget_burn.send_report_now"
  );

  const metrics = data?.message as BurnMetrics | undefined;

  useEffect(() => {
    if (!metrics) return;
    setSettings({
      weekly_report_enabled: Boolean(metrics.weekly_report_enabled),
      weekly_email_team: metrics.weekly_email_team !== false,
      weekly_email_client: Boolean(metrics.weekly_email_client),
      baseline_amount: "",
    });
  }, [metrics?.weekly_report_enabled, metrics?.weekly_email_team, metrics?.weekly_email_client, metrics?.project_name]);

  const handleSaveSettings = () => {
    if (!projectId) return;
    saveSettings({
      project: projectId,
      settings: JSON.stringify({
        weekly_report_enabled: settings.weekly_report_enabled,
        weekly_email_team: settings.weekly_email_team,
        weekly_email_client: settings.weekly_email_client,
        baseline_amount: settings.baseline_amount ? Number(settings.baseline_amount) : undefined,
      }),
    })
      .then(() => {
        mutate();
        toast({ variant: "success", description: "Burn report settings saved." });
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleCopyShareLink = () => {
    const url = metrics?.share?.share_url;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      toast({ variant: "success", description: "Client share link copied." });
    });
  };

  const handleEnableShare = () => {
    if (!projectId) return;
    enableShare({ project: projectId, expires_days: 90 })
      .then(() => {
        mutate();
        toast({ variant: "success", description: "Client share link enabled." });
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleDisableShare = () => {
    if (!projectId) return;
    disableShare({ project: projectId })
      .then(() => {
        mutate();
        toast({ variant: "success", description: "Client share link disabled." });
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleSendNow = () => {
    if (!projectId) return;
    sendReport({ project: projectId })
      .then((response) => {
        const result = response?.message as { sent?: boolean; recipients?: string[] };
        toast({
          variant: result?.sent ? "success" : "destructive",
          description: result?.sent
            ? `Report emailed to ${result.recipients?.length || 0} recipient(s).`
            : "No recipients were available for this report.",
        });
        mutate();
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-4 w-4" />
            Budget Burn
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground">
                Burn to Date
              </Typography>
              <Typography variant="p" className="font-semibold text-lg">
                {metrics?.burn_to_date?.amount ?? 0} {metrics?.currency}
              </Typography>
              <Typography variant="small" className="text-muted-foreground">
                {metrics?.burn_to_date?.hours ?? 0} hours logged
              </Typography>
            </div>
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground">
                Burn Rate
              </Typography>
              <Typography variant="p" className="font-semibold text-lg">
                {metrics?.burn_rate?.weekly ?? 0} / week
              </Typography>
              <Typography variant="small" className="text-muted-foreground">
                {metrics?.burn_rate?.daily ?? 0} daily · {metrics?.burn_rate?.monthly ?? 0} monthly
              </Typography>
            </div>
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                Projected Finish
              </Typography>
              <Typography variant="p" className="font-semibold text-lg">
                {metrics?.projected_finish_date || "—"}
              </Typography>
              {typeof metrics?.schedule_variance_days === "number" ? (
                <Typography variant="small" className="text-muted-foreground">
                  {metrics.schedule_variance_days >= 0 ? "+" : ""}
                  {metrics.schedule_variance_days} days vs planned end
                </Typography>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ComparisonRow label="vs Budget" data={metrics?.vs_budget} currency={metrics?.currency} />
            <ComparisonRow label="vs Baseline" data={metrics?.vs_baseline} currency={metrics?.currency} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Weekly Email Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.weekly_report_enabled}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, weekly_report_enabled: Boolean(checked) }))
              }
            />
            Email burn report automatically every week
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.weekly_email_team}
              disabled={!settings.weekly_report_enabled}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, weekly_email_team: Boolean(checked) }))
              }
            />
            Include project team
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.weekly_email_client}
              disabled={!settings.weekly_report_enabled}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, weekly_email_client: Boolean(checked) }))
              }
            />
            Include client contact (with share link)
          </label>
          <Input
            type="number"
            placeholder={`Baseline override (${metrics?.baseline_total ?? 0})`}
            value={settings.baseline_amount}
            onChange={(event) => setSettings((prev) => ({ ...prev, baseline_amount: event.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleSaveSettings} disabled={savingSettings}>
              Save Settings
            </Button>
            <Button size="sm" variant="outline" onClick={handleSendNow} disabled={sendingReport}>
              Send Now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            Client Share Link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Typography variant="small" className="text-muted-foreground">
            Share a read-only burn dashboard with your client. No login required.
          </Typography>
          {metrics?.share?.enabled && metrics.share.share_url ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">
                {metrics.share.share_url}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyShareLink}>
                  <Copy className="mr-1 h-4 w-4" />
                  Copy Link
                </Button>
                <Button size="sm" variant="outline" onClick={handleDisableShare} disabled={disablingShare}>
                  Disable
                </Button>
              </div>
              {metrics.share.expires_on ? (
                <Typography variant="small" className="text-muted-foreground">
                  Expires {metrics.share.expires_on}
                </Typography>
              ) : null}
            </div>
          ) : (
            <Button size="sm" onClick={handleEnableShare} disabled={enablingShare}>
              <TrendingUp className="mr-1 h-4 w-4" />
              Enable Client Share
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectBudgetBurn;
