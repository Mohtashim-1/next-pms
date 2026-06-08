/**
 * External dependencies
 */
import { useState } from "react";
import { useDispatch } from "react-redux";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeDeleteDoc, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Copy, Download, EllipsisVertical, FileJson, Globe, Plus, Trash2 } from "lucide-react";

/**
 * Internal dependencies
 */
import { CreateView } from "@/app/components/list-view/createView";
import { copyToClipboard, parseFrappeErrorMsg } from "@/lib/utils";
import { removeView, setViews, ViewData } from "@/store/view";
import {
  downloadTimelineCsvSnapshot,
  downloadTimelineJsonSnapshot,
} from "../shared/exportSnapshot";
import type { ResourceAllocationTimeLineProps } from "../timeline/types";

type ResourceViewActionsProps = {
  viewData: ViewData;
  filters: Record<string, unknown>;
  employees: Array<{ name: string; employee_name: string; department?: string; designation?: string }>;
  allocations?: ResourceAllocationTimeLineProps[];
};

export const ResourceViewActions = ({
  viewData,
  filters,
  employees,
  allocations = [],
}: ResourceViewActionsProps) => {
  const { toast } = useToast();
  const dispatch = useDispatch();
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
  const { call: fetchViews } = useFrappePostCall(
    "next_pms.timesheet.doctype.pms_view_setting.pms_view_setting.get_views"
  );

  const refreshViews = () =>
    fetchViews({}).then((response) => {
      dispatch(setViews(response.message));
    });

  const shareView = () => {
    const url = `${window.location.origin}${window.location.pathname}?view=${viewData.name}`;
    copyToClipboard(url);
    toast({ variant: "success", description: "View link copied to clipboard." });
  };

  const makePublic = () => {
    if (!viewData.name || updateLoading) return;
    updateDoc("PMS View Setting", viewData.name, { public: 1 })
      .then(() => refreshViews())
      .then(() => toast({ variant: "success", description: "View is now public." }))
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const deleteView = () => {
    if (!viewData.name || deleteLoading) return;
    deleteDoc("PMS View Setting", viewData.name)
      .then(() => {
        dispatch(removeView(viewData.name!));
        toast({ variant: "success", description: "View deleted." });
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const exportSnapshot = (format: "csv" | "json") => {
    const payload = {
      viewLabel: viewData.label,
      filters,
      employees,
      allocations,
    };
    if (format === "csv") {
      downloadTimelineCsvSnapshot(payload);
    } else {
      downloadTimelineJsonSnapshot(payload);
    }
    toast({ variant: "success", description: `Exported ${format.toUpperCase()} snapshot.` });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-10 px-2" aria-label="View actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 p-1">
          <DropdownMenuItem onClick={() => setCreateViewOpen(true)} className="gap-2 cursor-pointer">
            <Plus className="h-4 w-4" />
            <Typography variant="p" className="text-sm">
              Save as New View
            </Typography>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={shareView} className="gap-2 cursor-pointer">
            <Copy className="h-4 w-4" />
            <Typography variant="p" className="text-sm">
              Copy Share Link
            </Typography>
          </DropdownMenuItem>
          {!viewData.default && !viewData.public && (
            <>
              <DropdownMenuItem onClick={makePublic} disabled={updateLoading} className="gap-2 cursor-pointer">
                <Globe className="h-4 w-4" />
                <Typography variant="p" className="text-sm">
                  Make Public
                </Typography>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={deleteView} disabled={deleteLoading} className="gap-2 cursor-pointer">
                <Trash2 className="h-4 w-4" />
                <Typography variant="p" className="text-sm">
                  Delete View
                </Typography>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => exportSnapshot("csv")} className="gap-2 cursor-pointer">
            <Download className="h-4 w-4" />
            <Typography variant="p" className="text-sm">
              Export CSV Snapshot
            </Typography>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportSnapshot("json")} className="gap-2 cursor-pointer">
            <FileJson className="h-4 w-4" />
            <Typography variant="p" className="text-sm">
              Export JSON Snapshot
            </Typography>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {createViewOpen && (
        <CreateView
          isOpen={createViewOpen}
          dt={viewData.dt}
          rows={viewData.rows}
          filters={filters}
          orderBy={viewData.order_by}
          columns={viewData.columns}
          pinnedColumns={viewData.pinnedColumns}
          route={viewData.route}
          isDefault={false}
          isPublic={false}
          setIsOpen={setCreateViewOpen}
        />
      )}
    </>
  );
};
