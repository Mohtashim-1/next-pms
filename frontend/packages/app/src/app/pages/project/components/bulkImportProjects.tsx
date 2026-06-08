/**
 * External dependencies.
 */
import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappePostCall } from "frappe-react-sdk";
import { Download, LoaderCircle, Upload, X } from "lucide-react";
import type { KeyedMutator } from "swr";

/**
 * Internal dependencies.
 */
import { parseFrappeErrorMsg } from "@/lib/utils";
import { ProjectState, setIsBulkImportProjectDialogOpen } from "@/store/project";

const CSV_TEMPLATE = `project_name,customer,project_type,expected_start_date,expected_end_date,custom_project_manager,project_template,estimated_costing,custom_project_team,tags,company,naming_series
Sample Project,Customer Name,Internal,2026-06-08,2026-09-08,admin@example.com,,10000,Team Alpha,"tag-one,tag-two",,`;

type BulkImportProjectsProps = {
  project: ProjectState;
  mutate: KeyedMutator<unknown>;
  dispatch: React.Dispatch<{ type: string; payload?: boolean }>;
};

export const BulkImportProjects = ({ project, mutate, dispatch }: BulkImportProjectsProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvContent, setCsvContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultSummary, setResultSummary] = useState<{
    created_count: number;
    error_count: number;
    errors: Array<{ row: number; project_name?: string; error: string }>;
  } | null>(null);

  const { call } = useFrappePostCall("next_pms.api.project_creation.bulk_import_projects");

  const closeDialog = () => {
    if (isSubmitting) return;
    setCsvContent("");
    setFileName("");
    setResultSummary(null);
    dispatch(setIsBulkImportProjectDialogOpen(false));
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvContent(text);
    setFileName(file.name);
    setResultSummary(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "project-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const handleImport = () => {
    if (!csvContent) {
      toast({ variant: "destructive", description: "Choose a CSV file to import." });
      return;
    }

    setIsSubmitting(true);
    call({ csv_content: csvContent })
      .then((response) => {
        const summary = response.message;
        setResultSummary(summary);
        toast({
          variant: summary.error_count ? "destructive" : "success",
          description: `Imported ${summary.created_count} project(s)${
            summary.error_count ? `, ${summary.error_count} failed` : ""
          }.`,
        });
        if (summary.created_count > 0) {
          mutate();
        }
      })
      .catch((error) => {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(error) });
      })
      .finally(() => setIsSubmitting(false));
  };

  return (
    <Dialog open={project.isBulkImportProjectDialogOpen} onOpenChange={closeDialog}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="pb-2">
          <DialogTitle>Bulk Import Projects</DialogTitle>
          <Separator />
        </DialogHeader>

        <div className="space-y-4">
          <Typography variant="small" className="text-muted-foreground">
            Required columns: project_name, customer, project_type, expected_start_date, expected_end_date,
            custom_project_manager. Optional: project_template, estimated_costing, custom_project_team, tags, company,
            naming_series.
          </Typography>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Choose CSV
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
          </div>

          {fileName && (
            <Typography variant="small">
              Selected file: <span className="font-medium">{fileName}</span>
            </Typography>
          )}

          {resultSummary && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div>
                Created: {resultSummary.created_count} · Failed: {resultSummary.error_count}
              </div>
              {resultSummary.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1 text-destructive">
                  {resultSummary.errors.map((error) => (
                    <div key={`${error.row}-${error.project_name}`}>
                      Row {error.row}
                      {error.project_name ? ` (${error.project_name})` : ""}: {error.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-start pt-2 w-full">
          <div className="flex gap-x-4 w-full">
            <Button onClick={handleImport} disabled={isSubmitting || !csvContent}>
              {isSubmitting ? <LoaderCircle className="animate-spin w-4 h-4" /> : <Upload />}
              Import CSV
            </Button>
            <Button variant="secondary" type="button" onClick={closeDialog} disabled={isSubmitting}>
              <X />
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
