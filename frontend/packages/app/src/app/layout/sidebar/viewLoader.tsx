/**
 * External dependencies.
 */
import { NavLink } from "react-router-dom";
import { Typography, Button, Separator } from "@next-pms/design-system/components";
import { ChevronDown, ChevronUp, Circle } from "lucide-react";
/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import type { ViewData } from "@/store/view";

const ViewLoader = ({
  isSidebarCollapsed,
  openRoutes,
  views,
  label,
  onClick,
  hasPmRole,
  id,
}: {
  hasPmRole: boolean;
  label: string;
  id: string;
  isSidebarCollapsed: boolean;
  openRoutes: {
    [key: string]: boolean;
  };
  views: ViewData[];
  onClick: () => void;
}) => {
  if (!hasPmRole || views.length == 0) return null;
  return (
    <>
      <Separator className="my-1" />
      <div className="flex flex-col gap-y-2">
        {!isSidebarCollapsed && (
          <Button
            variant="ghost"
            className={mergeClassNames(
              "flex items-center gap-x-2 w-full text-left p-2 hover:bg-accent rounded-lg justify-between"
            )}
            onClick={onClick}
          >
            <span className="flex items-center gap-x-2">
              {openRoutes[id] ? <ChevronUp /> : <ChevronDown />}
              <Typography variant="p" className={mergeClassNames(" ", isSidebarCollapsed && "hidden")}>
                {label}
              </Typography>
            </span>
          </Button>
        )}
        <div
          className={mergeClassNames(
            " flex flex-col gap-y-1",
            !isSidebarCollapsed && openRoutes[id] ? "flex pl-3" : "hidden",
            isSidebarCollapsed && "flex"
          )}
        >
          {views.map((view: ViewData) => {
            const isActive = view.route === window.location.pathname;
            return (
              <NavLink
                to={`${view.route}?view=${view.name}`}
                key={view.name}
                title={view.label}
                className=" flex items-center h-9"
              >
                <div
                  className={mergeClassNames(
                    "flex w-full rounded-lg items-center p-2 hover:bg-accent text-foreground gap-x-2",
                    isActive && "border-l-2 border-primary bg-accent shadow-md"
                  )}
                >
                  <span className="shrink-0">
                    {view.icon || <Circle className="w-5 h-5 font-bold text-foreground" />}
                  </span>
                  <Typography
                    variant="p"
                    className={mergeClassNames(
                      "transition-all duration-300 truncate ease-in-out text-foreground",
                      isActive && "text-foreground",
                      isSidebarCollapsed && "hidden"
                    )}
                  >
                    {view.label}
                  </Typography>
                </div>
              </NavLink>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default ViewLoader;
