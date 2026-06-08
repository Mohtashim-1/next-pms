/**
 * External dependencies.
 */
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from "@next-pms/design-system/components";
import { Download, ExternalLink } from "lucide-react";

/**
 * Internal dependencies.
 */
import {
  type AnalyticsDrilldownResponse,
  type DrilldownRecord,
  downloadDrilldownCsv,
  getDrilldownDocLink,
} from "./analyticsDrilldown";

type AnalyticsDrilldownSheetProps = {
  open: boolean;
  title: string;
  description?: string;
  loading?: boolean;
  payload: AnalyticsDrilldownResponse | null;
  onClose: () => void;
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

export const AnalyticsDrilldownSheet = ({
  open,
  title,
  description,
  loading = false,
  payload,
  onClose,
  exportFilename = "analytics-drilldown.csv",
  valueKey = "hours",
  children,
}: AnalyticsDrilldownSheetProps) => {
  const records = payload?.records ?? payload?.details ?? [];
  const columns = payload?.columns ?? [];
  const filterChips = payload?.filter_chips ?? [];

  const handleExport = () => {
    if (!payload) return;
    downloadDrilldownCsv({
      filename: exportFilename,
      columns,
      records,
      filterChips,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>

        {filterChips.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <Badge key={`${chip.key}-${chip.value}`} variant="secondary">
                {chip.label}: {chip.value}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <Typography variant="small" className="text-muted-foreground">
            {records.length} record{records.length === 1 ? "" : "s"}
            {typeof payload?.readable_count === "number" ? ` · ${payload.readable_count} readable` : ""}
          </Typography>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={!records.length || loading}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {loading ? <Skeleton className="mt-4 h-40 w-full" /> : null}

        {children}

        {!loading && payload ? (
          <div className="mt-4 overflow-x-auto">
            {records.length ? (
              <Table>
                <TableHeader>
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
            ) : (
              <Typography variant="small" className="text-muted-foreground">
                No underlying records for this selection.
              </Typography>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
