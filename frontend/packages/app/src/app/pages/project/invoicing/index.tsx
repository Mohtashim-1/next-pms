/**
 * External dependencies.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TextArea,
  Typography,
  useToast,
} from "@next-pms/design-system/components";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { CloudOff, FileCheck2, FileText, Loader2, Plus, Search, Trash2 } from "lucide-react";

/**
 * Internal dependencies.
 */
import { Header as RootHeader } from "@/app/layout/root";
import { PROJECT } from "@/lib/constant";
import { mergeClassNames, parseFrappeErrorMsg } from "@/lib/utils";

type BillableEntry = {
  timesheet_detail: string;
  project?: string;
  project_name?: string;
  employee_name?: string;
  task_subject?: string;
  activity_type?: string;
  description?: string;
  entry_date?: string;
  hours?: number;
  rate?: number;
  amount?: number;
};

type DraftLine = BillableEntry & {
  name?: string;
  include?: number | boolean;
};

type InvoiceDraft = {
  name: string;
  customer?: string;
  customer_name?: string;
  project?: string;
  project_name?: string;
  period_start?: string;
  period_end?: string;
  posting_date?: string;
  due_date?: string;
  po_no?: string;
  sales_order?: string;
  template?: string;
  status?: string;
  sales_invoice?: string;
  invoice_title?: string;
  cover_message?: string;
  notes?: string;
  terms?: string;
  total_hours?: number;
  subtotal_amount?: number;
  modified?: string;
  lines?: DraftLine[];
  preview_html?: string;
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const defaultFilters = {
  customer: "",
  project: "",
  period_start: "",
  period_end: "",
  po_no: "",
  sales_order: "",
};

const AUTOSAVE_DELAY_MS = 800;
const PREVIEW_REFRESH_DELAY_MS = 1200;

const serializeDraftPayload = (draft: InvoiceDraft) =>
  JSON.stringify({
    invoice_title: draft.invoice_title,
    cover_message: draft.cover_message,
    notes: draft.notes,
    terms: draft.terms,
    posting_date: draft.posting_date,
    due_date: draft.due_date,
    po_no: draft.po_no,
    sales_order: draft.sales_order,
    template: draft.template,
    lines: draft.lines,
  });

const SaveStatusBadge = ({ status }: { status: SaveStatus }) => {
  if (status === "saving") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving draft…
      </Badge>
    );
  }
  if (status === "dirty") {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
        Unsaved changes
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <CloudOff className="h-3 w-3" />
        Save failed
      </Badge>
    );
  }
  if (status === "saved") {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
        Draft saved
      </Badge>
    );
  }
  return null;
};

const ClientInvoicing = () => {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [filters, setFilters] = useState(defaultFilters);
  const [searchResults, setSearchResults] = useState<BillableEntry[]>([]);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const skipAutosaveRef = useRef(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: customers } = useFrappeGetDocList("Customer", {
    fields: ["name", "customer_name"],
    limit: 500,
    orderBy: { field: "customer_name", order: "asc" },
  });
  const { data: projects } = useFrappeGetDocList("Project", {
    fields: ["name", "project_name", "customer"],
    filters: filters.customer ? [["customer", "=", filters.customer]] : undefined,
    limit: 500,
    orderBy: { field: "project_name", order: "asc" },
  });
  const { data: draftsData, mutate: refreshDrafts } = useFrappeGetCall(
    "next_pms.next_pms.api.client_invoice.get_drafts",
    { status: "Draft" }
  );
  const { data: templatesData } = useFrappeGetCall(
    filters.customer ? "next_pms.next_pms.api.client_invoice.get_templates" : null,
    filters.customer ? { customer: filters.customer } : undefined
  );

  const { call: searchEntries, loading: searching } = useFrappePostCall(
    "next_pms.next_pms.api.client_invoice.search_entries"
  );
  const { call: createDraft, loading: creating } = useFrappePostCall(
    "next_pms.next_pms.api.client_invoice.create_draft"
  );
  const { call: updateDraft } = useFrappePostCall("next_pms.next_pms.api.client_invoice.update_draft");
  const { call: previewDraft } = useFrappePostCall("next_pms.next_pms.api.client_invoice.preview_draft");
  const { call: finalizeDraft, loading: finalizing } = useFrappePostCall(
    "next_pms.next_pms.api.client_invoice.finalize_draft"
  );
  const { call: abandonDraft, loading: abandoning } = useFrappePostCall(
    "next_pms.next_pms.api.client_invoice.abandon_draft"
  );
  const { call: getDraft, loading: loadingDraft } = useFrappePostCall(
    "next_pms.next_pms.api.client_invoice.get_draft"
  );

  const draftList = (draftsData?.message as InvoiceDraft[] | undefined) ?? [];
  const templates = (templatesData?.message as Array<{ name: string; template_name: string }> | undefined) ?? [];

  const applyLoadedDraft = useCallback((loaded: InvoiceDraft) => {
    skipAutosaveRef.current = true;
    setDraft(loaded);
    setPreviewHtml(loaded.preview_html || "");
    setSavedPayload(serializeDraftPayload(loaded));
    setSaveStatus("saved");
    window.setTimeout(() => {
      skipAutosaveRef.current = false;
    }, 0);
  }, []);

  const loadDraft = (name: string) => {
    getDraft({ name, include_preview: 1 })
      .then((response) => {
        const loaded = response?.message as InvoiceDraft;
        applyLoadedDraft(loaded);
        navigate(`${PROJECT}/invoicing/${loaded.name}`);
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  useEffect(() => {
    if (draftId) {
      getDraft({ name: draftId, include_preview: 1 })
        .then((response) => applyLoadedDraft(response?.message as InvoiceDraft))
        .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
    }
  }, [draftId, getDraft, toast, applyLoadedDraft]);

  const schedulePreviewRefresh = useCallback(
    (name: string) => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewTimerRef.current = setTimeout(() => {
        previewDraft({ name })
          .then((response) => setPreviewHtml((response?.message as { html?: string })?.html || ""))
          .catch(() => undefined);
      }, PREVIEW_REFRESH_DELAY_MS);
    },
    [previewDraft]
  );

  const persistDraft = useCallback(
    (draftToSave: InvoiceDraft, autosave = true) => {
      setSaveStatus("saving");
      return updateDraft({
        name: draftToSave.name,
        autosave: autosave ? 1 : 0,
        payload: JSON.stringify({
          invoice_title: draftToSave.invoice_title,
          cover_message: draftToSave.cover_message,
          notes: draftToSave.notes,
          terms: draftToSave.terms,
          posting_date: draftToSave.posting_date,
          due_date: draftToSave.due_date,
          po_no: draftToSave.po_no,
          sales_order: draftToSave.sales_order,
          template: draftToSave.template,
          lines: draftToSave.lines,
        }),
      })
        .then((response) => {
          const saved = response?.message as InvoiceDraft;
          setDraft(saved);
          setSavedPayload(serializeDraftPayload(saved));
          setSaveStatus("saved");
          refreshDrafts();
          schedulePreviewRefresh(saved.name);
          return saved;
        })
        .catch((error) => {
          setSaveStatus("error");
          toast({ variant: "destructive", description: parseFrappeErrorMsg(error) });
          throw error;
        });
    },
    [updateDraft, refreshDrafts, schedulePreviewRefresh, toast]
  );

  useEffect(() => {
    if (!draft || draft.status !== "Draft" || skipAutosaveRef.current) {
      return;
    }

    const currentPayload = serializeDraftPayload(draft);
    if (savedPayload === null) {
      setSavedPayload(currentPayload);
      return;
    }
    if (currentPayload === savedPayload) {
      return;
    }

    setSaveStatus("dirty");
    const timer = window.setTimeout(() => {
      persistDraft(draft).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [draft, savedPayload, persistDraft]);

  useEffect(
    () => () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    },
    []
  );

  const handleSearch = () => {
    if (!filters.customer || !filters.period_start || !filters.period_end) {
      toast({ variant: "destructive", description: "Client and billing period are required." });
      return;
    }
    searchEntries({
      customer: filters.customer,
      project: filters.project || undefined,
      period_start: filters.period_start,
      period_end: filters.period_end,
      po_no: filters.po_no || undefined,
      sales_order: filters.sales_order || undefined,
    })
      .then((response) => setSearchResults((response?.message as BillableEntry[]) || []))
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleCreateDraft = () => {
    createDraft({
      payload: JSON.stringify({
        customer: filters.customer,
        project: filters.project || undefined,
        period_start: filters.period_start,
        period_end: filters.period_end,
        po_no: filters.po_no || undefined,
        sales_order: filters.sales_order || undefined,
        template: templates[0]?.name,
      }),
    })
      .then((response) => {
        const created = response?.message as InvoiceDraft;
        toast({ variant: "success", description: "Invoice draft created." });
        refreshDrafts();
        loadDraft(created.name);
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const updateDraftField = (field: keyof InvoiceDraft, value: string) => {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    if (!draft?.lines) return;
    const lines = [...draft.lines];
    lines[index] = { ...lines[index], ...patch };
    if (patch.hours !== undefined || patch.rate !== undefined) {
      const hours = Number(patch.hours ?? lines[index].hours ?? 0);
      const rate = Number(patch.rate ?? lines[index].rate ?? 0);
      lines[index].amount = Number((hours * rate).toFixed(2));
    }
    const totals = lines.reduce(
      (acc, line) => {
        if (!line.include) return acc;
        acc.hours += Number(line.hours || 0);
        acc.amount += Number(line.amount || 0);
        return acc;
      },
      { hours: 0, amount: 0 }
    );
    setDraft({
      ...draft,
      lines,
      total_hours: Number(totals.hours.toFixed(2)),
      subtotal_amount: Number(totals.amount.toFixed(2)),
    });
  };

  const handlePreview = () => {
    if (!draft) return;
    previewDraft({ name: draft.name })
      .then((response) => setPreviewHtml((response?.message as { html?: string })?.html || ""))
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const handleFinalize = () => {
    if (!draft) return;
    const finalize = () =>
      finalizeDraft({ name: draft.name, submit: 0 })
        .then((response) => {
          const result = response?.message as InvoiceDraft & { sales_invoice?: string };
          toast({
            variant: "success",
            description: `Sales Invoice ${result.sales_invoice} created.`,
          });
          refreshDrafts();
          setDraft(null);
          setPreviewHtml("");
          setSavedPayload(null);
          setSaveStatus("idle");
          navigate(`${PROJECT}/invoicing`);
        })
        .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));

    if (saveStatus === "dirty" || saveStatus === "saving") {
      persistDraft(draft, false).then(finalize).catch(() => undefined);
      return;
    }
    finalize();
  };

  const handleAbandon = () => {
    if (!draft) return;
    abandonDraft({ name: draft.name })
      .then(() => {
        toast({ variant: "success", description: "Draft abandoned." });
        refreshDrafts();
        setDraft(null);
        setPreviewHtml("");
        setSavedPayload(null);
        setSaveStatus("idle");
        setAbandonOpen(false);
        navigate(`${PROJECT}/invoicing`);
      })
      .catch((error) => toast({ variant: "destructive", description: parseFrappeErrorMsg(error) }));
  };

  const includedCount = useMemo(
    () => draft?.lines?.filter((line) => line.include).length ?? 0,
    [draft?.lines]
  );

  const isDraftOpen = Boolean(draft && draft.status === "Draft");

  return (
    <div className="flex h-full flex-col">
      <RootHeader className="border-b px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1">
            <Typography variant="h3" className="flex items-center gap-2 text-lg font-semibold">
              <FileText className="h-5 w-5" />
              Client Invoicing
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              Select billable work by client, project, period, and PO. Edits auto-save as a draft until you finalize.
            </Typography>
          </div>
          {isDraftOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-500 hover:bg-amber-500">Draft</Badge>
              <SaveStatusBadge status={saveStatus} />
              {draft?.name ? (
                <Typography variant="small" className="text-muted-foreground">
                  {draft.name}
                </Typography>
              ) : null}
            </div>
          ) : null}
        </div>
      </RootHeader>

      {isDraftOpen ? (
        <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
          You are editing a draft invoice for {draft?.customer_name || draft?.customer}. Changes save automatically.
          Validation runs only when you finalize.
        </div>
      ) : null}

      <div className="grid flex-1 gap-4 overflow-auto p-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={filters.customer || "none"}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    customer: value === "none" ? "" : value,
                    project: "",
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent>
                  {customers?.map((customer) => (
                    <SelectItem key={customer.name} value={customer.name}>
                      {customer.customer_name || customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.project || "none"}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, project: value === "none" ? "" : value }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Project (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All projects</SelectItem>
                  {projects?.map((project) => (
                    <SelectItem key={project.name} value={project.name}>
                      {project.project_name || project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={filters.period_start}
                  onChange={(event) => setFilters((prev) => ({ ...prev, period_start: event.target.value }))}
                />
                <Input
                  type="date"
                  value={filters.period_end}
                  onChange={(event) => setFilters((prev) => ({ ...prev, period_end: event.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="PO number"
                  value={filters.po_no}
                  onChange={(event) => setFilters((prev) => ({ ...prev, po_no: event.target.value }))}
                />
                <Input
                  placeholder="Sales Order (optional)"
                  value={filters.sales_order}
                  onChange={(event) => setFilters((prev) => ({ ...prev, sales_order: event.target.value }))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSearch} disabled={searching}>
                  <Search className="mr-1 h-4 w-4" />
                  Search Entries
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCreateDraft}
                  disabled={creating || !searchResults.length}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Create Draft
                </Button>
              </div>

              {searchResults.length ? (
                <Typography variant="small" className="text-muted-foreground">
                  {searchResults.length} unbilled entries found.
                </Typography>
              ) : null}
            </CardContent>
          </Card>

          {draftList.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open Drafts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {draftList.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className={mergeClassNames(
                      "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/50",
                      draft?.name === item.name ? "border-amber-400 bg-amber-50/60" : ""
                    )}
                    onClick={() => loadDraft(item.name)}
                  >
                    <div>
                      <div className="font-medium">{item.customer_name || item.customer}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.period_start} to {item.period_end}
                      </div>
                    </div>
                    <Badge className="bg-amber-500 hover:bg-amber-500">Draft</Badge>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {loadingDraft && !draft ? <Skeleton className="h-64 w-full" /> : null}

          {isDraftOpen ? (
            <Card className="border-amber-200">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-base">Edit Draft</CardTitle>
                  <Typography variant="small" className="text-muted-foreground">
                    {draft?.customer_name} · {draft?.period_start} to {draft?.period_end}
                  </Typography>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-amber-500 hover:bg-amber-500">Draft</Badge>
                  <SaveStatusBadge status={saveStatus} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={draft?.invoice_title || ""}
                  onChange={(event) => updateDraftField("invoice_title", event.target.value)}
                  placeholder="Invoice title"
                />
                <Select
                  value={draft?.template || "none"}
                  onValueChange={(value) => updateDraftField("template", value === "none" ? "" : value)}
                >
                  <SelectTrigger><SelectValue placeholder="Branding template" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Default branding</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.name} value={template.name}>
                        {template.template_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <TextArea
                  placeholder="Cover message"
                  value={draft?.cover_message || ""}
                  onChange={(event) => updateDraftField("cover_message", event.target.value)}
                />
                <TextArea
                  placeholder="Notes"
                  value={draft?.notes || ""}
                  onChange={(event) => updateDraftField("notes", event.target.value)}
                />
                <TextArea
                  placeholder="Terms"
                  value={draft?.terms || ""}
                  onChange={(event) => updateDraftField("terms", event.target.value)}
                />

                <div className="space-y-2">
                  {draft?.lines?.map((line, index) => (
                    <div key={line.name || `${line.timesheet_detail}-${index}`} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={Boolean(line.include)}
                            onCheckedChange={(checked) => updateLine(index, { include: Boolean(checked) })}
                          />
                          Include
                        </label>
                        <span className="text-sm text-muted-foreground">
                          {line.project_name || line.project} · {line.entry_date}
                        </span>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <Input
                          value={line.task_subject || ""}
                          onChange={(event) => updateLine(index, { task_subject: event.target.value })}
                          placeholder="Task / activity label"
                        />
                        <Input
                          value={line.description || ""}
                          onChange={(event) => updateLine(index, { description: event.target.value })}
                          placeholder="Description"
                        />
                        <Input
                          type="number"
                          value={line.hours ?? ""}
                          onChange={(event) => updateLine(index, { hours: Number(event.target.value) })}
                          placeholder="Hours"
                        />
                        <Input
                          type="number"
                          value={line.rate ?? ""}
                          onChange={(event) => updateLine(index, { rate: Number(event.target.value) })}
                          placeholder="Rate"
                        />
                      </div>
                      <Typography variant="small" className="text-muted-foreground">
                        {line.employee_name} · Amount {line.amount ?? 0}
                      </Typography>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handlePreview}>
                    Refresh Preview
                  </Button>
                  <Button onClick={handleFinalize} disabled={finalizing || saveStatus === "saving"}>
                    <FileCheck2 className="mr-1 h-4 w-4" />
                    Finalize
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setAbandonOpen(true)}
                    disabled={abandoning}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Abandon Draft
                  </Button>
                </div>
                <Typography variant="small" className="text-muted-foreground">
                  {includedCount} lines included · {draft?.total_hours ?? 0} hours · {draft?.subtotal_amount ?? 0}
                </Typography>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-base">Client Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {previewHtml ? (
              <iframe
                title="Invoice preview"
                className="min-h-[720px] w-full rounded-md border bg-white"
                srcDoc={previewHtml}
              />
            ) : (
              <Typography variant="small" className="text-muted-foreground">
                Open a draft to preview the branded invoice. The preview refreshes automatically after changes save.
              </Typography>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Abandon draft?</DialogTitle>
            <DialogDescription>
              This discards {draft?.name} and marks it cancelled. Included timesheet lines remain unbilled and can be
              invoiced later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAbandonOpen(false)} disabled={abandoning}>
              Keep Editing
            </Button>
            <Button variant="destructive" onClick={handleAbandon} disabled={abandoning}>
              {abandoning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Abandon Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClientInvoicing;
