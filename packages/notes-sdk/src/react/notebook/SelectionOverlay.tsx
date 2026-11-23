import { ColorField, IconButton } from "@hussmartinez/ui/react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { boundsOf } from "../../core/ink/bounds.js";
import { scaleItems, translateItems } from "../../core/ink/transform.js";
import type { NotesRect } from "../../core/model/geometry.js";
import type { NotesColor, NotesItem } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { paintItems } from "../canvas/paint.js";
import { textHeight } from "../canvas/text-layout.js";
import { useNotes } from "../context.js";
import type { InkPage } from "./ink-controller.js";
import { PEN_COLORS } from "./ToolOptions.js";

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

export interface SelectionOverlayProps {
  readonly info: NotesPageInfo;
  readonly pixelsPerPoint: number;
  /** The selected items, as the page holds them. */
  readonly items: readonly NotesItem[];
  /** The page on screen, whose wet canvas shows the items while they move. */
  readonly page: () => InkPage | undefined;
  readonly images: ImageCache;
  /** A move or a resize began: the page stops drawing the items itself. */
  readonly onDragStart: () => void;
  /** It ended, with the items as they are now, or `undefined` if nothing changed. */
  readonly onDragEnd: (items: readonly NotesItem[] | undefined) => void;
  readonly onRecolor: (color: NotesColor) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}

interface Drag {
  readonly pointerId: number;
  readonly corner: Corner | undefined;
  readonly startX: number;
  readonly startY: number;
  readonly from: NotesRect;
}

/** The selection's box after a corner moved, keeping its proportions. */
function resized(from: NotesRect, corner: Corner, dx: number, dy: number): NotesRect {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";
  const wide = Math.max(from.width, 1);
  const tall = Math.max(from.height, 1);
  // The larger of the two pulls decides the size, so the box keeps its shape.
  const factor = Math.max(
    0.05,
    Math.max((wide + (west ? -dx : dx)) / wide, (tall + (north ? -dy : dy)) / tall),
  );
  const width = wide * factor;
  const height = tall * factor;
  return {
    x: west ? from.x + from.width - width : from.x,
    y: north ? from.y + from.height - height : from.y,
    width,
    height,
  };
}

/**
 * The box around selected items: drag it to move them, drag a corner to
 * resize them, and use its bar to recolour, duplicate or delete them. From
 * the keyboard, the arrow keys move the items by a point, or ten with Shift.
 * While they move, they're drawn on the page's wet canvas, which the
 * browser shifts and scales without repainting.
 */
export function SelectionOverlay(props: SelectionOverlayProps): ReactNode {
  const { info, items, pixelsPerPoint } = props;
  const { messages, icons } = useNotes();
  const drag = useRef<Drag | undefined>(undefined);
  const [live, setLive] = useState<NotesRect | undefined>(undefined);
  const bounds = boundsOf(items, textHeight);
  if (!bounds) return null;
  const scale = pixelsPerPoint / NOTES_UNITS_PER_POINT;
  const box = live ?? bounds;

  const begin = (event: PointerEvent<HTMLElement>, corner: Corner | undefined) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      from: bounds,
    };
    const page = props.page();
    const context = page?.wet.getContext("2d", { desynchronized: true });
    if (page && context) {
      const factor = page.wet.width / info.width;
      context.setTransform(factor, 0, 0, factor, 0, 0);
      paintItems(context, items, { images: props.images });
    }
    props.onDragStart();
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    const next = current.corner
      ? resized(current.from, current.corner, dx, dy)
      : { ...current.from, x: current.from.x + dx, y: current.from.y + dy };
    setLive(next);
    const wet = props.page()?.wet;
    if (!wet) return;
    wet.style.transformOrigin = `${current.from.x * scale}px ${current.from.y * scale}px`;
    wet.style.transform = `translate(${(next.x - current.from.x) * scale}px, ${
      (next.y - current.from.y) * scale
    }px) scale(${next.width / Math.max(1, current.from.width)}, ${
      next.height / Math.max(1, current.from.height)
    })`;
  };

  const end = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = undefined;
    const page = props.page();
    if (page) {
      page.wet.style.transform = "";
      page.wet.style.transformOrigin = "";
      const context = page.wet.getContext("2d", { desynchronized: true });
      context?.setTransform(1, 0, 0, 1, 0, 0);
      context?.clearRect(0, 0, page.wet.width, page.wet.height);
    }
    const to = live;
    setLive(undefined);
    if (cancelled || !to) {
      props.onDragEnd(undefined);
      return;
    }
    props.onDragEnd(
      current.corner
        ? scaleItems(items, current.from, to)
        : translateItems(items, to.x - current.from.x, to.y - current.from.y),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = (event.shiftKey ? 10 : 1) * NOTES_UNITS_PER_POINT;
    const by: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = by[event.key];
    if (!delta || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    props.onDragEnd(translateItems(items, delta[0], delta[1]));
  };

  const DuplicateIcon = icons["duplicate"];
  const DeleteIcon = icons["delete"];
  const recolourable = items.some((item) => item.type === "stroke" || item.type === "text");
  const colorOf = items.find((item) => item.type === "stroke" || item.type === "text");

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls over the page, not a form's fieldset
    <div
      className="hm-notes-selection"
      data-hm-notes-control=""
      role="group"
      aria-label={messages.t("selection.label", { count: items.length })}
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: Math.max(1, box.width * scale),
        height: Math.max(1, box.height * scale),
      }}
    >
      <div
        className="hm-notes-selection-box"
        role="application"
        aria-label={messages.t("selection.move")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the box takes focus so the arrow keys can move its items
        tabIndex={0}
        onPointerDown={(event) => begin(event, undefined)}
        onPointerMove={move}
        onPointerUp={(event) => end(event, false)}
        onPointerCancel={(event) => end(event, true)}
        onKeyDown={onKeyDown}
      />
      {CORNERS.map((corner) => (
        <span
          key={corner}
          className="hm-notes-selection-handle"
          data-hm-corner={corner}
          aria-hidden="true"
          onPointerDown={(event) => begin(event, corner)}
          onPointerMove={move}
          onPointerUp={(event) => end(event, false)}
          onPointerCancel={(event) => end(event, true)}
        />
      ))}
      <div className="hm-notes-selection-bar">
        {recolourable ? (
          <ColorField
            label={messages.t("selection.color")}
            swatches={PEN_COLORS.map(([name, value]) => ({
              label: (messages.t as (key: string) => string)(`options.colors.${name}`),
              value,
            }))}
            value={colorOf && "color" in colorOf ? colorOf.color : PEN_COLORS[0][1]}
            onValueChange={(value) => props.onRecolor(value.toLowerCase() as NotesColor)}
          />
        ) : null}
        <IconButton
          size="small"
          variant="quiet"
          label={messages.t("selection.duplicate")}
          icon={DuplicateIcon ? <DuplicateIcon /> : null}
          onClick={props.onDuplicate}
        />
        <IconButton
          size="small"
          variant="quiet"
          label={messages.t("selection.delete")}
          icon={DeleteIcon ? <DeleteIcon /> : null}
          onClick={props.onDelete}
        />
      </div>
    </div>
  );
}
