/**
 * Frappe-style Query Report experience inside Next PMS.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  ComboBox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import {
  ArrowLeft,
  Columns3,
  ChevronLeft,
  ChevronRight,
  Download,
  FileBarChart,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { REPORTS } from "@/lib/constant";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type FilterDef = {
  fieldname: string;
  label: string;
  fieldtype: string;
  options?: string;
  default?: string | number | null;
  reqd?: number;
};

type ColumnDef = {
  label?: string;
  fieldname?: string;
  fieldtype?: string;
  width?: number;
};

type ReportSummaryItem = {
  label?: string;
  value?: string | number;
  datatype?: string;
  indicator?: string;
};

type LetterHead = { name: string; is_default?: number };

type FilterValue = string | string[];

type PlaceholderInfo = { title?: string; status?: string; next?: string };

type ReportMeta = {
  name: string;
  ref_doctype?: string;
  report_type?: string;
  filters: FilterDef[];
  defaults: Record<string, unknown>;
  letter_heads?: LetterHead[];
  default_letter_head?: string | null;
};

const NUMERIC_TYPES = new Set(["Int", "Float", "Currency", "Percent"]);
const PAGE_SIZES = [25, 50, 100, 250];

const indicatorClass = (indicator?: string) => {
  const key = (indicator || "").toLowerCase();
  if (key.includes("green") || key.includes("blue")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (key.includes("red")) return "border-destructive/40 bg-destructive/10 text-destructive";
  if (key.includes("orange") || key.includes("yellow")) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-border bg-card text-foreground";
};

const ReportViewer = () => {
  const { reportName: rawName } = useParams<{ reportName: string }>();
  const reportName = rawName ? decodeURIComponent(rawName) : "";

  const { data: metaRes, isLoading: metaLoading, error: metaError } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.get_report_meta",
    { report_name: reportName },
    reportName ? `portal-report-meta-${reportName}` : null,
    { revalidateOnFocus: false }
  );
  const meta = metaRes?.message as ReportMeta | undefined;

  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [initializedReport, setInitializedReport] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<Array<ColumnDef | string>>([]);
  const [summary, setSummary] = useState<ReportSummaryItem[]>([]);
  const [placeholder, setPlaceholder] = useState<PlaceholderInfo | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState({
    letterHead: "",
    orientation: "Landscape",
    pageSize: "A4",
  });

  const { call: runReport, loading: running } = useFrappePostCall(
    "next_pms.next_pms.api.executive_dashboard.run_report"
  );

  const defaults = useMemo(() => {
    const next: Record<string, FilterValue> = {};
    const byName = new Map((meta?.filters || []).map((f) => [f.fieldname, f]));
    for (const [key, value] of Object.entries(meta?.defaults || {})) {
      // Skip aliases that are not part of the visible filter schema.
      if (!byName.has(key)) continue;
      const def = byName.get(key);
      if (def?.fieldtype === "MultiSelectList") {
        next[key] = value == null || value === "" ? [] : Array.isArray(value) ? value : [String(value)];
      } else {
        next[key] = value == null ? "" : String(value);
      }
    }
    for (const f of meta?.filters || []) {
      if (!(f.fieldname in next)) {
        next[f.fieldname] = f.fieldtype === "MultiSelectList" ? [] : f.default != null && f.default !== "" ? String(f.default) : "";
      }
    }
    return next;
  }, [meta?.defaults, meta?.filters]);

  useEffect(() => {
    if (!meta || !reportName) return;
    // Always re-sync defaults when meta arrives / changes for this report so
    // required dates are never left blank while a second alias is filled.
    setFilters(defaults);
    setInitializedReport(reportName);
    setRows([]);
    setColumns([]);
    setSummary([]);
    setPlaceholder(null);
    setRunError(null);
    setSearch("");
    setPage(1);
    setHiddenColumns(new Set());
    setPrintOpts((prev) => ({
      ...prev,
      letterHead: meta.default_letter_head || prev.letterHead,
    }));
  }, [defaults, meta, reportName]);

  const execute = useCallback(async (overrideFilters?: Record<string, FilterValue>) => {
    if (!reportName) return;
    setRunError(null);
    try {
      const source = overrideFilters || filters;
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(source)) {
        if (Array.isArray(value)) {
          // Preserve cleared MultiSelectList values. An empty company list means
          // "All Companies"; omitting it would restore the backend default company.
          payload[key] = value;
        } else if (value !== "") {
          payload[key] = value;
        }
      }
      // Stringify filters so nested arrays (e.g. company: []) survive form-urlencoded
      // POSTs. Raw objects with empty arrays often surface as Frappe "Invalid Request".
      const res = await runReport({
        report_name: reportName,
        filters: JSON.stringify(payload),
      });
      const message = res?.message || res;
      setColumns(message?.columns || []);
      setRows(message?.result || []);
      setSummary(Array.isArray(message?.report_summary) ? message.report_summary : []);
      setPlaceholder(message?.placeholder || null);
      setPage(1);
      setLastRun(new Date());
    } catch (e: unknown) {
      setRunError(parseFrappeErrorMsg(e as never) || "Failed to run report");
      setRows([]);
      setColumns([]);
      setSummary([]);
      setPlaceholder(null);
    }
  }, [filters, reportName, runReport]);

  useEffect(() => {
    if (initializedReport === reportName && reportName && Object.keys(defaults).length) {
      // Pass defaults directly so we don't race setFilters state.
      void execute(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializedReport, reportName, defaults]);

  const colKeys = useMemo(
    () =>
      columns.map((column, index) => {
        if (typeof column === "string") {
          const [label, fieldtype = "Data"] = column.split(":");
          return {
            key: label.trim().toLowerCase().replace(/\s+/g, "_") || `c${index}`,
            label: label.trim(),
            fieldtype,
            width: 120,
          };
        }
        return {
          key: column.fieldname || `c${index}`,
          label: column.label || column.fieldname || `Column ${index + 1}`,
          fieldtype: column.fieldtype || "Data",
          width: column.width,
        };
      }),
    [columns]
  );

  const visibleCols = useMemo(
    () => colKeys.filter((column) => !hiddenColumns.has(column.key)),
    [colKeys, hiddenColumns]
  );

  const isTotalRow = useCallback(
    (row: Record<string, unknown>) => {
      const firstValue = colKeys.length ? row[colKeys[0].key] : undefined;
      return String(firstValue || "").trim().toLowerCase() === "total";
    },
    [colKeys]
  );

  const totalRows = useMemo(() => rows.filter(isTotalRow), [isTotalRow, rows]);
  const resultRows = useMemo(() => rows.filter((row) => !isTotalRow(row)), [isTotalRow, rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return resultRows;
    return resultRows.filter((row) =>
      colKeys.some((column) => stripHtml(String(row[column.key] ?? "")).toLowerCase().includes(query))
    );
  }, [colKeys, resultRows, search]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize) || 1);
  const visibleRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const resetFilters = () => {
    setFilters(defaults);
    setSearch("");
    setPage(1);
  };

  const formatCell = (value: unknown, fieldtype?: string) => {
    if (value == null || value === "") return "";
    if (NUMERIC_TYPES.has(fieldtype || "")) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        if (fieldtype === "Percent") return `${number.toFixed(1)}%`;
        return number.toLocaleString(undefined, {
          minimumFractionDigits: fieldtype === "Currency" ? 2 : 0,
          maximumFractionDigits: 2,
        });
      }
    }
    return stripHtml(String(value));
  };

  const exportCsv = () => {
    if (!visibleCols.length) return;
    const escape = (value: unknown) => `"${stripHtml(String(value ?? "")).replace(/"/g, '""')}"`;
    const csv = [
      visibleCols.map((column) => escape(column.label)).join(","),
      ...rows.map((row) =>
        visibleCols
          .map((column) => escape(formatCell(row[column.key], column.fieldtype) || row[column.key]))
          .join(",")
      ),
    ].join("\n");
    downloadBlob(`\uFEFF${csv}`, `${slug(reportName)}.csv`, "text/csv;charset=utf-8");
  };

  const exportExcel = () => {
    if (!visibleCols.length) return;
    const escapeXml = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const header = visibleCols
      .map((column) => `<Cell><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`)
      .join("");
    const body = rows
      .map((row) => {
        const cells = visibleCols
          .map((column) => {
            const raw = row[column.key];
            const isNum = NUMERIC_TYPES.has(column.fieldtype) && raw !== "" && raw != null && Number.isFinite(Number(raw));
            const display = isNum ? Number(raw) : stripHtml(String(raw ?? ""));
            return `<Cell><Data ss:Type="${isNum ? "Number" : "String"}">${escapeXml(display)}</Data></Cell>`;
          })
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Report">
  <Table>
   <Row>${header}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
    downloadBlob(xml, `${slug(reportName)}.xls`, "application/vnd.ms-excel");
  };

  const doPrint = () => {
    const letterHead = printOpts.letterHead;
    const title = reportName;
    const filterText = Object.entries(filters)
      .filter(([, value]) => (Array.isArray(value) ? value.length : value))
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join(" · ");
    const summaryHtml = summary.length
      ? `<div class="kpis">${summary
          .map(
            (item) =>
              `<div class="kpi"><div class="kpi-label">${escapeHtml(item.label || "")}</div><div class="kpi-value">${escapeHtml(
                String(item.value ?? "")
              )}</div></div>`
          )
          .join("")}</div>`
      : "";
    const head = visibleCols.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const body = [...filteredRows, ...totalRows]
      .map(
        (row) =>
          `<tr>${visibleCols
            .map((column) => {
              const align = NUMERIC_TYPES.has(column.fieldtype) ? "right" : "left";
              return `<td style="text-align:${align}">${escapeHtml(formatCell(row[column.key], column.fieldtype))}</td>`;
            })
            .join("")}</tr>`
      )
      .join("");
    const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title>
<style>
  @page { size: ${printOpts.pageSize} ${printOpts.orientation}; margin: 12mm; }
  body { font-family: Inter, Arial, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; margin-bottom: 12px; }
  .letter { margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #ddd; font-weight: 600; }
  .kpis { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; min-width: 120px; }
  .kpi-label { font-size: 10px; color: #666; text-transform: uppercase; }
  .kpi-value { font-size: 16px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; }
  th { background: #f4f4f5; text-align: left; font-size: 11px; text-transform: uppercase; }
</style></head><body>
  ${letterHead ? `<div class="letter">${escapeHtml(letterHead)}</div>` : ""}
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${escapeHtml(filterText || "No filters")} · ${filteredRows.length} rows</div>
  ${summaryHtml}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;

    // Hidden iframe print — avoids blank about:blank popups from noopener window.open.
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Print report");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDocument = frameWindow?.document;
    if (!frameWindow || !frameDocument) {
      iframe.remove();
      return;
    }

    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();

    const cleanup = () => {
      iframe.remove();
    };

    const triggerPrint = () => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } finally {
        // Give the print dialog time to open before tearing down the frame.
        window.setTimeout(cleanup, 1000);
      }
    };

    if (frameDocument.readyState === "complete") {
      window.setTimeout(triggerPrint, 50);
    } else {
      iframe.onload = () => window.setTimeout(triggerPrint, 50);
    }

    setPrintOpen(false);
  };

  const firstRow = filteredRows.length ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, filteredRows.length);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20">
      <header className="shrink-0 border-b bg-background px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2">
              <Link to={`/${REPORTS}`}>
                <ArrowLeft className="h-4 w-4" />
                Reports
              </Link>
            </Button>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileBarChart className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <Typography variant="h4" className="truncate text-base font-semibold">
                {reportName || "Report"}
              </Typography>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {meta?.ref_doctype ? <span>{meta.ref_doctype}</span> : null}
                {meta?.report_type ? <span>• {meta.report_type}</span> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant={filtersOpen ? "secondary" : "outline"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!colKeys.length}>
                  <Columns3 className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-auto">
                <DropdownMenuLabel>Show / hide columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {colKeys.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={!hiddenColumns.has(column.key)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      setHiddenColumns((prev) => {
                        const next = new Set(prev);
                        if (checked) next.delete(column.key);
                        else next.add(column.key);
                        return next;
                      });
                    }}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!rows.length}>
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportExcel}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export as Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setPrintOpen(true)} disabled={!rows.length && !summary.length}>
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
          </div>
        </div>
      </header>

      {metaLoading ? (
        <div className="shrink-0 border-b bg-background p-4">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : metaError ? (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <Shield className="mt-0.5 h-4 w-4 text-destructive" />
          <Typography variant="small">You do not have access to this report.</Typography>
        </div>
      ) : filtersOpen ? (
        <section className="shrink-0 border-b bg-background px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-end gap-2.5">
            {(meta?.filters || []).map((filter) => (
              <ReportFilter
                key={filter.fieldname}
                filter={filter}
                value={filters[filter.fieldname] ?? (filter.fieldtype === "MultiSelectList" ? [] : "")}
                onChange={(value) =>
                  setFilters((current) => ({ ...current, [filter.fieldname]: value }))
                }
                onEnter={() => void execute()}
              />
            ))}
            <Button onClick={() => void execute()} disabled={running} size="sm" className="h-9 gap-2 px-4">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {running ? "Running" : "Run"}
            </Button>
            <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </section>
      ) : null}

      {placeholder ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-lg rounded-2xl border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <FileBarChart className="h-6 w-6" />
            </div>
            <Typography variant="h4" className="mb-1 text-base font-semibold">
              {placeholder.title || reportName}
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              This report is scaffolded and pending its business rules. It will populate once the
              data mapping below is configured.
            </Typography>
            {placeholder.next ? (
              <div className="mt-4 rounded-lg border border-dashed bg-muted/40 p-3 text-left text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Next step: </span>
                {placeholder.next}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        {runError ? (
          <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {runError}
          </div>
        ) : null}

        {summary.length ? (
          <div className="mb-3 grid shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {summary.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className={mergeClassNames("rounded-xl border px-3 py-2.5 shadow-sm", indicatorClass(item.indicator))}
              >
                <div className="text-[11px] uppercase tracking-wide opacity-70">{item.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {formatCell(item.value, item.datatype)}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-normal">
              {filteredRows.length.toLocaleString()} row{filteredRows.length === 1 ? "" : "s"}
            </Badge>
            {lastRun ? <span>Updated {lastRun.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> : null}
            {running && rows.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search in results"
              className="h-8 pl-8 pr-8 text-xs"
            />
            {search ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-card shadow-sm">
          {running && !rows.length ? (
            <div className="space-y-1 bg-card p-3">
              <Skeleton className="mb-2 h-8 w-full rounded-md bg-muted/80" />
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full rounded-md bg-muted/60" />
              ))}
            </div>
          ) : (
            <Table className="min-w-max text-[13px]">
              <TableHeader className="sticky top-0 z-20 bg-muted">
                <TableRow className="hover:bg-muted">
                  {visibleCols.map((column) => (
                    <TableHead
                      key={column.key}
                      style={{ minWidth: column.width || 120 }}
                      className={mergeClassNames(
                        "h-10 border-b border-r px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0",
                        NUMERIC_TYPES.has(column.fieldtype) && "text-right"
                      )}
                    >
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length ? (
                  visibleRows.map((row, rowIndex) => (
                    <TableRow key={`${page}-${rowIndex}`} className="h-9 even:bg-muted/20 hover:bg-primary/5">
                      {visibleCols.map((column, columnIndex) => (
                        <TableCell
                          key={column.key}
                          className={mergeClassNames(
                            "max-w-[28rem] truncate whitespace-nowrap border-r px-3 py-2 last:border-r-0",
                            NUMERIC_TYPES.has(column.fieldtype) && "font-mono text-right tabular-nums",
                            columnIndex === 0 && "font-medium"
                          )}
                          title={String(row[column.key] ?? "")}
                        >
                          {formatCell(row[column.key], column.fieldtype)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={Math.max(visibleCols.length, 1)} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileBarChart className="h-7 w-7 opacity-40" />
                        <span>
                          {initializedReport === reportName
                            ? "No data for the selected filters"
                            : "Loading report…"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {totalRows.map((row, index) => (
                  <TableRow key={`total-${index}`} className="sticky bottom-0 z-10 h-10 bg-muted font-semibold hover:bg-muted">
                    {visibleCols.map((column) => (
                      <TableCell
                        key={column.key}
                        className={mergeClassNames(
                          "border-r border-t px-3 py-2 last:border-r-0",
                          NUMERIC_TYPES.has(column.fieldtype) && "font-mono text-right tabular-nums"
                        )}
                      >
                        {formatCell(row[column.key], column.fieldtype)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
          <span>
            Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {filteredRows.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              Rows
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <span>
              Page {page} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </footer>
      </div>
      )}

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Print settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Letter Head</span>
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={printOpts.letterHead}
                onChange={(event) => setPrintOpts((prev) => ({ ...prev, letterHead: event.target.value }))}
              >
                <option value="">No Letter Head</option>
                {(meta?.letter_heads || []).map((lh) => (
                  <option key={lh.name} value={lh.name}>
                    {lh.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Orientation</span>
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={printOpts.orientation}
                onChange={(event) => setPrintOpts((prev) => ({ ...prev, orientation: event.target.value }))}
              >
                <option value="Portrait">Portrait</option>
                <option value="Landscape">Landscape</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Page Size</span>
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={printOpts.pageSize}
                onChange={(event) => setPrintOpts((prev) => ({ ...prev, pageSize: event.target.value }))}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Legal">Legal</option>
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doPrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const ReportFilter = ({
  filter,
  value,
  onChange,
  onEnter,
}: {
  filter: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  onEnter: () => void;
}) => {
  const isDate = filter.fieldtype === "Date";
  const isSelect = filter.fieldtype === "Select";
  const isMulti = filter.fieldtype === "MultiSelectList";
  const isCheck = filter.fieldtype === "Check";
  const isNumber = ["Int", "Float", "Currency"].includes(filter.fieldtype);
  const isLink =
    (filter.fieldtype === "Link" || isMulti) && Boolean(filter.options) && !isSelect;

  const stringValue = Array.isArray(value) ? value[0] ?? "" : value;
  const arrayValue = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []),
    [value]
  );

  const selectOptions = useMemo(
    () =>
      (filter.options || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => ({ label: item, value: item })),
    [filter.options]
  );

  const [linkSearch, setLinkSearch] = useState("");

  // Portal report filters use a dedicated search so HR masters like Skill
  // remain selectable even when the user lacks Desk read permission on them.
  const { data: linkData, isLoading: linkLoading } = useFrappeGetCall(
    "next_pms.next_pms.api.executive_dashboard.search_filter_options",
    {
      doctype: filter.options,
      txt: linkSearch,
      page_length: 20,
    },
    isLink ? `portal-link-${filter.options}-${linkSearch || "__all"}` : null,
    { revalidateOnFocus: false }
  );

  const linkOptions = useMemo(() => {
    const rows = (linkData?.message || []) as Array<{ value: string; description?: string; label?: string }>;
    const mapped = rows.map((row) => ({
      value: row.value,
      label: row.label || row.value,
      description: row.description,
    }));
    // Ensure current selections always appear (so ComboBox shows their labels).
    for (const selected of arrayValue) {
      if (selected && !mapped.some((option) => option.value === selected)) {
        mapped.unshift({ value: selected, label: selected, description: "" });
      }
    }
    return mapped;
  }, [linkData, arrayValue]);

  if (isCheck) {
    const checked = stringValue === "1" || stringValue === "true";
    return (
      <label className="flex h-10 min-w-[11rem] max-w-[16rem] flex-none cursor-pointer items-center gap-2 self-end rounded-md border border-input bg-background px-3">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={checked}
          onChange={(event) => onChange(event.target.checked ? "1" : "0")}
        />
        <span className="truncate text-xs text-foreground">{filter.label}</span>
      </label>
    );
  }

  return (
    <label className="relative flex min-w-[11rem] max-w-[16rem] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-[11px] font-medium text-muted-foreground">
        {filter.label}
        {filter.reqd ? <span className="ml-0.5 text-destructive">*</span> : null}
      </span>

      {isDate ? (
        <DatePicker
          date={stringValue || undefined}
          onDateChange={(date) => {
            if (!date) return;
            onChange(getFormatedDate(date));
          }}
        />
      ) : isLink ? (
        <ComboBox
          label={
            !arrayValue.length
              ? isMulti && !filter.reqd
                ? filter.options === "Company"
                  ? "All Companies"
                  : `All ${filter.label}`
                : `Select ${filter.label}`
              : isMulti
                ? `${arrayValue.length} selected`
                : linkOptions.find((option) => option.value === arrayValue[0])?.label || arrayValue[0]
          }
          className="w-full min-w-[11rem]"
          value={arrayValue}
          data={linkOptions}
          isLoading={linkLoading}
          isMulti={isMulti}
          showSelected
          shouldFilter={false}
          onSearch={(term) => setLinkSearch(term)}
          onSelect={(selected) => {
            const list = Array.isArray(selected) ? selected : selected ? [selected] : [];
            onChange(isMulti ? list : list[0] ?? "");
          }}
          onunSelect={() => onChange(isMulti ? [] : "")}
        />
      ) : isSelect ? (
        <select
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
        >
          {/* A required Select must not offer a blank "All" choice. */}
          {filter.reqd ? null : <option value="">All</option>}
          {selectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={isNumber ? "number" : "text"}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter();
          }}
          placeholder={filter.label}
          className="h-10 bg-background text-sm"
        />
      )}
    </label>
  );
};

function slug(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stripHtml(value: string) {
  if (!value || !/[<>]/.test(value)) return value;
  // Prefer DOM parsing so entities decode correctly; fall back to regex in non-browser contexts.
  if (typeof document !== "undefined") {
    const host = document.createElement("div");
    host.innerHTML = value;
    return (host.textContent || host.innerText || "").replace(/\s+/g, " ").trim();
  }
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default ReportViewer;
