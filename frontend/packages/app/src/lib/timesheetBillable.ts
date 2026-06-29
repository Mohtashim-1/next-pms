export type BillableEntry = {
  is_billable?: boolean | number;
  is_billable_override?: boolean;
  billable_override_reason?: string | null;
  project_default_is_billable?: boolean | number;
};

export const isBillableValue = (value?: boolean | number | null) => value === true || value === 1;

export const getBillableSummary = (entries: BillableEntry[] = []) => {
  const billableEntries = entries.filter((entry) => isBillableValue(entry.is_billable));
  const nonBillableEntries = entries.filter((entry) => !isBillableValue(entry.is_billable));
  const overrideReasons = entries
    .filter((entry) => entry.is_billable_override && entry.billable_override_reason)
    .map((entry) => entry.billable_override_reason as string);

  return {
    hasBillable: billableEntries.length > 0,
    hasNonBillable: nonBillableEntries.length > 0,
    isMixed: billableEntries.length > 0 && nonBillableEntries.length > 0,
    isAllBillable: entries.length > 0 && nonBillableEntries.length === 0,
    hasOverride: entries.some((entry) => entry.is_billable_override),
    overrideReasons,
  };
};

export const getBillableCellBg = (
  entries: Array<BillableEntry & { hours?: number }> = [],
  hasHours = false
) => {
  if (!hasHours) return "";
  const loggedEntries = entries.filter((entry) => (entry.hours ?? 0) > 0);
  if (!loggedEntries.length) return "";

  const summary = getBillableSummary(loggedEntries);
  if (summary.isMixed) return "bg-amber-500/12 dark:bg-amber-400/10";
  if (summary.isAllBillable) return "bg-emerald-500/12 dark:bg-emerald-400/10";
  if (summary.hasNonBillable) return "bg-slate-500/15 dark:bg-slate-400/12";
  return "";
};

export const needsBillableOverrideReason = (
  isBillable: boolean,
  projectDefault?: boolean | number | null
) => isBillable !== isBillableValue(projectDefault);
