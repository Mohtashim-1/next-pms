/**
 * External dependencies.
 */
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  DeBouncedInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Typography,
} from "@next-pms/design-system/components";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Plus, Star, Trash2, X } from "lucide-react";

/**
 * Internal dependencies.
 */
import { mergeClassNames } from "@/lib/utils";
import type { Skill, SkillData } from "../../store/types";
import type { BooleanOperator, SkillBooleanQuery, SkillQueryGroup } from "../types";

const COMPARISON_OPTIONS = [
  { value: ">=", label: ">=" },
  { value: ">", label: ">" },
  { value: "=", label: "=" },
  { value: "<=", label: "<=" },
  { value: "<", label: "<" },
];

const OperatorToggle = ({
  value,
  onChange,
  label,
}: {
  value: BooleanOperator;
  onChange: (value: BooleanOperator) => void;
  label: string;
}) => (
  <div className="flex items-center gap-2">
    <Typography variant="small" className="text-muted-foreground">
      {label}
    </Typography>
    <Select value={value} onValueChange={(next) => onChange(next as BooleanOperator)}>
      <SelectTrigger className="h-8 w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="AND">AND</SelectItem>
        <SelectItem value="OR">OR</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

const SkillRow = ({
  skill,
  onChange,
  onRemove,
}: {
  skill: Skill;
  onChange: (skill: Skill) => void;
  onRemove: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
    <Badge variant="outline">{skill.name}</Badge>
    <Select value={skill.operator} onValueChange={(operator) => onChange({ ...skill, operator })}>
      <SelectTrigger className="h-8 w-16">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COMPARISON_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <div className="flex">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button key={rating} type="button" onClick={() => onChange({ ...skill, proficiency: rating / 5 })}>
          <Star
            className={mergeClassNames(
              "h-4 w-4",
              rating <= Math.round(skill.proficiency * 5)
                ? "fill-yellow-400 text-yellow-400"
                : "fill-gray-200 text-gray-200"
            )}
          />
        </button>
      ))}
    </div>
    <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${skill.name}`}>
      <X className="h-4 w-4" />
    </Button>
  </div>
);

const SkillGroupEditor = ({
  group,
  groupIndex,
  onChange,
  onRemove,
  canRemove,
}: {
  group: SkillQueryGroup;
  groupIndex: number;
  onChange: (group: SkillQueryGroup) => void;
  onRemove: () => void;
  canRemove: boolean;
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SkillData[]>([]);

  const { data } = useFrappeGetCall(
    "frappe.client.get_list",
    {
      doctype: "Skill",
      filters: [["name", "like", `%${searchQuery}%`]],
      fields: ["name"],
      limit_page_length: 20,
    },
    searchQuery ? `talent-skill-${searchQuery}` : null,
    { revalidateOnMount: false }
  );

  useEffect(() => {
    if (data?.message && searchQuery) {
      setSuggestions(data.message);
    }
  }, [data, searchQuery]);

  const addSkill = (name: string) => {
    if (group.skills.some((skill) => skill.name === name)) return;
    onChange({
      ...group,
      skills: [
        ...group.skills,
        { name, proficiency: 0.6, operator: ">=" },
      ],
    });
    setSearchQuery("");
    setSuggestions([]);
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Typography variant="small" className="font-medium">
          Skill group {groupIndex + 1}
        </Typography>
        <div className="flex items-center gap-2">
          <OperatorToggle
            value={group.operator}
            onChange={(operator) => onChange({ ...group, operator })}
            label="Within group"
          />
          {canRemove && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="relative">
        <DeBouncedInput
          placeholder="Add skill..."
          value={searchQuery}
          deBounceValue={300}
          callback={(event) => {
            const value = event.target.value;
            setSearchQuery(value);
            if (!value) {
              setSuggestions([]);
            }
          }}
        />
        {suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-background shadow-md max-h-40 overflow-y-auto">
            {suggestions.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                onClick={() => addSkill(skill.name)}
              >
                {skill.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {group.skills.map((skill) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            onChange={(updated) =>
              onChange({
                ...group,
                skills: group.skills.map((row) => (row.name === skill.name ? updated : row)),
              })
            }
            onRemove={() =>
              onChange({
                ...group,
                skills: group.skills.filter((row) => row.name !== skill.name),
              })
            }
          />
        ))}
        {group.skills.length === 0 && (
          <Typography variant="small" className="text-muted-foreground">
            Add at least one skill to this group.
          </Typography>
        )}
      </div>
    </div>
  );
};

export const BooleanSkillQueryBuilder = ({
  value,
  onChange,
}: {
  value: SkillBooleanQuery;
  onChange: (value: SkillBooleanQuery) => void;
}) => {
  const updateGroup = (index: number, group: SkillQueryGroup) => {
    const groups = [...value.groups];
    groups[index] = group;
    onChange({ ...value, groups });
  };

  return (
    <div className="space-y-3">
      <OperatorToggle
        value={value.operator}
        onChange={(operator) => onChange({ ...value, operator })}
        label="Between groups"
      />
      {value.groups.map((group, index) => (
        <SkillGroupEditor
          key={`group-${index}`}
          group={group}
          groupIndex={index}
          onChange={(updated) => updateGroup(index, updated)}
          onRemove={() => onChange({ ...value, groups: value.groups.filter((_, i) => i !== index) })}
          canRemove={value.groups.length > 1}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ ...value, groups: [...value.groups, { operator: "AND", skills: [] }] })}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add skill group
      </Button>
    </div>
  );
};
