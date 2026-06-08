import { useEffect, useState } from "react";

import { getDayKeyOfMoment } from "../utils/dates";
import { toTimelineMoment } from "../utils/dates";
import type { ResourceAllocationEmployeeProps } from "./types";

type CanvasDragPreview = {
  groupId: string;
  startTime: number;
  endTime: number;
};

type UseTimelineCanvasDragOptions = {
  enabled: boolean;
  employees: ResourceAllocationEmployeeProps[];
  visibleTimeStart: number;
  visibleTimeEnd: number;
  onComplete: (groupId: string, startDate: string, endDate: string) => void;
};

const MIN_DRAG_MS = 2 * 60 * 60 * 1000;

export const useTimelineCanvasDrag = ({
  enabled,
  employees,
  visibleTimeStart,
  visibleTimeEnd,
  onComplete,
}: UseTimelineCanvasDragOptions) => {
  const [preview, setPreview] = useState<CanvasDragPreview | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      return;
    }

    const scrollContainer = document.querySelector<HTMLElement>(".react-calendar-timeline .rct-scroll");
    if (!scrollContainer) {
      return;
    }

    let activePointerId: number | null = null;

    const getTimeFromClientX = (clientX: number) => {
      const canvas = scrollContainer.querySelector<HTMLElement>(".rct-canvas");
      if (!canvas) {
        return visibleTimeStart;
      }

      const rect = canvas.getBoundingClientRect();
      const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
      const ratio = rect.width === 0 ? 0 : x / rect.width;
      return visibleTimeStart + ratio * (visibleTimeEnd - visibleTimeStart);
    };

    const getGroupIdFromTarget = (target: EventTarget | null) => {
      const row = (target as HTMLElement | null)?.closest?.(".rct-canvas-row");
      if (!row) {
        return null;
      }

      const rows = Array.from(scrollContainer.querySelectorAll(".rct-canvas-row"));
      const index = rows.indexOf(row);
      if (index < 0 || index >= employees.length) {
        return null;
      }

      const group = employees[index];
      if (group.isGroupHeader) {
        return null;
      }

      return group.id ?? group.name;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      if ((event.target as HTMLElement).closest(".rct-item")) {
        return;
      }

      const groupId = getGroupIdFromTarget(event.target);
      if (!groupId) {
        return;
      }

      const startTime = getTimeFromClientX(event.clientX);
      activePointerId = event.pointerId;
      setPreview({ groupId, startTime, endTime: startTime });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) {
        return;
      }

      setPreview((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          endTime: getTimeFromClientX(event.clientX),
        };
      });
    };

    const finishDrag = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) {
        return;
      }

      setPreview((current) => {
        if (!current) {
          return null;
        }

        const startTime = Math.min(current.startTime, current.endTime);
        const endTime = Math.max(current.startTime, current.endTime);
        if (endTime - startTime >= MIN_DRAG_MS) {
          const startDate = getDayKeyOfMoment(toTimelineMoment(startTime));
          const endDate = getDayKeyOfMoment(toTimelineMoment(endTime));
          onComplete(current.groupId, startDate, endDate);
        }

        return null;
      });

      activePointerId = null;
    };

    scrollContainer.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [enabled, employees, onComplete, visibleTimeEnd, visibleTimeStart]);

  return preview;
};
