import type { ResourceAllocationTimeLineProps } from "../timeline/types";

type ExportSnapshotInput = {
  viewLabel: string;
  filters: Record<string, unknown>;
  employees: Array<{ name: string; employee_name: string; department?: string; designation?: string }>;
  allocations: ResourceAllocationTimeLineProps[];
};

const escapeCsv = (value: unknown) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const downloadTimelineCsvSnapshot = ({
  viewLabel,
  filters,
  employees,
  allocations,
}: ExportSnapshotInput) => {
  const rows = [
    ["view", viewLabel],
    ["exported_at", new Date().toISOString()],
    ["filters", JSON.stringify(filters)],
    [],
    [
      "employee",
      "employee_name",
      "department",
      "designation",
      "allocation",
      "project",
      "start_date",
      "end_date",
      "hours_per_day",
      "status",
      "is_billable",
    ],
  ];

  const allocationRows = allocations.filter((item) => item.type === "allocation");
  allocationRows.forEach((allocation) => {
    const employee = employees.find((item) => item.name === allocation.employee);
    rows.push([
      allocation.employee,
      employee?.employee_name ?? allocation.employee_name,
      employee?.department ?? "",
      employee?.designation ?? "",
      allocation.name,
      allocation.project_name || allocation.project,
      allocation.allocation_start_date,
      allocation.allocation_end_date,
      allocation.hours_allocated_per_day,
      allocation.status ?? "",
      allocation.is_billable ? "1" : "0",
    ]);
  });

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${viewLabel.replace(/\s+/g, "-").toLowerCase()}-snapshot.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadTimelineJsonSnapshot = (payload: ExportSnapshotInput) => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          ...payload,
          exported_at: new Date().toISOString(),
          allocations: payload.allocations.filter((item) => item.type === "allocation"),
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${payload.viewLabel.replace(/\s+/g, "-").toLowerCase()}-snapshot.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};
