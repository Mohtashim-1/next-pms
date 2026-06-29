export type GridRowData = {
  date: string;
  type: string;
  from_time: string;
  to_time: string;
  employee: string;
  project: string;
  task: string;
  remarks: string;
};

const HEADER_ALIASES: Record<string, keyof GridRowData> = {
  date: "date",
  type: "type",
  "activity type": "type",
  "from time": "from_time",
  from: "from_time",
  "to time": "to_time",
  to: "to_time",
  employee: "employee",
  project: "project",
  task: "task",
  remarks: "remarks",
  remark: "remarks",
  description: "remarks",
};

function resolveHeader(cell: string): keyof GridRowData | null {
  return HEADER_ALIASES[normalizeHeader(cell)] ?? null;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ");
}

function escapeCsvCell(value: string): string {
  const cell = value ?? "";
  if (/[",\n\r\t]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function splitDelimitedText(text: string): string[][] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (!lines.length) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) =>
    delimiter === "\t" ? line.split("\t").map((cell) => cell.trim()) : splitCsvLine(line)
  );
}

function mapRowCells(cells: string[], headerMap: Array<keyof GridRowData | null>): Partial<GridRowData> {
  const row: Partial<GridRowData> = {};
  headerMap.forEach((key, index) => {
    if (!key) return;
    row[key] = (cells[index] ?? "").trim();
  });
  return row;
}

export function getGridHeaders(includeEmployee: boolean): string[] {
  const headers = ["date", "type", "from_time", "to_time"];
  if (includeEmployee) headers.push("employee");
  headers.push("project", "task", "remarks");
  return headers;
}

export function rowsToCsv(rows: GridRowData[], includeEmployee: boolean): string {
  const headers = getGridHeaders(includeEmployee);
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    const values = headers.map((header) => escapeCsvCell(row[header as keyof GridRowData] ?? ""));
    lines.push(values.join(","));
  });
  return lines.join("\n");
}

export function rowsToTsv(rows: GridRowData[], includeEmployee: boolean): string {
  const headers = getGridHeaders(includeEmployee);
  const lines = [headers.join("\t")];
  rows.forEach((row) => {
    const values = headers.map((header) => (row[header as keyof GridRowData] ?? "").replace(/\t/g, " "));
    lines.push(values.join("\t"));
  });
  return lines.join("\n");
}

export function parseGridClipboard(
  text: string,
  options: { includeEmployee: boolean; defaultEmployee: string; defaultDate: string }
): GridRowData[] {
  const table = splitDelimitedText(text);
  if (!table.length) return [];

  const firstRow = table[0].map((cell) => cell.trim());
  const hasHeader = firstRow.some((cell) => resolveHeader(cell) !== null);

  let dataRows = table;
  let headerMap: Array<keyof GridRowData | null> = [];

  if (hasHeader) {
    headerMap = firstRow.map((cell) => resolveHeader(cell));
    dataRows = table.slice(1);
  } else {
    const headers = getGridHeaders(options.includeEmployee);
    headerMap = headers.map((header) => header as keyof GridRowData);
  }

  return dataRows
    .map((cells) => {
      const partial = mapRowCells(cells, headerMap);
      return {
        date: partial.date || options.defaultDate,
        type: partial.type ?? "",
        from_time: partial.from_time ?? "",
        to_time: partial.to_time ?? "",
        employee: partial.employee || options.defaultEmployee,
        project: partial.project ?? "",
        task: partial.task ?? "",
        remarks: partial.remarks ?? "",
      };
    })
    .filter((row) =>
      Boolean(row.date || row.type || row.from_time || row.to_time || row.project || row.task || row.remarks)
    );
}

export function mergeRowsIntoGrid(
  current: GridRowData[],
  pasted: GridRowData[],
  startIndex = 0,
  rowCount: number
): GridRowData[] {
  const next = [...current];
  pasted.forEach((row, offset) => {
    const index = startIndex + offset;
    if (index >= rowCount) return;
    next[index] = { ...next[index], ...row };
  });
  return next;
}

export function downloadGridCsv(content: string, filename = "timesheet-grid.csv") {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function getGridTemplateCsv(includeEmployee: boolean, defaultEmployee: string, defaultDate: string): string {
  const sample: GridRowData = {
    date: defaultDate,
    type: "Development",
    from_time: "09:00",
    to_time: "17:00",
    employee: defaultEmployee,
    project: "",
    task: "",
    remarks: "Sample row — replace or delete before saving",
  };
  return rowsToCsv([sample], includeEmployee);
}
