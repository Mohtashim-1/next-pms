/**
 * External dependencies.
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ComboBox,
  Button,
  DialogHeader,
  DialogFooter,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Separator,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Form,
  useToast,
  Spinner,
  Checkbox,
  Typography,
} from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { addDays } from "date-fns";
import { Search, LoaderCircle, Save, X } from "lucide-react";
import type { KeyedMutator } from "swr";
import { z } from "zod";

/**
 * Internal dependencies.
 */
import { parseFrappeErrorMsg } from "@/lib/utils";
import { ProjectSchema } from "@/schema/project";
import { ProjectState, setIsAddProjectDialogOpen } from "@/store/project";
import { DocMetaProps } from "@/types";
import { AddProjectType } from "../types";

type AddProjectProps = {
  project: ProjectState;
  mutate: KeyedMutator<unknown>;
  dispatch: React.Dispatch<{ type: string; payload?: boolean }>;
  meta: DocMetaProps;
};

const getDefaultDates = () => {
  const start = getFormatedDate(new Date(), "yyyy-MM-dd");
  const end = getFormatedDate(addDays(new Date(), 30), "yyyy-MM-dd");
  return { start, end };
};

export const AddProject = ({ project, mutate, dispatch, meta }: AddProjectProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [namingSeries, setNamingSeries] = useState<Record<string, unknown>>(
    meta?.fields?.filter((item) => item.fieldname === "naming_series")[0] ?? {}
  );
  const { toast } = useToast();
  const defaultDates = getDefaultDates();

  const { call: createProject } = useFrappePostCall("next_pms.api.project_creation.create_project");
  const { call: fetchTemplateDefaults } = useFrappePostCall(
    "next_pms.api.project_creation.get_project_template_defaults"
  );

  const form = useForm<z.infer<typeof ProjectSchema>>({
    resolver: zodResolver(ProjectSchema),
    defaultValues: {
      naming_series: "",
      project_name: "",
      customer: "",
      project_type: "",
      expected_start_date: defaultDates.start,
      expected_end_date: defaultDates.end,
      custom_project_manager: "",
      company: "",
      project_template: "",
      estimated_costing: undefined,
      custom_project_team: "",
      tags: "",
      create_from_template: false,
    },
    mode: "onSubmit",
  });

  const createFromTemplate = form.watch("create_from_template");
  const selectedTemplate = form.watch("project_template");
  const startDate = form.watch("expected_start_date");

  useEffect(() => {
    if (meta?.fields) {
      setNamingSeries(meta.fields.filter((item) => item.fieldname === "naming_series")[0]);
    }
  }, [meta]);

  useEffect(() => {
    if (namingSeries) {
      const options = (namingSeries as { options?: string }).options?.split("\n")[0];
      if (options) {
        form.setValue("naming_series", options);
      }
    }
  }, [namingSeries, form]);

  const { data: companies, isLoading: isCompanyLoading } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Company",
    fields: ["name"],
    limit_page_length: 0,
  });

  useEffect(() => {
    if (companies?.message?.[0]?.name) {
      form.setValue("company", companies.message[0].name);
    }
  }, [companies, form]);

  const { data: templates, isLoading: isTemplateLoading } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Project Template",
    fields: ["name"],
    limit_page_length: 0,
  });

  const { data: customers } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Customer",
    fields: ["name", "customer_name"],
    limit_page_length: 0,
  });

  const { data: projectTypes } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "Project Type",
    fields: ["name"],
    limit_page_length: 0,
  });

  const { data: users } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "User",
    filters: { enabled: 1 },
    fields: ["name", "full_name"],
    limit_page_length: 0,
  });

  const { data: teams } = useFrappeGetCall("frappe.client.get_list", {
    doctype: "User Group",
    fields: ["name"],
    limit_page_length: 0,
  });

  useEffect(() => {
    if (!createFromTemplate || !selectedTemplate) return;

    fetchTemplateDefaults({
      template_name: selectedTemplate,
      start_date: startDate || defaultDates.start,
    })
      .then((response) => {
        const defaults = response.message;
        form.setValue("project_type", defaults.project_type || "", { shouldDirty: true, shouldValidate: true });
        form.setValue("expected_start_date", defaults.expected_start_date, { shouldDirty: true, shouldValidate: true });
        form.setValue("expected_end_date", defaults.expected_end_date, { shouldDirty: true, shouldValidate: true });
      })
      .catch((error) => {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(error) });
      });
  }, [createFromTemplate, selectedTemplate, startDate, fetchTemplateDefaults, form, toast, defaultDates.start]);

  const {
    formState: { isDirty, isValid },
  } = form;

  const handleSubmit = (data: z.infer<typeof ProjectSchema>) => {
    setIsSubmitting(true);
    const payload: AddProjectType = {
      naming_series: data.naming_series.trim(),
      project_name: data.project_name.trim(),
      customer: data.customer.trim(),
      project_type: data.project_type.trim(),
      expected_start_date: data.expected_start_date,
      expected_end_date: data.expected_end_date,
      custom_project_manager: data.custom_project_manager.trim(),
      company: data.company.trim(),
      project_template: data.project_template || null,
      estimated_costing: data.estimated_costing,
      custom_project_team: data.custom_project_team || null,
      tags: data.tags
        ? data.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      create_from_template: data.create_from_template,
    };

    createProject({ project: JSON.stringify(payload) })
      .then(() => {
        toast({ variant: "success", description: "Project created successfully" });
        setIsSubmitting(false);
        closeDialog();
      })
      .catch((err) => {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(err) });
        setIsSubmitting(false);
      });
  };

  const closeDialog = () => {
    if (isSubmitting) return;
    form.reset({
      ...form.getValues(),
      project_name: "",
      customer: "",
      project_type: "",
      expected_start_date: defaultDates.start,
      expected_end_date: defaultDates.end,
      custom_project_manager: "",
      project_template: "",
      estimated_costing: undefined,
      custom_project_team: "",
      tags: "",
      create_from_template: false,
    });
    dispatch(setIsAddProjectDialogOpen(false));
    mutate();
  };

  const setComboValue = (field: keyof z.infer<typeof ProjectSchema>, value: string | string[]) => {
    const nextValue = Array.isArray(value) ? value[0] : value;
    form.setValue(field, nextValue, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  };

  const isLoading = isCompanyLoading || isTemplateLoading;

  return (
    <Dialog onOpenChange={closeDialog} open={project.isAddProjectDialogOpen}>
      <DialogContent aria-description="" aria-describedby="" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-2">
          <DialogTitle>Add Project</DialogTitle>
          <Separator />
        </DialogHeader>

        {isLoading ? (
          <Spinner className="h-32" isFull />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="create_from_template"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(Boolean(checked))} />
                    </FormControl>
                    <FormLabel className="font-normal">Create from template (pre-fills type and dates)</FormLabel>
                  </FormItem>
                )}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="project_name"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Project Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="New Project" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customer"
                  render={() => (
                    <FormItem>
                      <FormLabel>Client *</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Client"
                          showSelected
                          shouldFilter
                          value={form.getValues("customer") ? [form.getValues("customer")] : []}
                          data={customers?.message?.map((item: { name: string; customer_name?: string }) => ({
                            label: item.customer_name || item.name,
                            value: item.name,
                          }))}
                          onSelect={(value) => setComboValue("customer", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="project_type"
                  render={() => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Project Type"
                          showSelected
                          shouldFilter
                          value={form.getValues("project_type") ? [form.getValues("project_type")] : []}
                          data={projectTypes?.message?.map((item: { name: string }) => ({
                            label: item.name,
                            value: item.name,
                          }))}
                          onSelect={(value) => setComboValue("project_type", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expected_start_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expected_end_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="custom_project_manager"
                  render={() => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Project Manager *</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Project Manager"
                          showSelected
                          shouldFilter
                          value={
                            form.getValues("custom_project_manager")
                              ? [form.getValues("custom_project_manager")]
                              : []
                          }
                          data={users?.message?.map((item: { name: string; full_name?: string }) => ({
                            label: item.full_name ? `${item.full_name} (${item.name})` : item.name,
                            value: item.name,
                          }))}
                          onSelect={(value) => setComboValue("custom_project_manager", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Typography variant="small" className="text-muted-foreground">
                Optional
              </Typography>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="project_template"
                  render={() => (
                    <FormItem>
                      <FormLabel>Template</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Project Template"
                          showSelected
                          shouldFilter
                          value={form.getValues("project_template") ? [form.getValues("project_template") as string] : []}
                          data={templates?.message?.map((item: { name: string }) => ({
                            label: item.name,
                            value: item.name,
                          }))}
                          onSelect={(value) => setComboValue("project_template", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="estimated_costing"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Budget</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          value={field.value ?? ""}
                          onChange={(event) =>
                            field.onChange(event.target.value ? Number(event.target.value) : undefined)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="custom_project_team"
                  render={() => (
                    <FormItem>
                      <FormLabel>Team</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Team"
                          showSelected
                          shouldFilter
                          value={form.getValues("custom_project_team") ? [form.getValues("custom_project_team") as string] : []}
                          data={teams?.message?.map((item: { name: string }) => ({
                            label: item.name,
                            value: item.name,
                          }))}
                          onSelect={(value) => setComboValue("custom_project_team", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <FormControl>
                        <Input placeholder="comma,separated,tags" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="naming_series"
                  render={() => (
                    <FormItem>
                      <FormLabel>Series</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Naming Series"
                          showSelected
                          shouldFilter
                          value={form.getValues("naming_series") ? [form.getValues("naming_series")] : []}
                          data={(namingSeries as { options?: string })?.options?.split("\n")?.map((item: string) => ({
                            label: item,
                            value: item,
                          }))}
                          onSelect={(value) => setComboValue("naming_series", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="company"
                  render={() => (
                    <FormItem>
                      <FormLabel>Company</FormLabel>
                      <FormControl>
                        <ComboBox
                          label="Search Company"
                          showSelected
                          shouldFilter
                          value={form.getValues("company") ? [form.getValues("company")] : []}
                          data={companies?.message?.map((item: { name: string }) => ({
                            label: item.name,
                            value: item.name,
                          }))}
                          onSelect={(value) => setComboValue("company", value)}
                          rightIcon={<Search className="h-4 w-4" />}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="sm:justify-start pt-2 w-full">
                <div className="flex gap-x-4 w-full">
                  <Button disabled={isSubmitting || !isDirty || !isValid}>
                    {isSubmitting ? <LoaderCircle className="animate-spin w-4 h-4" /> : <Save />}
                    Add Project
                  </Button>
                  <Button variant="secondary" type="button" onClick={closeDialog} disabled={isSubmitting}>
                    <X />
                    Cancel
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};
