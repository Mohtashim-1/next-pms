/**
 * Internal dependencies.
 */
import { RootState } from "@/store";

export type NestedRoute = {
  to?: string;
  label: string;
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: any;
  /** Open outside the Next PMS SPA (e.g. Desk pages) */
  external?: boolean;
  /** Category → report links under Reports */
  children?: NestedRoute[];
};

export type Route = {
  to: string;
  label: string;
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: any;
  children?: NestedRoute[];
  isPmRoute: boolean;
};

export interface UserNavigationProps {
  user: RootState["user"];
}
