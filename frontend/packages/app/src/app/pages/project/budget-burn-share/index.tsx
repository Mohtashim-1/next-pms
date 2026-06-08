/**
 * External dependencies.
 */
import { useParams } from "react-router-dom";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Typography,
} from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import { CalendarClock, Flame } from "lucide-react";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";

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
  customer_name?: string;
  currency?: string;
  as_of_date?: string;
  projected_finish_date?: string;
  schedule_variance_days?: number | null;
  burn_to_date?: { amount: number; hours: number };
  burn_rate?: { daily: number; weekly: number; monthly: number };
  vs_budget?: Comparison;
  vs_baseline?: Comparison;
};

const varianceClass = (pct: number) => {
  if (pct >= 100) return "text-destructive";
  if (pct >= 80) return "text-amber-600";
  return "text-emerald-600";
};

const ComparisonCard = ({ label, data, currency }: { label: string; data?: Comparison; currency?: string }) => {
  if (!data) return null;
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <Typography variant="small" className="font-medium">
            {label}
          </Typography>
          <Badge variant="outline">{data.utilization_pct}% used</Badge>
        </div>
        <Typography variant="p" className="font-semibold">
          {data.actual} / {data.target} {currency}
        </Typography>
        <Typography variant="small" className={mergeClassNames("font-medium", varianceClass(data.utilization_pct))}>
          Variance {data.variance >= 0 ? "+" : ""}
          {data.variance} {currency}
        </Typography>
      </CardContent>
    </Card>
  );
};

const BudgetBurnShare = () => {
  const { token } = useParams();

  const { data, isLoading, error } = useFrappeGetCall(
    token ? "next_pms.next_pms.api.budget_burn.get_shared_burn_view" : null,
    token ? { token } : undefined
  );

  const metrics = data?.message as BurnMetrics | undefined;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 p-6">
        <Skeleton className="mx-auto h-64 max-w-3xl w-full" />
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="max-w-lg w-full">
          <CardContent className="pt-6">
            <Typography variant="p">This budget burn report link is invalid or has expired.</Typography>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Flame className="h-5 w-5" />
              {metrics.project_name}
            </CardTitle>
            <Typography variant="small" className="text-muted-foreground">
              Budget burn report for {metrics.customer_name || "client"} · as of {metrics.as_of_date}
            </Typography>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground">
                Burn to Date
              </Typography>
              <Typography variant="p" className="font-semibold text-lg">
                {metrics.burn_to_date?.amount ?? 0} {metrics.currency}
              </Typography>
            </div>
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground">
                Burn Rate
              </Typography>
              <Typography variant="p" className="font-semibold text-lg">
                {metrics.burn_rate?.weekly ?? 0} / week
              </Typography>
            </div>
            <div className="rounded-md border p-3">
              <Typography variant="small" className="text-muted-foreground flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                Projected Finish
              </Typography>
              <Typography variant="p" className="font-semibold text-lg">
                {metrics.projected_finish_date || "—"}
              </Typography>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          <ComparisonCard label="vs Budget" data={metrics.vs_budget} currency={metrics.currency} />
          <ComparisonCard label="vs Baseline" data={metrics.vs_baseline} currency={metrics.currency} />
        </div>
      </div>
    </div>
  );
};

export default BudgetBurnShare;
