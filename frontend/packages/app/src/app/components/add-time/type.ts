/**
 * Internal Dependencies
 */
import { WorkingFrequency } from "@/types";

export interface AddTimeProps {
  initialDate: string;
  employee: string;
  open: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onOpenChange: (data: any) => void;
  workingHours: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSuccess?: (data: any) => void;
  workingFrequency: WorkingFrequency;
  task?: string;
  project?: string;
  /** Prefill work type when opening from an existing Meeting/Admin/… row (+). */
  activity_type?: string;
  employeeName?: string;
}
