/**
 * External dependencies
 */
import { useCallback, useEffect, useState } from "react";
import { ButtonProps, useToast } from "@next-pms/design-system/components";
import { getFormatedDate } from "@next-pms/design-system/date";
import { useQueryParam } from "@next-pms/hooks";
import { addDays } from "date-fns";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import _ from "lodash";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
/**
 * Internal dependencies
 */
import { Header as ListViewHeader } from "@/app/components/list-view/header";
import { TEAM_APPROVALS } from "@/lib/constant";
import { parseFrappeErrorMsg } from "@/lib/utils";
import type { HeaderProps } from "./types";

export const Header = ({ teamState, dispatch, viewData }: HeaderProps) => {
  const navigate = useNavigate();
  const { data: approvalCountData } = useFrappeGetCall(
    "next_pms.timesheet.api.approval_queue.get_approval_queue_count",
    { week_start: teamState.weekDate },
    `approval-queue-count-${teamState.weekDate}`
  );
  const approvalQueueCount = approvalCountData?.message?.count ?? 0;
  const [projectSearch, setProjectSearch] = useState<string>("");
  const [userGroupSearch, setUserGroupSearch] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [projectTypeSearch, setProjectTypeSearch] = useState<string>("");
  const [taskSearch, setTaskSearch] = useState<string>("");
  const [departmentSearch, setDepartmentSearch] = useState<string>("");
  const [designationSearch, setDesignationSearch] = useState<string>("");
  const [projectParam] = useQueryParam<string[]>("project", []);
  const [userGroupParam] = useQueryParam<string[]>("user-group", []);
  const [statusParam] = useQueryParam<string[]>("status", []);
  const [employeeNameParam] = useQueryParam<string>("employee-name", "");
  const [reportsToParam] = useQueryParam<string>("reports-to", "");
  const [employeeStatusParam] = useQueryParam<Array<string>>("emp-status", viewData.filters.status);
  const [departmentParam] = useQueryParam<string[]>("department", []);
  const [designationParam] = useQueryParam<string[]>("designation", []);
  const [customerParam] = useQueryParam<string[]>("customer", []);
  const [projectTypeParam] = useQueryParam<string[]>("project-type", []);
  const [taskParam] = useQueryParam<string[]>("task", []);
  const { data: employee } = useFrappeGetCall("next_pms.timesheet.api.employee.get_employee", {
    filters: { name: reportsToParam || viewData.filters.reportsTo },
  });
  const { toast } = useToast();
  useEffect(() => {
    const payload = {
      project: projectParam?.length ? projectParam : viewData.filters.project ?? [],
      userGroup: userGroupParam?.length ? userGroupParam : viewData.filters.userGroup ?? [],
      statusFilter: statusParam?.length ? statusParam : viewData.filters.statusFilter ?? [],
      employeeName: employeeNameParam || viewData.filters.employeeName || "",
      reportsTo: reportsToParam || viewData.filters.reportsTo || "",
      status: employeeStatusParam?.length ? employeeStatusParam : viewData.filters.status ?? ["Active"],
      department: departmentParam?.length ? departmentParam : viewData.filters.department ?? [],
      designation: designationParam?.length ? designationParam : viewData.filters.designation ?? [],
      customer: customerParam?.length ? customerParam : viewData.filters.customer ?? [],
      projectType: projectTypeParam?.length ? projectTypeParam : viewData.filters.projectType ?? [],
      task: taskParam?.length ? taskParam : viewData.filters.task ?? [],
    };
    dispatch({ type: "SET_FILTERS", payload });
  }, [
    dispatch,
    employeeNameParam,
    employeeStatusParam,
    projectParam,
    reportsToParam,
    statusParam,
    userGroupParam,
    departmentParam,
    designationParam,
    customerParam,
    projectTypeParam,
    taskParam,
    viewData.filters,
  ]);

  const handleEmployeeChange = useCallback(
    (text: string) => {
      dispatch({ type: "SET_EMPLOYEE_NAME", payload: text.trim() });
    },
    [dispatch]
  );
  const handleReportsToChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_ACTION", payload: "SET" });
      dispatch({ type: "SET_REPORTS_TO", payload: value as string });
    },
    [dispatch]
  );
  const handleStatusChange = useCallback(
    (filters: string | string[]) => {
      const normalizedFilters = Array.isArray(filters) ? filters : [filters];
      dispatch({ type: "SET_STATUS_FILTER", payload: normalizedFilters });
    },
    [dispatch]
  );
  const handleEmployeeStatusChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_STATUS", payload: value as string[] });
    },
    [dispatch]
  );
  const handleProjectChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_PROJECT", payload: value as string[] });
    },
    [dispatch]
  );
  const handleUserGroupChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_USER_GROUP", payload: value as string[] });
    },
    [dispatch]
  );
  const handleDepartmentChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_DEPARTMENT", payload: value as string[] });
    },
    [dispatch]
  );
  const handleDesignationChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_DESIGNATION", payload: value as string[] });
    },
    [dispatch]
  );
  const handleCustomerChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_CUSTOMER", payload: value as string[] });
    },
    [dispatch]
  );
  const handleProjectTypeChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_PROJECT_TYPE", payload: value as string[] });
    },
    [dispatch]
  );
  const handleTaskChange = useCallback(
    (value: string | string[]) => {
      dispatch({ type: "SET_TASK", payload: value as string[] });
    },
    [dispatch]
  );
  const handleprevWeek = useCallback(() => {
    const date = getFormatedDate(addDays(teamState.weekDate, -7));
    dispatch({ type: "SET_WEEK_DATE", payload: date });
  }, [dispatch, teamState.weekDate]);

  const handlenextWeek = useCallback(() => {
    const date = getFormatedDate(addDays(teamState.weekDate, 7));
    dispatch({ type: "SET_WEEK_DATE", payload: date });
  }, [dispatch, teamState.weekDate]);

  const { call: updateView } = useFrappePostCall(
    "next_pms.timesheet.doctype.pms_view_setting.pms_view_setting.update_view"
  );

  const currentViewFilters = {
    status: teamState.status,
    employeeName: teamState.employeeName,
    reportsTo: teamState.reportsTo,
    statusFilter: teamState.statusFilter,
    project: teamState.project,
    userGroup: teamState.userGroup,
    department: teamState.department,
    designation: teamState.designation,
    customer: teamState.customer,
    projectType: teamState.projectType,
    task: teamState.task,
  };

  useEffect(() => {
    if (!_.isEqual(viewData.filters, currentViewFilters)) {
      dispatch({ type: "SET_HAS_VIEW_UPDATED", payload: true });
    } else {
      dispatch({ type: "SET_HAS_VIEW_UPDATED", payload: false });
    }
  }, [
    teamState.employeeName,
    teamState.status,
    teamState.reportsTo,
    teamState.statusFilter,
    teamState.project,
    teamState.userGroup,
    teamState.department,
    teamState.designation,
    teamState.customer,
    teamState.projectType,
    teamState.task,
    viewData,
    dispatch,
  ]);

  const handleSaveChanges = () => {
    updateView({
      view: { ...viewData, filters: currentViewFilters },
    })
      .then(() => {
        toast({
          variant: "success",
          description: "View Updated",
        });
        dispatch({ type: "SET_HAS_VIEW_UPDATED", payload: false });
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast({
          variant: "destructive",
          description: error,
        });
      });
  };

  return (
    <ListViewHeader
      filters={[
        {
          type: "search",
          queryParameterName: "employee-name",
          label: "Employee",
          defaultValue: "",
          value: teamState.employeeName,
          queryParameterDefault: teamState.employeeName,
          handleChange: handleEmployeeChange,
          handleDelete: useCallback(() => {
            dispatch({ type: "SET_EMPLOYEE_NAME", payload: "" });
          }, [dispatch]),
        },
        {
          type: "search-employee",
          queryParameterName: "reports-to",
          handleChange: handleReportsToChange,
          handleDelete: useCallback(() => {
            dispatch({ type: "SET_REPORTS_TO", payload: "" });
          }, [dispatch]),
          value: teamState.reportsTo,
          label: "Reports To",
          employeeName: employee?.message?.employee_name,
          queryParameterDefault: "",
        },
        {
          type: "select-list",
          data: [
            { label: "Active", value: "Active" },
            { label: "Inactive", value: "Inactive" },
            { label: "Suspended", value: "Suspended" },
            { label: "Left", value: "Left" },
          ],
          label: "Employee Status",
          queryParameterName: "emp-status",
          value: teamState.status,
          queryParameterDefault: teamState.status,
          handleChange: handleEmployeeStatusChange,
          handleDelete: handleEmployeeStatusChange,
        },
        {
          type: "select-list",
          data: [
            { label: "Not Submitted", value: "Not Submitted" },
            { label: "Approval Pending", value: "Approval Pending" },
            { label: "Pending HR Approval", value: "Pending HR Approval" },
            { label: "Approved", value: "Approved" },
            { label: "Rejected", value: "Rejected" },
            { label: "Partially Approved", value: "Partially Approved" },
            { label: "Partially Rejected", value: "Partially Rejected" },
          ],
          label: "Approval Status",
          queryParameterName: "status",
          value: teamState.statusFilter,
          queryParameterDefault: teamState.statusFilter,
          handleChange: handleStatusChange,
          handleDelete: handleStatusChange,
          isMultiComboBox: true,
          shouldFilterComboBox: true,
        },
        {
          type: "select-search",
          queryParameterName: "customer",
          label: "Customer",
          value: teamState.customer,
          queryParameterDefault: teamState.customer,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "Customer",
              fields: ["name", "customer_name as label"],
              or_filters: [
                ["name", "like", `%${customerSearch}%`],
                ["customer_name", "like", `%${customerSearch}%`],
              ],
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setCustomerSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleCustomerChange,
          handleDelete: handleCustomerChange,
        },
        {
          type: "select-search",
          queryParameterName: "project",
          label: "Project",
          value: teamState.project,
          queryParameterDefault: teamState.project,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "Project",
              fields: ["name", "project_name as label"],
              or_filters: [
                ["name", "like", `%${projectSearch}%`],
                ["project_name", "like", `%${projectSearch}%`],
              ],
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setProjectSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleProjectChange,
          handleDelete: handleProjectChange,
        },
        {
          type: "select-search",
          queryParameterName: "project-type",
          label: "Project Type",
          value: teamState.projectType,
          queryParameterDefault: teamState.projectType,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "Project Type",
              fields: ["name"],
              or_filters: [["name", "like", `%${projectTypeSearch}%`]],
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setProjectTypeSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleProjectTypeChange,
          handleDelete: handleProjectTypeChange,
        },
        {
          type: "select-search",
          queryParameterName: "task",
          label: "Task",
          value: teamState.task,
          queryParameterDefault: teamState.task,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "Task",
              fields: ["name", "subject as label"],
              or_filters: [
                ["name", "like", `%${taskSearch}%`],
                ["subject", "like", `%${taskSearch}%`],
              ],
              limit_page_length: 50,
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setTaskSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleTaskChange,
          handleDelete: handleTaskChange,
        },
        {
          type: "select-search",
          queryParameterName: "department",
          label: "Department",
          value: teamState.department,
          queryParameterDefault: teamState.department,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "Department",
              fields: ["name"],
              or_filters: [["name", "like", `%${departmentSearch}%`]],
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setDepartmentSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleDepartmentChange,
          handleDelete: handleDepartmentChange,
        },
        {
          type: "select-search",
          queryParameterName: "designation",
          label: "Designation",
          value: teamState.designation,
          queryParameterDefault: teamState.designation,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "Designation",
              fields: ["name"],
              or_filters: [["name", "like", `%${designationSearch}%`]],
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setDesignationSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleDesignationChange,
          handleDelete: handleDesignationChange,
        },
        {
          type: "select-search",
          queryParameterName: "user-group",
          label: "User Group",
          value: teamState.userGroup,
          queryParameterDefault: teamState.userGroup,
          apiCall: {
            url: "frappe.client.get_list",
            filters: {
              doctype: "User Group",
              fields: ["name"],
              or_filters: [["name", "like", `%${userGroupSearch}%`]],
            },
            options: {
              revalidateOnFocus: false,
              revalidateIfStale: false,
            },
          },
          onComboSearch: (searchTerm: string) => {
            setUserGroupSearch(searchTerm);
          },
          shouldFilterComboBox: false,
          isMultiComboBox: true,
          handleChange: handleUserGroupChange,
          handleDelete: handleUserGroupChange,
        },
      ]}
      buttons={[
        {
          title: "Approval Queue",
          handleClick: () => navigate(TEAM_APPROVALS),
          label: approvalQueueCount ? `Approvals (${approvalQueueCount})` : "Approvals",
          icon: ClipboardCheck,
          className: "h-10 px-3 py-2",
        },
        {
          title: "Save changes",
          handleClick: () => {
            handleSaveChanges();
          },
          hide: !teamState.hasViewUpdated,
          label: "Save changes",
          variant: "ghost" as ButtonProps["variant"],
          className: "h-10 px-2 py-2",
        },
        {
          title: "prev-week",
          handleClick: handleprevWeek,
          icon: ChevronLeft,
        },
        {
          title: "next-week",
          handleClick: handlenextWeek,
          icon: ChevronRight,
        },
      ]}
      showFilterValue
    />
  );
};
