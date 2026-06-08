/**
 * External dependencies
 */
import { useState } from "react";
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  TextArea,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { useFrappePostCall } from "frappe-react-sdk";
import { Lock, Unlock } from "lucide-react";

/**
 * Internal dependencies
 */
import {
  canManagePeriodLocks,
  canUnlockPeriodLocks,
  type PeriodLock,
} from "@/lib/timesheetPeriodLock";
import { parseFrappeErrorMsg } from "@/lib/utils";

type PeriodLockAdminProps = {
  roles: string[];
  periodLocks: PeriodLock[];
  onUpdated: () => void;
};

export const PeriodLockAdmin = ({ roles, periodLocks, onUpdated }: PeriodLockAdminProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [lockReason, setLockReason] = useState("");
  const [unlockReason, setUnlockReason] = useState("");
  const [unlockTarget, setUnlockTarget] = useState<PeriodLock | null>(null);

  const { call: lockPeriod, loading: isLocking } = useFrappePostCall(
    "next_pms.timesheet.api.period_lock.lock_period"
  );
  const { call: unlockPeriod, loading: isUnlocking } = useFrappePostCall(
    "next_pms.timesheet.api.period_lock.unlock_period"
  );

  if (!canManagePeriodLocks(roles)) {
    return null;
  }

  const handleLock = async () => {
    if (!fromDate || !toDate || !lockReason.trim()) {
      toast({ variant: "destructive", description: "From date, to date, and lock reason are required." });
      return;
    }

    try {
      const res = await lockPeriod({
        from_date: getFormatedDate(fromDate),
        to_date: getFormatedDate(toDate),
        reason: lockReason.trim(),
      });
      toast({ variant: "success", description: res.message });
      setLockReason("");
      setFromDate(undefined);
      setToDate(undefined);
      onUpdated();
    } catch (error) {
      toast({ variant: "destructive", description: parseFrappeErrorMsg(error) });
    }
  };

  const handleUnlock = async () => {
    if (!unlockTarget || !unlockReason.trim()) {
      toast({ variant: "destructive", description: "Unlock reason is required." });
      return;
    }

    try {
      const res = await unlockPeriod({
        name: unlockTarget.name,
        reason: unlockReason.trim(),
      });
      toast({ variant: "success", description: res.message });
      setUnlockTarget(null);
      setUnlockReason("");
      onUpdated();
    } catch (error) {
      toast({ variant: "destructive", description: parseFrappeErrorMsg(error) });
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} title="Manage period locks">
        <Lock />
        Period Lock
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Timesheet Period Lock</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Typography variant="small" className="text-muted-foreground">
              Lock a date range to make all timesheet entries read-only. Only administrators can unlock with a reason.
            </Typography>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>From Date</Label>
                <DatePicker date={fromDate} onDateChange={setFromDate} />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <DatePicker date={toDate} onDateChange={setToDate} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Lock Reason</Label>
              <TextArea
                value={lockReason}
                onChange={(event) => setLockReason(event.target.value)}
                placeholder="e.g. Payroll closed for May 2026"
              />
            </div>

            <Button onClick={handleLock} disabled={isLocking}>
              <Lock />
              Lock Period
            </Button>

            {periodLocks.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <Typography variant="p" className="font-medium">
                  Active Locks
                </Typography>
                {periodLocks.map((lock) => (
                  <div key={lock.name} className="rounded-md border p-3 space-y-2">
                    <Typography variant="small" className="font-medium">
                      {lock.from_date} — {lock.to_date}
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      {lock.lock_reason}
                    </Typography>
                    {canUnlockPeriodLocks(roles) && (
                      unlockTarget?.name === lock.name ? (
                        <div className="space-y-2">
                          <Input
                            value={unlockReason}
                            onChange={(event) => setUnlockReason(event.target.value)}
                            placeholder="Unlock reason (required)"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleUnlock} disabled={isUnlocking}>
                              Confirm Unlock
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setUnlockTarget(null);
                                setUnlockReason("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setUnlockTarget(lock)}>
                          <Unlock />
                          Unlock
                        </Button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
