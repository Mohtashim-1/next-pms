import type { TimelineColorMode } from "./timelineZoom";
import type { ResourceAllocationTimeLineProps } from "./types";

const PROJECT_PALETTE = [
  "#4F86C6",
  "#6BCB77",
  "#F4A261",
  "#9B5DE5",
  "#00BBF9",
  "#F15BB5",
  "#2EC4B6",
  "#E76F51",
  "#8AC926",
  "#577590",
];

const STATUS_COLORS: Record<string, { background: string; border: string; text: string }> = {
  Confirmed: { background: "rgba(107, 203, 119, 0.45)", border: "#3f9f4f", text: "#1f5f2d" },
  Tentative: { background: "rgba(244, 162, 97, 0.45)", border: "#d4883f", text: "#7a4a12" },
  Billable: { background: "rgba(147, 221, 137, 0.45)", border: "#5ea854", text: "#2f5f2a" },
  "Non-Billable": { background: "rgba(215, 215, 123, 0.35)", border: "#b8b85f", text: "#66662f" },
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const colorFromKey = (key: string) => PROJECT_PALETTE[hashString(key) % PROJECT_PALETTE.length];

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

export const getAllocationColors = (
  allocation: ResourceAllocationTimeLineProps,
  colorMode: TimelineColorMode
) => {
  if (allocation.type === "leave") {
    return {
      background: "rgba(248, 113, 113, 0.35)",
      border: "#ef4444",
      text: "#991b1b",
    };
  }

  let key = allocation.project || allocation.project_name || "Unassigned";
  if (colorMode === "status") {
    const statusKey = allocation.status || (allocation.is_billable ? "Billable" : "Non-Billable");
    return STATUS_COLORS[statusKey] ?? STATUS_COLORS.Billable;
  }

  if (colorMode === "skill") {
    key = allocation.primary_skill || allocation.employee || allocation.employee_name || key;
  }

  const base = colorFromKey(key);
  return {
    background: hexToRgba(base, 0.42),
    border: base,
    text: base,
  };
};
