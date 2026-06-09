/**
 * External dependencies.
 */
import { Suspense, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { ErrorFallback } from "@next-pms/design-system/components";
import { useToast, Toaster } from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";

/**
 * Internal dependencies.
 */
import { RunningTimerBar } from "@/app/components/running-timer-bar";
import Sidebar from "@/app/layout/sidebar";
import { parseFrappeErrorMsg } from "@/lib/utils";
import type { RootState } from "@/store";
import { setInitialData } from "@/store/user";

const Layout = ({ children }: { children: React.ReactNode }) => {
  const user = useSelector((state: RootState) => state.user);
  const dispatch = useDispatch();
  const { toast } = useToast();
  const { data, error } = useFrappeGetCall("next_pms.timesheet.api.employee.get_data", {}, undefined, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    errorRetryCount: 1,
  });

  useEffect(() => {
    if (data) {
      const info = {
        employee: data.message?.employee ?? "",
        workingHours: data.message?.employee_working_detail?.working_hour ?? 8,
        workingFrequency: data.message?.employee_working_detail?.working_frequency ?? "Per Day",
        reportsTo: data.message?.employee_report_to ?? "",
        employeeName: data.message?.employee_name ?? "",
      };
      dispatch(setInitialData(info));
    }
    if (error) {
      const err = parseFrappeErrorMsg(error);
      toast({
        variant: "destructive",
        description: err,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, error]);

  return (
    <ErrorFallback>
      <div className="flex flex-row h-screen w-full min-h-0">
        <ErrorFallback>
          <Sidebar />
        </ErrorFallback>
        <div className="flex min-h-0 flex-1 w-full flex-col overflow-hidden">
          {(user.employee || user.user == "Administrator") && (
            <>
              <RunningTimerBar employee={user.employee} />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Suspense fallback={<></>}>
                  <ErrorFallback>{children}</ErrorFallback>
                </Suspense>
              </div>
            </>
          )}
        </div>
      </div>
      <Toaster />
    </ErrorFallback>
  );
};

export default Layout;
