/**
 * Internal dependencies
 */
import type { WorkingFrequency } from "@/types";
import type {
  HolidayProp,
  LeaveProps,
  TaskDataProps,
  TaskProps,
} from "@/types/timesheet";

export type GridCellBindings = {
  gridRow?: number;
  isFocused?: (row: number, col: number) => boolean;
  isEditing?: (row: number, col: number) => boolean;
  onFocusCell?: (row: number, col: number) => void;
  onStartEditing?: (row: number, col: number) => void;
  onStopEditing?: () => void;
  onMoveFocus?: (rowDelta: number, colDelta: number) => void;
  employee?: string;
  onSaved?: () => void;
  enableInlineEdit?: boolean;
};

export type emptyRowProps = GridCellBindings & {
  dates: string[];
  holidayList: Array<string>;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  onCellClick?: (data) => void;
  disabled?: boolean;
  rowClassName?: string;
  headingCellClassName?: string;
  totalCellClassName?: string;
  cellClassName?: string;
  setSelectedTask?: React.Dispatch<React.SetStateAction<string>>;
  setIsTaskLogDialogBoxOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  taskData?: TaskDataProps;
  name?: string;
  setTaskInLocalStorage?: () => void;
  likedTaskData?: Array<object>;
  getLikedTaskData?: () => void;
};

export type RowProps = GridCellBindings & {
  dates: string[];
  tasks: TaskProps;
  holidays: HolidayProp[];
  workingHour: number;
  workingFrequency: WorkingFrequency;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  onCellClick?: (data) => void;
  importTasks?: boolean;
  loadingLikedTasks?: boolean;
  likedTaskData?: Array<object>;
  getLikedTaskData?: () => void;
  setSelectedTask: React.Dispatch<React.SetStateAction<string>>;
  setIsTaskLogDialogBoxOpen: React.Dispatch<React.SetStateAction<boolean>>;
  disabled?: boolean;
  rowClassName?: string;
  taskCellClassName?: string;
  cellClassName?: string;
  totalCellClassName?: string;
  showEmptyCell?: boolean;
  hideLikeButton?: boolean;
};

export interface leaveRowProps {
  leaves: Array<LeaveProps>;
  dates: string[];
  holidayList: Array<string>;
  expectedHours: number;
  rowClassName?: string;
  headingClassName?: string;
  dataCellClassName?: string;
  totalCellClassName?: string;
  showEmptyCell?: boolean;
}

export interface TotalHourRowProps {
  leaves: Array<LeaveProps>;
  dates: string[];
  tasks: TaskProps;
  holidays: Array<HolidayProp>;
  workingHour: number;
  workingFrequency: WorkingFrequency;
}
