/**
 * External dependencies.
 */
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from "@next-pms/design-system/components";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";

/**
 * Internal dependencies.
 */
import {
  type AnalyticsDrilldownResponse,
  type DrilldownRecord,
  downloadDrilldownCsv,
  getDrilldownDocLink,
} from "./analyticsDrilldown";

type AnalyticsDrilldownScreenProps = {
  title: string;
  description?: string;
  loading?: boolean;
  payload: AnalyticsDrilldownResponse | null;
  onBack: () => void;
  exportFilename?: string;
  valueKey?: "hours" | "amount";
  children?: ReactNode;
};

const RecordLink = ({ record }: { record: DrilldownRecord }) => {
  const href = getDrilldownDocLink(record);
  if (!href) {
    return <span className="font-medium">{record.label}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {record.label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
};

export const AnalyticsDrilldownScreen = ({
  title,
  description,
  loading = false,
  payload,
  onBack,
  exportFilename = "analytics-drilldown.csv",
  valueKey = "hours",
  children,
}: AnalyticsDrilldownScreenProps) => {
  const records = payload?.records ?? payload?.details ?? [];
  const columns = payload?.columns ?? [];
  const filterChips = payload?.filter_chips ?? [];

  const handleExport = () => {
    if (!payload) return;
    downloadDrilldownCsv({ filename: exportFilename, columns, records, filterChips });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
            <div className="flex flex-col gap-0.5">
              <Typography variant="h3" className="text-lg font-semibold">
                {title}
              </Typography>
              {description ? (
                <Typography variant="small" className="text-muted-foreground">
                  {description}
                </Typography>
              ) : null}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!records.length || loading}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {filterChips.length ? (
          <div className="flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <Badge key={`${chip.key}-${chip.value}`} variant="secondary">
                {chip.label}: {chip.value}
              </Badge>
            ))}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="space-y-4">{children}</div>

            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <Typography variant="p" className="font-medium">
                  Underlying records
                </Typography>
                <Typography variant="small" className="text-muted-foreground">
                  {records.length} record{records.length === 1 ? "" : "s"}
                  {typeof payload?.readable_count === "number" ? ` · ${payload.readable_count} readable` : ""}
                </Typography>
              </div>
              {records.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/60">
                      <TableRow>
                        <TableHead>Record</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>{valueKey === "amount" ? "Amount" : "Hours"}</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((record, index) => (
                        <TableRow key={`${record.label}-${record.date}-${index}`}>
                          <TableCell>
                            <RecordLink record={record} />
                          </TableCell>
                          <TableCell>{record.date || "—"}</TableCell>
                          <TableCell>{record[valueKey] ?? record.amount ?? record.hours ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {record.meta || record.description || record.employee_name || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Typography variant="small" className="text-muted-foreground">
                    No underlying records for this selection.
                  </Typography>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
