/**
 * External dependencies.
 */
import { Avatar, Badge, Typography } from "@next-pms/design-system/components";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import type { TalentSearchResult } from "../types";
import { getFitScoreClass } from "../utils";

export const TalentResultsTable = ({ results }: { results: TalentSearchResult[] }) => {
  if (!results.length) {
    return (
      <Typography variant="p" className="text-sm text-muted-foreground p-4">
        No matching talent for the current search.
      </Typography>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Fit</th>
            <th className="px-3 py-2 text-left font-medium">Employee</th>
            <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Location</th>
            <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Timezone</th>
            <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Language</th>
            <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Bill rate</th>
            <th className="px-3 py-2 text-right font-medium">Availability</th>
            <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">Top skills</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.employee} className="border-t align-top">
              <td className="px-3 py-3">
                <div
                  className={mergeClassNames(
                    "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                    getFitScoreClass(result.fit_score)
                  )}
                >
                  {result.fit_score}
                </div>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <Avatar src={result.image} fallback={result.employee_name?.[0]} className="h-8 w-8" />
                  <div>
                    <Typography variant="p" className="font-medium">
                      {result.employee_name}
                    </Typography>
                    <Typography variant="small" className="text-muted-foreground">
                      {[result.designation, result.department].filter(Boolean).join(" · ")}
                    </Typography>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 hidden md:table-cell">{result.branch || "—"}</td>
              <td className="px-3 py-3 hidden lg:table-cell">{result.time_zone || "—"}</td>
              <td className="px-3 py-3 hidden lg:table-cell">{result.language || "—"}</td>
              <td className="px-3 py-3 text-right hidden sm:table-cell">
                {result.bill_rate > 0 ? `$${result.bill_rate}` : "—"}
              </td>
              <td className="px-3 py-3 text-right">
                <div className="font-medium">{result.availability.available_hours}h free</div>
                <Typography variant="small" className="text-muted-foreground">
                  {result.availability.availability_pct}% of {result.availability.capacity_hours}h
                </Typography>
              </td>
              <td className="px-3 py-3 hidden xl:table-cell">
                <div className="flex flex-wrap gap-1">
                  {result.skills.slice(0, 4).map((skill) => (
                    <Badge key={`${result.employee}-${skill.skill}`} variant="outline" className="text-xs">
                      {skill.skill}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
