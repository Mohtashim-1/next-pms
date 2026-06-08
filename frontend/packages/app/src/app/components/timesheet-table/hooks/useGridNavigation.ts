/**
 * External dependencies
 */
import { useCallback, useState } from "react";

export type GridPosition = {
  row: number;
  col: number;
};

type UseGridNavigationOptions = {
  rowCount: number;
  colCount: number;
};

export const useGridNavigation = ({ rowCount, colCount }: UseGridNavigationOptions) => {
  const [focusedCell, setFocusedCell] = useState<GridPosition>({ row: 0, col: 0 });
  const [editingCell, setEditingCell] = useState<GridPosition | null>(null);

  const moveFocus = useCallback(
    (rowDelta: number, colDelta: number) => {
      setFocusedCell((current) => {
        const nextRow = Math.min(Math.max(current.row + rowDelta, 0), Math.max(rowCount - 1, 0));
        const nextCol = Math.min(Math.max(current.col + colDelta, 0), Math.max(colCount - 1, 0));
        if (current.row === nextRow && current.col === nextCol) {
          return current;
        }
        return { row: nextRow, col: nextCol };
      });
    },
    [rowCount, colCount]
  );

  const handleContainerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (editingCell) return;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          moveFocus(0, 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveFocus(0, -1);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveFocus(1, 0);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(-1, 0);
          break;
        case "Tab":
          event.preventDefault();
          moveFocus(0, event.shiftKey ? -1 : 1);
          break;
        case "Enter":
          event.preventDefault();
          setEditingCell(focusedCell);
          break;
        default:
          break;
      }
    },
    [editingCell, focusedCell, moveFocus]
  );

  const isFocused = useCallback(
    (row: number, col: number) => focusedCell.row === row && focusedCell.col === col,
    [focusedCell]
  );

  const isEditing = useCallback(
    (row: number, col: number) => editingCell?.row === row && editingCell?.col === col,
    [editingCell]
  );

  const startEditing = useCallback((row: number, col: number) => {
    setFocusedCell({ row, col });
    setEditingCell({ row, col });
  }, []);

  const stopEditing = useCallback(() => {
    setEditingCell(null);
  }, []);

  const focusCell = useCallback((row: number, col: number) => {
    setFocusedCell((current) => {
      if (current.row === row && current.col === col) {
        return current;
      }
      return { row, col };
    });
  }, []);

  return {
    focusedCell,
    editingCell,
    handleContainerKeyDown,
    isFocused,
    isEditing,
    startEditing,
    stopEditing,
    focusCell,
    moveFocus,
  };
};
