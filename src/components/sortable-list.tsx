"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Vertical drag-and-drop list.
 *
 * Every row also carries up/down buttons: dnd-kit's keyboard sensor covers the
 * drag itself, and the buttons make the same move obvious to someone who never
 * discovers that a list is draggable.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  itemLabel,
  disabled,
  className,
}: {
  items: T[];
  onReorder: (ordered: T[]) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  /**
   * The item's name, for the reorder buttons to announce. Without it a screen
   * reader reads "mover para cima" a dozen times in a row with nothing to tell
   * the rows apart.
   */
  itemLabel?: (item: T, index: number) => string;
  disabled?: boolean;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    onReorder(arrayMove(items, index, target));
  }

  return (
    <DndContext
      // Stable id: dnd-kit's aria ids would otherwise differ between the
      // server render and the client one.
      id="sortable-list"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className={cn("space-y-2", className)}>
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              id={item.id}
              index={index}
              total={items.length}
              disabled={disabled}
              label={itemLabel?.(item, index) ?? `item ${index + 1}`}
              onMove={move}
            >
              {renderItem(item, index)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  index,
  total,
  disabled,
  label,
  onMove,
  children,
}: {
  id: string;
  index: number;
  total: number;
  disabled?: boolean;
  label: string;
  onMove: (index: number, direction: -1 | 1) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-surface p-2",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      {!disabled ? (
        <div className="flex flex-col items-center gap-0.5 pt-1">
          <button
            type="button"
            className="cursor-grab touch-none rounded p-0.5 text-fg-muted hover:bg-surface-muted active:cursor-grabbing"
            aria-label={`Arrastar ${label} (item ${index + 1} de ${total})`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            disabled={index === 0}
            aria-label={`Mover ${label} para a posição ${index}`}
            onClick={() => onMove(index, -1)}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            disabled={index === total - 1}
            aria-label={`Mover ${label} para a posição ${index + 2}`}
            onClick={() => onMove(index, 1)}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
