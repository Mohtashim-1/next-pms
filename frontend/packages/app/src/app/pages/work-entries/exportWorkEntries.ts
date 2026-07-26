/**
 * Client-side Work Entries export (SpreadsheetML Excel + CSV).
 */
import { floatToTime } from "@next-pms/design-system/utils";
import { formatRangeLabel, getEntryDate } from "@/lib/timesheetTime";

export type WorkEntryRow = {
  name: string;
  parent: string;
  date: string;
  from_time?: string;
  to_time?: string;
  hours: number;
  activity_type?: string;
  task?: string;
  task_subject?: string;
  project?: string;
  project_name?: string;
  description?: string;
  is_billable?: boolean;
  entry_approval_status?: string;
  timesheet_status?: string;
};

const COLUMNS = [
  "Date",
  "From",
  "To",
  "Time Range",
  "Hours",
  "Hours (decimal)",
  "Type",
  "Task",
  "Project",
  "Remarks",
  "Billable",
  "Entry Status",
  "Timesheet Status",
  "Timesheet",
] as const;

const escapeXml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const downloadBlob = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const slug = (value: string) => value.replace(/[^\w.-]+/g, "-").toLowerCase();

const cellValues = (row: WorkEntryRow) => {
  const date = getEntryDate(row.from_time, row.date) || row.date || "";
  return [
    date,
    row.from_time || "",
    row.to_time || "",
    formatRangeLabel(row.from_time, row.to_time) || "",
    floatToTime(row.hours),
    Number(row.hours || 0),
    row.activity_type || "",
    row.task_subject || row.task || "",
    row.project_name || row.project || "",
    row.description && row.description !== "-" ? row.description : "",
    row.is_billable ? "Yes" : "No",
    row.entry_approval_status || "Pending",
    row.timesheet_status || "",
    row.parent || "",
  ] as const;
};

export const exportWorkEntriesExcel = (rows: WorkEntryRow[], rangeLabel: string) => {
  const header = COLUMNS.map((label) => `<Cell><Data ss:Type="String">${escapeXml(label)}</Data></Cell>`).join("");
  const body = rows
    .map((row) => {
      const values = cellValues(row);
      const cells = values
        .map((value, index) => {
          const isNum = index === 5 && Number.isFinite(Number(value));
          return `<Cell><Data ss:Type="${isNum ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Work Entries">
  <Table>
   <Row>${header}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;

  downloadBlob(xml, `work-entries-${slug(rangeLabel)}.xls`, "application/vnd.ms-excel");
};

export const exportWorkEntriesCsv = (rows: WorkEntryRow[], rangeLabel: string) => {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    COLUMNS.map(escape).join(","),
    ...rows.map((row) => cellValues(row).map(escape).join(",")),
  ].join("\n");
  downloadBlob(`\uFEFF${csv}`, `work-entries-${slug(rangeLabel)}.csv`, "text/csv;charset=utf-8");
};
