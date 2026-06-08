export type PeriodLock = {
  name: string;
  from_date: string;
  to_date: string;
  lock_reason: string;
  locked_by?: string;
  locked_on?: string;
};

export const isDatePeriodLocked = (date: string, locks: PeriodLock[] = []) => {
  if (!date || !locks.length) return false;

  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;

  return locks.some((lock) => {
    const from = new Date(`${lock.from_date}T00:00:00`);
    const to = new Date(`${lock.to_date}T00:00:00`);
    return target >= from && target <= to;
  });
};

export const getPeriodLockForDate = (date: string, locks: PeriodLock[] = []) => {
  if (!date || !locks.length) return null;

  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;

  return (
    locks.find((lock) => {
      const from = new Date(`${lock.from_date}T00:00:00`);
      const to = new Date(`${lock.to_date}T00:00:00`);
      return target >= from && target <= to;
    }) ?? null
  );
};

export const canManagePeriodLocks = (roles: string[] = []) =>
  roles.includes("Administrator") ||
  roles.includes("Timesheet Manager") ||
  roles.includes("Projects Manager");

export const canUnlockPeriodLocks = (roles: string[] = []) => roles.includes("Administrator");
