/**
 * External dependencies.
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
import { Bookmark, Copy, EllipsisVertical, Globe, Plus, Trash2 } from "lucide-react";

/**
 * Internal dependencies.
 */
import { CreateView } from "@/app/components/list-view/createView";
import { copyToClipboard, parseFrappeErrorMsg } from "@/lib/utils";
import { removeView, setViews, ViewData } from "@/store/view";
import type { TalentFinderFilters } from "../types";

type SavedSearchActionsProps = {
  viewData: ViewData;
  filters: TalentFinderFilters;
};

export const SavedSearchActions = ({ viewData, filters }: SavedSearchActionsProps) => {
  const { toast } = useToast();
  const dispatch = useDispatch();
  const [createOpen, setCreateOpen] = useState(false);
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
  const { call: fetchViews } = useFrappePostCall(
    "next_pms.timesheet.doctype.pms_view_setting.pms_view_setting.get_views"
  );

  const refreshViews = () =>
    fetchViews({}).then((response) => {
      dispatch(setViews(response.message));
    });

  const shareSearch = () => {
    const url = `${window.location.origin}${window.location.pathname}?view=${viewData.name}`;
    copyToClipboard(url);
    toast({ variant: "success", description: "Search link copied to clipboard." });
  };

  const makePublic = () => {
    if (!viewData.name || updateLoading) return;
    updateDoc("PMS View Setting", viewData.name, { public: 1 })
      .then(() => refreshViews())
      .then(() => toast({ variant: "success", description: "Search is now public." }))
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const deleteSearch = () => {
    if (!viewData.name || deleteLoading) return;
    deleteDoc("PMS View Setting", viewData.name)
      .then(() => {
        dispatch(removeView(viewData.name!));
        toast({ variant: "success", description: "Saved search deleted." });
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-10 gap-2">
            <Bookmark className="h-4 w-4" />
            <span className="hidden sm:inline">Saved Searches</span>
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 p-1">
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2 cursor-pointer">
            <Plus className="h-4 w-4" />
            <Typography variant="p" className="text-sm">
              Save Current Search
            </Typography>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={shareSearch} className="gap-2 cursor-pointer">
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={deleteSearch} disabled={deleteLoading} className="gap-2 cursor-pointer">
                <Trash2 className="h-4 w-4" />
                <Typography variant="p" className="text-sm">
                  Delete Saved Search
                </Typography>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {createOpen && (
        <CreateView
          isOpen={createOpen}
          dt={viewData.dt}
          rows={viewData.rows}
          filters={filters}
          orderBy={viewData.order_by}
          columns={viewData.columns}
          pinnedColumns={viewData.pinnedColumns}
          route={viewData.route}
          isDefault={false}
          isPublic={false}
          setIsOpen={setCreateOpen}
        />
      )}
    </>
  );
};
