/**
 * External dependencies.
 */
import { z } from "zod";

export const ProjectSchema = z
  .object({
    naming_series: z
      .string({
        required_error: "Please select a naming series.",
      })
      .trim()
      .min(1, { message: "Please select a naming series." }),
    project_name: z
      .string({
        required_error: "Please add a project name.",
      })
      .trim()
      .min(1, { message: "Please add a project name." }),
    customer: z
      .string({
        required_error: "Please select a client.",
      })
      .trim()
      .min(1, { message: "Please select a client." }),
    project_type: z
      .string({
        required_error: "Please select a project type.",
      })
      .trim()
      .min(1, { message: "Please select a project type." }),
    expected_start_date: z
      .string({
        required_error: "Please select a start date.",
      })
      .trim()
      .min(1, { message: "Please select a start date." }),
    expected_end_date: z
      .string({
        required_error: "Please select an end date.",
      })
      .trim()
      .min(1, { message: "Please select an end date." }),
    custom_project_manager: z
      .string({
        required_error: "Please select a project manager.",
      })
      .trim()
      .min(1, { message: "Please select a project manager." }),
    company: z
      .string({
        required_error: "Please select a company.",
      })
      .trim()
      .min(1, { message: "Please select a company." }),
    project_template: z.string().optional(),
    estimated_costing: z.coerce.number().nonnegative().optional(),
    custom_project_team: z.string().optional(),
    tags: z.string().optional(),
    create_from_template: z.boolean().optional(),
  })
  .refine((data) => data.expected_end_date >= data.expected_start_date, {
    message: "End date must be on or after start date.",
    path: ["expected_end_date"],
  });
