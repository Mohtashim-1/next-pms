/**
 * External dependencies
 */
import { useEffect, useMemo } from "react";
import moment from "moment";

/**
 * Internal dependencies
 */
import {
  buildEmployeeConflictDays,
  getConflictHeatColor,
  getConflictHeatOpacity,
} from "../timelineConflictHeat";
import type { ResourceAllocationEmployeeProps, ResourceAllocationTimeLineProps } from "../types";

type TimelineConflictOverlayProps = {
  employees: ResourceAllocationEmployeeProps[];
  allocations: ResourceAllocationTimeLineProps[];
  visibleTimeStart: number;
  visibleTimeEnd: number;
};

export const TimelineConflictOverlay = ({
  employees,
  allocations,
  visibleTimeStart,
  visibleTimeEnd,
}: TimelineConflictOverlayProps) => {
  const heatMap = useMemo(() => buildEmployeeConflictDays(employees, allocations), [employees, allocations]);

  useEffect(() => {
    const scrollContainer = document.querySelector<HTMLElement>(".react-calendar-timeline .rct-scroll");
    if (!scrollContainer) {
      return;
    }

    scrollContainer.querySelectorAll(".rm-conflict-heat").forEach((node) => node.remove());

    const canvas = scrollContainer.querySelector<HTMLElement>(".rct-canvas");
    const rows = scrollContainer.querySelectorAll<HTMLElement>(".rct-canvas-row");
    if (!canvas || !rows.length) {
      return;
    }

    const canvasWidth = canvas.getBoundingClientRect().width;
    const range = visibleTimeEnd - visibleTimeStart;

    rows.forEach((row, index) => {
      const employee = employees[index];
      if (!employee) {
        return;
      }

      const days = heatMap[employee.name] ?? [];
      days.forEach((day) => {
        if (!day.hasConflict && day.utilization < 0.65) {
          return;
        }

        const dayStart = moment(day.date).startOf("day").valueOf();
        const dayEnd = moment(day.date).endOf("day").valueOf();
        if (dayEnd < visibleTimeStart || dayStart > visibleTimeEnd) {
          return;
        }

        const leftRatio = (Math.max(dayStart, visibleTimeStart) - visibleTimeStart) / range;
        const rightRatio = (Math.min(dayEnd, visibleTimeEnd) - visibleTimeStart) / range;
        const width = Math.max(2, (rightRatio - leftRatio) * canvasWidth);
        const left = leftRatio * canvasWidth;

        const marker = document.createElement("div");
        marker.className = "rm-conflict-heat pointer-events-none absolute top-0 bottom-0";
        marker.style.left = `${left}px`;
        marker.style.width = `${width}px`;
        marker.style.background = getConflictHeatColor(day.utilization);
        marker.style.opacity = String(getConflictHeatOpacity(day.utilization));
        marker.title = `${day.date}: ${day.allocatedHours}h / ${day.capacityHours}h`;
        row.style.position = "relative";
        row.appendChild(marker);
      });
    });

    return () => {
      scrollContainer.querySelectorAll(".rm-conflict-heat").forEach((node) => node.remove());
    };
  }, [employees, heatMap, visibleTimeEnd, visibleTimeStart]);

  return null;
};
