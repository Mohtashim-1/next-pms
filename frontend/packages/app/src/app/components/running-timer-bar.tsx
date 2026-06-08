/**
 * External dependencies.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Typography, useToast } from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Clock, Square } from "lucide-react";

/**
 * Internal dependencies.
 */
import { parseFrappeErrorMsg } from "@/lib/utils";

type RunningTimer = {
  employee: string;
  task: string;
  task_subject: string;
  project?: string;
  project_name?: string;
  description?: string;
  started_at: string;
};

const formatElapsedTime = (startedAt: string, now: number) => {
  const startDate = new Date(startedAt.replace(" ", "T"));
  if (Number.isNaN(startDate.getTime())) return "00:00:00";

  const totalSeconds = Math.max(0, Math.floor((now - startDate.getTime()) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

export const RunningTimerBar = ({ employee }: { employee: string }) => {
  const { toast } = useToast();
  const [tick, setTick] = useState(Date.now());
  const { data, mutate } = useFrappeGetCall(
    employee ? "next_pms.timesheet.api.timesheet.get_running_timer" : null,
    employee ? { employee } : undefined,
    undefined,
    { revalidateOnFocus: false }
  );
  const { call: stopTimer, loading } = useFrappePostCall("next_pms.timesheet.api.timesheet.stop_timer");
  const activeTimer: RunningTimer | null = data?.message?.task ? data.message : null;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      mutate();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [mutate]);

  useEffect(() => {
    const refreshTimer = () => {
      mutate();
    };
    window.addEventListener("next-pms:timer-updated", refreshTimer);
    return () => window.removeEventListener("next-pms:timer-updated", refreshTimer);
  }, [mutate]);

  if (!activeTimer) return null;

  const stop = () => {
    stopTimer({ employee })
      .then((res) => {
        toast({
          variant: "success",
          description: res.message?.message ?? "Timer stopped.",
        });
        window.dispatchEvent(new Event("next-pms:timer-updated"));
        mutate();
      })
      .catch((err) => {
        toast({
          variant: "destructive",
          description: parseFrappeErrorMsg(err),
        });
      });
  };

  return (
    <div className="border-b border-border bg-warning/10 text-foreground">
      <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning/20 text-warning">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Typography variant="p" className="font-semibold text-warning">
                {formatElapsedTime(activeTimer.started_at, tick)}
              </Typography>
              <Link to={`/task?task=${activeTimer.task}`} className="min-w-0 hover:underline">
                <Typography variant="p" className="truncate font-medium" title={activeTimer.task_subject}>
                  {activeTimer.task_subject}
                </Typography>
              </Link>
            </div>
            <Typography variant="p" className="truncate text-xs text-muted-foreground" title={activeTimer.project_name}>
              {activeTimer.project_name || activeTimer.project || "No project"}
            </Typography>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={stop} disabled={loading} className="shrink-0 bg-background">
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      </div>
    </div>
  );
};
