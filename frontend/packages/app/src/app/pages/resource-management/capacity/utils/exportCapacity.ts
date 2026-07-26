/**
 * Export helpers for the Capacity Planning grid.
 *
 * Uses dependency-free approaches (SpreadsheetML for Excel, an iframe print for
 * PDF) so we don't pull in xlsx/jspdf just for two buttons.
 */
import type {
  CapacityDemandResponse,
  CapacityGapStatus,
} from "../types";

const STATUS_LABEL: Record<CapacityGapStatus, string> = {
  surplus: "Surplus",
  shortage: "Shortage",
  balanced: "Balanced",
};

const num = (value: number) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

const slug = (value: string) => value.replace(/\s+/g, "-").toLowerCase();

const escapeXml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeHtml = escapeXml;

const downloadBlob = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

type FlatRow = {
  group: string;
  period: string;
  start: string;
  end: string;
  capacity: number;
  demand: number;
  gap: number;
  status: string;
};

const flatten = (response: CapacityDemandResponse): FlatRow[] => {
  const out: FlatRow[] = [];
  response.rows.forEach((row) => {
    response.periods.forEach((period) => {
      const metrics = row.periods[period.key];
      if (!metrics) return;
      out.push({
        group: row.label,
        period: period.label,
        start: period.start_date,
        end: period.end_date,
        capacity: metrics.capacity_hours,
        demand: metrics.demand_hours,
        gap: metrics.gap_hours,
        status: STATUS_LABEL[metrics.status] ?? metrics.status,
      });
    });
  });
  return out;
};

const COLUMNS = [
  "Group",
  "Period",
  "Start Date",
  "End Date",
  "Capacity (h)",
  "Demand (h)",
  "Gap (h)",
  "Status",
];

export const exportCapacityExcel = (response: CapacityDemandResponse) => {
  const rows = flatten(response);
  const header = COLUMNS.map((label) => `<Cell><Data ss:Type="String">${escapeXml(label)}</Data></Cell>`).join("");
  const body = rows
    .map((row) => {
      const cells = [
        `<Cell><Data ss:Type="String">${escapeXml(row.group)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escapeXml(row.period)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escapeXml(row.start)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escapeXml(row.end)}</Data></Cell>`,
        `<Cell><Data ss:Type="Number">${row.capacity}</Data></Cell>`,
        `<Cell><Data ss:Type="Number">${row.demand}</Data></Cell>`,
        `<Cell><Data ss:Type="Number">${row.gap}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escapeXml(row.status)}</Data></Cell>`,
      ].join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Capacity Planning">
  <Table>
   <Row>${header}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
  downloadBlob(xml, `capacity-planning-${slug(response.period)}.xls`, "application/vnd.ms-excel");
};

export const exportCapacityCsv = (response: CapacityDemandResponse) => {
  const rows = flatten(response);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    COLUMNS.map(escape).join(","),
    ...rows.map((row) =>
      [row.group, row.period, row.start, row.end, row.capacity, row.demand, row.gap, row.status]
        .map(escape)
        .join(",")
    ),
  ].join("\n");
  downloadBlob(`\uFEFF${csv}`, `capacity-planning-${slug(response.period)}.csv`, "text/csv;charset=utf-8");
};

export const exportCapacityPdf = (response: CapacityDemandResponse) => {
  const periodLabel = response.period === "week" ? "weeks" : "months";
  const gapColor = (status: CapacityGapStatus) => {
    if (status === "shortage") return "background:#fde8e8;color:#9b1c1c;";
    if (status === "surplus") return "background:#e1effe;color:#1e429f;";
    return "background:#f3f4f6;color:#374151;";
  };

  const head = [`<th>${escapeHtml(response.group_by || "Group")}</th>`]
    .concat(response.periods.map((period) => `<th>${escapeHtml(period.label)}</th>`))
    .join("");

  const bodyRows = response.rows
    .map((row) => {
      const cells = response.periods
        .map((period) => {
          const metrics = row.periods[period.key];
          if (!metrics) return `<td></td>`;
          return `<td style="text-align:right;${gapColor(metrics.status)}">${num(metrics.gap_hours)}</td>`;
        })
        .join("");
      return `<tr><td>${escapeHtml(row.label)}</td>${cells}</tr>`;
    })
    .join("");

  const totalCells = response.periods
    .map((period) => {
      const metrics = response.summary[period.key];
      if (!metrics) return `<td></td>`;
      return `<td style="text-align:right;font-weight:600;${gapColor(metrics.status)}">${num(metrics.gap_hours)}</td>`;
    })
    .join("");

  const html = `<!doctype html><html><head><title>Capacity Planning</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Inter, Arial, sans-serif; color: #111; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; margin-bottom: 12px; }
  .legend { display:flex; gap:12px; margin-bottom:12px; font-size:11px; }
  .legend span { padding:2px 8px; border-radius:4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; }
  th { background: #f4f4f5; text-align: left; font-size: 10px; text-transform: uppercase; white-space: nowrap; }
  td:first-child, th:first-child { text-align:left; position:sticky; left:0; background:#fff; }
</style></head><body>
  <h1>Capacity Planning</h1>
  <div class="meta">Grouped by ${escapeHtml(response.group_by)} · ${response.rows.length} rows · ${
    response.periods.length
  } ${periodLabel} through ${escapeHtml(response.end_date)} · gap = capacity − demand</div>
  <div class="legend">
    <span style="background:#e1effe;color:#1e429f;">Surplus</span>
    <span style="background:#f3f4f6;color:#374151;">Balanced</span>
    <span style="background:#fde8e8;color:#9b1c1c;">Shortage</span>
  </div>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${bodyRows}<tr><td style="font-weight:700;">Total</td>${totalCells}</tr></tbody>
  </table>
</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print capacity planning");
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

  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1000);
    }
  };

  if (frameDocument.readyState === "complete") {
    window.setTimeout(triggerPrint, 50);
  } else {
    iframe.onload = () => window.setTimeout(triggerPrint, 50);
  }
};
