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

export const needsBillableOverrideReason = (
  isBillable: boolean,
  projectDefault?: boolean | number | null
) => isBillable !== isBillableValue(projectDefault);
