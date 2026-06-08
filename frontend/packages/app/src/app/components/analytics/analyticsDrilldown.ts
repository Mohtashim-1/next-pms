export type DrilldownFilterChip = {
  key: string;
  label: string;
  value: string;
};

export type DrilldownColumn = {
  key: string;
  label: string;
};

export type DrilldownRecord = {
  label: string;
  date?: string;
  hours?: number;
  amount?: number;
  employee_name?: string;
  project_name?: string;
  customer?: string;
  activity_type?: string;
  meta?: string;
  description?: string;
  reference_doctype?: string | null;
  reference_name?: string | null;
  can_read?: boolean;
  link?: string | null;
};

export type AnalyticsDrilldownResponse = {
  view: string;
  filters: Record<string, unknown>;
  filter_chips: DrilldownFilterChip[];
  context: Record<string, unknown>;
  records: DrilldownRecord[];
  columns: DrilldownColumn[];
  summary?: Record<string, unknown>;
  record_count?: number;
  readable_count?: number;
  drivers?: Array<{
    driver: string;
    driver_type: string;
    driver_key: string;
    amount: number;
    impact: "positive" | "negative";
  }>;
  details?: DrilldownRecord[];
};

const escapeCsv = (value: unknown) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const downloadDrilldownCsv = ({
  filename,
  columns,
  records,
  filterChips,
}: {
  filename: string;
  columns: DrilldownColumn[];
  records: DrilldownRecord[];
  filterChips?: DrilldownFilterChip[];
}) => {
  const rows: string[][] = [
    ["exported_at", new Date().toISOString()],
    ...(filterChips || []).map((chip) => [chip.label, chip.value]),
    [],
    columns.map((column) => column.label),
  ];

  records.forEach((record) => {
    rows.push(columns.map((column) => String(record[column.key as keyof DrilldownRecord] ?? "")));
  });

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const getDrilldownDocLink = (record: DrilldownRecord) => {
  if (record.can_read && record.link) {
    return record.link;
  }
  if (record.can_read && record.reference_doctype && record.reference_name) {
    const slug = record.reference_doctype.toLowerCase().replace(/ /g, "-");
    return `/app/${slug}/${encodeURIComponent(record.reference_name)}`;
  }
  return null;
};
