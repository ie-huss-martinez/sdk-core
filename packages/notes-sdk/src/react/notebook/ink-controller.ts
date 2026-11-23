import type { TextHeight } from "../../core/ink/bounds.js";
import { eraseAlong, replaceErased } from "../../core/ink/erase.js";
import { hitTest, itemsInLasso } from "../../core/ink/hit.js";
import type { StrokeStyle } from "../../core/ink/outline.js";
import { recogniseShape } from "../../core/ink/shapes.js";
import { appendPoint, toStoredPoints } from "../../core/ink/simplify.js";
import type { NotesRect } from "../../core/model/geometry.js";
import type {
  NotesAudioAnchor,
  NotesItem,
  NotesStroke,
  NotesText,
} from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_MAX_STROKE_POINTS, NOTES_PRESSURE_MAX } from "../../core/model/portable.js";
import type { NotesCommand } from "../../core/operations/commands.js";
import type { NotesSession } from "../../core/session/notebook-session.js";
import type { NotesInkSettings, NotesPointerTool } from "../../features/tool-types.js";
import { paintLiveStroke } from "../canvas/paint.js";

/**
 * The ink engine's pointer handling (docs/adr/0002). It runs outside React:
 * a stroke is drawn straight to the page's wet canvas on every pointer
 * sample, and React hears of it only when the stroke ends and becomes a
 * command.
 *
 * - **A pen or a mouse writes** with the tool in hand. A pen's barrel button
 *   or its eraser end erases while held.
 * - **Fingers pan and pinch to zoom,** unless the user lets a finger write.
 * - **A palm doesn't draw or pan:** touches that begin while the pen is down
 *   or near, and touches already down when the pen lands, are ignored until
 *   they lift.
 */

/** A page on screen, as the engine draws on it. */
export interface InkPage {
  readonly info: NotesPageInfo;
  /** The page's element, whose box maps pointer positions to page units. */
  readonly element: HTMLElement;
  /** The canvas for ink that's still being drawn. */
  readonly wet: HTMLCanvasElement;
  /**
   * Repaints the finished ink from these items in place of the session's,
   * for a gesture that hasn't become a command yet. `undefined` goes back
   * to the session's items.
   */
  paint(items: readonly NotesItem[] | undefined): void;
}

/** A selection: items of one page. */
export interface NotesSelection {
  readonly page: string;
  readonly ids: readonly string[];
}

/** What the engine needs from the notebook view. */
export interface InkHost {
  /** The scrolling element that holds the pages. */
  readonly viewport: HTMLElement;
  readonly session: NotesSession;
  page(id: string): InkPage | undefined;
  settings(): NotesInkSettings;
  newId(): string;
  /** Where a new item is in the running recording, if one runs. */
  audioAnchor(): NotesAudioAnchor | undefined;
  readonly textHeight: TextHeight;
  setSelection(selection: NotesSelection | undefined): void;
  /** Opens the text editor on an existing box, or on a new one at a point. */
  editText(page: string, target: NotesText | { readonly x: number; readonly y: number }): void;
  /** Asks which page a new link over this area leads to. */
  requestLink(page: string, area: NotesRect): void;
  followLink(page: string): void;
  /** Shows a zoom that's still being pinched, about a point of the viewport. */
  previewZoom(factor: number, clientX: number, clientY: number): void;
  /** Makes a pinched zoom the real one. */
  commitZoom(factor: number, clientX: number, clientY: number): void;
  onError(error: unknown): void;
}

/** How long after a pen event touches are taken for the palm, in milliseconds. */
const PEN_NEAR_TIME = 700;
/** How long the pen must rest at the end of a stroke to ask for a straightened shape. */
const HOLD_TIME = 550;
/** How far the pen may drift while it rests, in CSS pixels. */
const HOLD_DRIFT = 6;
/** How far a pointer may move and still be a tap, in CSS pixels. */
const TAP_DISTANCE = 8;
/** A touch this large is a palm, once a pen has been used. In CSS pixels. */
const PALM_SIZE = 40;
/** The smallest link area, in units: a quarter of an inch. */
const MIN_LINK_SIDE = 1_800;
/** The colour of the lasso, the link preview and the eraser's ring. */
const GUIDE_COLOR = "#2563eb";

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

/** A pointer sequence that's drawing, erasing, selecting or panning. */
interface Gesture {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly tool: NotesPointerTool;
  readonly page: InkPage | undefined;
  /** The page's box when the gesture began. */
  readonly box: DOMRect | undefined;
  readonly startX: number;
  readonly startY: number;
  /** The stroke's points so far, as float triples in units. */
  points: number[];
  /** Predicted points, drawn but never kept. */
  predicted: number[];
  /** The eraser's or lasso's path so far, as `x, y` pairs in units. */
  path: number[];
  /** The page's items as the eraser has left them. */
  working: readonly NotesItem[] | undefined;
  erased: boolean;
  moved: boolean;
  /** When the pointer last moved more than a rest allows, and where. */
  restAt: number;
  restX: number;
  restY: number;
  lastX: number;
  lastY: number;
}

/** Attaches the engine to a viewport, and returns how to detach it. */
export function attachInk(host: InkHost): () => void {
  const { viewport, session } = host;
  let gesture: Gesture | undefined;
  let frame = 0;
  let penSeen = false;
  let penNearUntil = 0;
  /** Touches on the surface: `true` once rejected as a palm. */
  const touches = new Map<number, { x: number; y: number; rejected: boolean }>();
  let pinch: { distance: number; factor: number; x: number; y: number } | undefined;
  let velocity = { x: 0, y: 0, at: 0 };
  let coasting = 0;

  const pageOf = (target: EventTarget | null): InkPage | undefined => {
    const element = target instanceof Element ? target.closest("[data-hm-notes-page]") : null;
    const id = element?.getAttribute("data-hm-notes-page");
    return id ? host.page(id) : undefined;
  };

  const toPage = (current: Gesture, clientX: number, clientY: number): Sample | undefined => {
    if (!current.page || !current.box || current.box.width === 0) return undefined;
    const { info } = current.page;
    return {
      x: ((clientX - current.box.left) / current.box.width) * info.width,
      y: ((clientY - current.box.top) / current.box.height) * info.height,
      pressure: 0,
    };
  };

  /** The pressure of a sample: the pen's own, or half for a mouse or a finger. */
  const pressureOf = (event: PointerEvent): number =>
    event.pointerType === "pen" && event.pressure > 0
      ? Math.round(event.pressure * NOTES_PRESSURE_MAX)
      : NOTES_PRESSURE_MAX / 2;

  const styleOf = (tool: NotesPointerTool, settings: NotesInkSettings): StrokeStyle =>
    tool === "highlighter"
      ? { tool: "highlighter", size: settings.highlighterSize }
      : { tool: "pen", size: settings.penSize };

  const wetContext = (page: InkPage) => {
    const context = page.wet.getContext("2d", { desynchronized: true });
    if (!context) return undefined;
    const scale = page.wet.width / page.info.width;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, page.wet.width, page.wet.height);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return context;
  };

  const clearWet = (page: InkPage | undefined) => {
    if (page) wetContext(page);
  };

  /** Draws the gesture's current state on the wet canvas, once a frame. */
  const draw = () => {
    frame = 0;
    const current = gesture;
    if (!current?.page) return;
    const context = wetContext(current.page);
    if (!context) return;
    const settings = host.settings();
    const unitsPerPixel = current.box ? current.page.info.width / current.box.width : 100;
    if (current.tool === "pen" || current.tool === "highlighter") {
      const points =
        current.predicted.length > 0 ? [...current.points, ...current.predicted] : current.points;
      paintLiveStroke(
        context,
        points,
        styleOf(current.tool, settings),
        current.tool === "highlighter" ? settings.highlighterColor : settings.penColor,
      );
    } else if (current.tool === "eraser") {
      context.strokeStyle = GUIDE_COLOR;
      context.lineWidth = 1.5 * unitsPerPixel;
      context.beginPath();
      context.arc(current.lastX, current.lastY, settings.eraserSize / 2, 0, Math.PI * 2);
      context.stroke();
    } else if (current.tool === "lasso" && current.path.length >= 4) {
      context.strokeStyle = GUIDE_COLOR;
      context.lineWidth = 1.5 * unitsPerPixel;
      context.setLineDash([6 * unitsPerPixel, 4 * unitsPerPixel]);
      context.beginPath();
      context.moveTo(current.path[0] ?? 0, current.path[1] ?? 0);
      for (let index = 2; index < current.path.length; index += 2) {
        context.lineTo(current.path[index] ?? 0, current.path[index + 1] ?? 0);
      }
      context.stroke();
      context.setLineDash([]);
    } else if (current.tool === "link" && current.path.length >= 2) {
      const area = areaOf(current);
      context.strokeStyle = GUIDE_COLOR;
      context.lineWidth = 1.5 * unitsPerPixel;
      context.setLineDash([6 * unitsPerPixel, 4 * unitsPerPixel]);
      context.strokeRect(area.x, area.y, area.width, area.height);
      context.setLineDash([]);
    }
  };

  const requestDraw = () => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };

  const areaOf = (current: Gesture): NotesRect => {
    const x0 = current.path[0] ?? 0;
    const y0 = current.path[1] ?? 0;
    return {
      x: Math.round(Math.min(x0, current.lastX)),
      y: Math.round(Math.min(y0, current.lastY)),
      width: Math.round(Math.abs(current.lastX - x0)),
      height: Math.round(Math.abs(current.lastY - y0)),
    };
  };

  const itemsOf = (page: InkPage): readonly NotesItem[] =>
    session.getSnapshot().pages.get(page.info.id)?.items ?? [];

  const execute = (commands: NotesCommand | readonly NotesCommand[]) => {
    try {
      session.execute(commands);
    } catch (error) {
      host.onError(error);
    }
  };

  /** Ends the stroke being drawn and starts another where it stopped: a stroke holds only so many points. */
  const commitStroke = (current: Gesture, final: boolean, held: boolean) => {
    if (!current.page || current.points.length === 0) return;
    const settings = host.settings();
    const highlighter = current.tool === "highlighter";
    let points = toStoredPoints(current.points);
    let uniform = false;
    if (final && (settings.straighten || held)) {
      const shape = recogniseShape(points);
      if (shape) {
        points = shape.points;
        uniform = true;
      }
    }
    if (points.length === 0) return;
    const audio = host.audioAnchor();
    const stroke: NotesStroke = {
      id: host.newId(),
      type: "stroke",
      tool: highlighter ? "highlighter" : "pen",
      color: highlighter ? settings.highlighterColor : settings.penColor,
      size: highlighter ? settings.highlighterSize : settings.penSize,
      points,
      ...(uniform ? { uniform: true as const } : {}),
      ...(audio ? { audio } : {}),
    };
    execute({ type: "notes.addItems", page: current.page.info.id, items: [stroke] });
  };

  /** Erases along the path added since the last call. */
  const eraseStep = (current: Gesture, from: number) => {
    if (!current.page) return;
    const settings = host.settings();
    const working = current.working ?? itemsOf(current.page);
    const segment = current.path.slice(Math.max(0, from - 2));
    const result = eraseAlong(
      working,
      segment,
      settings.eraserSize / 2,
      settings.eraserMode,
      host.newId,
    );
    if (!result) return;
    current.working = replaceErased(working, result);
    current.erased = true;
    current.page.paint(current.working);
  };

  /** Turns what the eraser did into one undoable step, keeping each piece where its stroke was. */
  const commitErase = (current: Gesture) => {
    if (!current.page || !current.erased || !current.working) return;
    const page = current.page.info.id;
    const before = itemsOf(current.page);
    const kept = new Set(current.working.map((item) => item.id));
    const original = new Set(before.map((item) => item.id));
    const removed = before.filter((item) => !kept.has(item.id)).map((item) => item.id);
    const commands: NotesCommand[] = [];
    if (removed.length > 0) commands.push({ type: "notes.removeItems", page, ids: removed });
    let run: NotesItem[] = [];
    current.working.forEach((item, index) => {
      if (!original.has(item.id)) {
        run.push(item);
        return;
      }
      if (run.length > 0) {
        commands.push({ type: "notes.addItems", page, index: index - run.length, items: run });
        run = [];
      }
    });
    if (run.length > 0) {
      commands.push({
        type: "notes.addItems",
        page,
        index: current.working.length - run.length,
        items: run,
      });
    }
    if (commands.length > 0) execute(commands);
    current.page.paint(undefined);
  };

  const begin = (event: PointerEvent, page: InkPage | undefined) => {
    const settings = host.settings();
    // A pen's barrel button (2) or eraser end (32) erases while it's held.
    const erasing = event.pointerType === "pen" && (event.buttons & 34) !== 0;
    const tool: NotesPointerTool = erasing ? "eraser" : settings.tool;
    const current: Gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      tool,
      page,
      box: page?.element.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      points: [],
      predicted: [],
      path: [],
      working: undefined,
      erased: false,
      moved: false,
      restAt: event.timeStamp,
      restX: event.clientX,
      restY: event.clientY,
      lastX: 0,
      lastY: 0,
    };
    gesture = current;
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that's already gone can't be captured; the gesture still runs.
    }
    if (tool !== "lasso") host.setSelection(undefined);
    add(current, event, [event]);
  };

  /** Takes pointer samples into the gesture. */
  const add = (current: Gesture, event: PointerEvent, samples: readonly PointerEvent[]) => {
    const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    if (moved > TAP_DISTANCE) current.moved = true;
    if (Math.hypot(event.clientX - current.restX, event.clientY - current.restY) > HOLD_DRIFT) {
      current.restAt = event.timeStamp;
      current.restX = event.clientX;
      current.restY = event.clientY;
    }
    if (current.tool === "hand") {
      viewport.scrollLeft -= event.movementX;
      viewport.scrollTop -= event.movementY;
      return;
    }
    if (!current.page) return;
    const unitsPerPixel = current.box ? current.page.info.width / current.box.width : 100;
    const pathStart = current.path.length;
    for (const sample of samples) {
      const point = toPage(current, sample.clientX, sample.clientY);
      if (!point) continue;
      current.lastX = point.x;
      current.lastY = point.y;
      if (current.tool === "pen" || current.tool === "highlighter") {
        // Samples closer than a third of a pixel add nothing but work.
        appendPoint(current.points, point.x, point.y, pressureOf(sample), unitsPerPixel / 3);
        if (current.points.length >= NOTES_MAX_STROKE_POINTS * 3) {
          commitStroke(current, false, false);
          current.points = current.points.slice(-3);
        }
      } else if (current.tool === "eraser" || current.tool === "lasso") {
        current.path.push(point.x, point.y);
      } else if (current.path.length === 0) {
        current.path.push(point.x, point.y);
      }
    }
    if (current.tool === "pen" || current.tool === "highlighter") {
      current.predicted = [];
      for (const sample of event.getPredictedEvents?.() ?? []) {
        const point = toPage(current, sample.clientX, sample.clientY);
        if (point) current.predicted.push(point.x, point.y, pressureOf(sample));
      }
    }
    if (current.tool === "eraser") eraseStep(current, pathStart);
    requestDraw();
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture = undefined;
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
    const { page, tool } = current;
    // A cancelled touch was a gesture or a palm; a cancelled pen stroke is still ink.
    const discard = cancelled && current.pointerType === "touch";
    if (tool === "pen" || tool === "highlighter") {
      const held = current.moved && event.timeStamp - current.restAt >= HOLD_TIME;
      if (!discard) commitStroke(current, true, held);
    } else if (tool === "eraser") {
      if (discard) page?.paint(undefined);
      else commitErase(current);
    } else if (!discard && !cancelled && page) {
      const tolerance = (page.info.width / (current.box?.width ?? 1)) * TAP_DISTANCE;
      const items = itemsOf(page);
      if (tool === "lasso") {
        const ids = current.moved
          ? itemsInLasso(items, current.path, host.textHeight)
          : [hitTest(items, current.lastX, current.lastY, tolerance, host.textHeight)?.id].filter(
              (id): id is string => id !== undefined,
            );
        host.setSelection(ids.length > 0 ? { page: page.info.id, ids } : undefined);
      } else if (tool === "text") {
        const hit = hitTest(items, current.lastX, current.lastY, tolerance, host.textHeight);
        host.editText(
          page.info.id,
          hit?.type === "text"
            ? hit
            : { x: Math.round(current.lastX), y: Math.round(current.lastY) },
        );
      } else if (tool === "link") {
        const area = areaOf(current);
        if (area.width >= MIN_LINK_SIDE && area.height >= MIN_LINK_SIDE) {
          host.requestLink(page.info.id, area);
        }
      } else if (tool === "hand" && !current.moved) {
        followLinkAt(page, current.lastX, current.lastY, tolerance);
      }
    }
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    clearWet(page);
  };

  const followLinkAt = (page: InkPage, x: number, y: number, tolerance: number) => {
    const links = itemsOf(page).filter((item) => item.type === "link");
    const hit = hitTest(links, x, y, tolerance, host.textHeight);
    if (hit?.type === "link") host.followLink(hit.page);
  };

  /** Drops the gesture in progress without keeping any of it. */
  const abandon = () => {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    if (viewport.hasPointerCapture(current.pointerId)) {
      viewport.releasePointerCapture(current.pointerId);
    }
    if (current.tool === "eraser") current.page?.paint(undefined);
    clearWet(current.page);
  };

  // --- Fingers: pan, pinch, and the palm ---

  const liveTouches = () => [...touches.values()].filter((touch) => !touch.rejected);

  const startPinch = () => {
    const [first, second] = liveTouches();
    if (!first || !second) return;
    pinch = {
      distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
      factor: 1,
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  };

  const endPinch = () => {
    if (!pinch) return;
    const { factor, x, y } = pinch;
    pinch = undefined;
    host.commitZoom(factor, x, y);
  };

  const coast = () => {
    coasting = 0;
    if (Math.hypot(velocity.x, velocity.y) < 0.02) return;
    // Sixteen milliseconds of travel, slowing by a twentieth each frame.
    viewport.scrollLeft -= velocity.x * 16;
    viewport.scrollTop -= velocity.y * 16;
    velocity = { x: velocity.x * 0.95, y: velocity.y * 0.95, at: velocity.at };
    coasting = requestAnimationFrame(coast);
  };

  const stopCoasting = () => {
    if (coasting !== 0) cancelAnimationFrame(coasting);
    coasting = 0;
  };

  const isPalm = (event: PointerEvent): boolean =>
    gesture?.pointerType === "pen" ||
    event.timeStamp < penNearUntil ||
    (penSeen && Math.max(event.width, event.height) > PALM_SIZE);

  const onTouchDown = (event: PointerEvent) => {
    stopCoasting();
    const rejected = isPalm(event);
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY, rejected });
    if (rejected) return;
    const live = liveTouches().length;
    if (host.settings().fingerDraws && live === 1 && !gesture) {
      begin(event, pageOf(event.target));
      return;
    }
    // A second finger turns a finger's stroke into a pinch.
    if (gesture?.pointerType === "touch") abandon();
    if (live === 2) startPinch();
    velocity = { x: 0, y: 0, at: event.timeStamp };
  };

  const onTouchMove = (event: PointerEvent) => {
    const touch = touches.get(event.pointerId);
    if (!touch || touch.rejected) return;
    if (gesture?.pointerId === event.pointerId) {
      touch.x = event.clientX;
      touch.y = event.clientY;
      const samples = event.getCoalescedEvents?.() ?? [];
      add(gesture, event, samples.length > 0 ? samples : [event]);
      return;
    }
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch.x = event.clientX;
    touch.y = event.clientY;
    const live = liveTouches();
    if (pinch && live.length >= 2) {
      const [first, second] = live;
      if (!first || !second) return;
      const x = (first.x + second.x) / 2;
      const y = (first.y + second.y) / 2;
      // Two fingers moving together pan; moving apart or closer zoom.
      viewport.scrollLeft -= x - pinch.x;
      viewport.scrollTop -= y - pinch.y;
      pinch.x = x;
      pinch.y = y;
      pinch.factor = Math.hypot(first.x - second.x, first.y - second.y) / pinch.distance;
      host.previewZoom(pinch.factor, x, y);
      return;
    }
    if (live.length === 1) {
      viewport.scrollLeft -= dx;
      viewport.scrollTop -= dy;
      const elapsed = Math.max(1, event.timeStamp - velocity.at);
      velocity = { x: dx / elapsed, y: dy / elapsed, at: event.timeStamp };
    }
  };

  const onTouchUp = (event: PointerEvent, cancelled: boolean) => {
    const touch = touches.get(event.pointerId);
    touches.delete(event.pointerId);
    if (!touch || touch.rejected) return;
    if (gesture?.pointerId === event.pointerId) {
      finish(event, cancelled);
      return;
    }
    if (pinch) {
      if (liveTouches().length < 2) endPinch();
      return;
    }
    const moved = Math.hypot(velocity.x, velocity.y) > 0;
    if (!moved && !cancelled) {
      // A tap: follow a link under the finger.
      const page = pageOf(event.target);
      if (page) {
        const box = page.element.getBoundingClientRect();
        const scale = page.info.width / Math.max(1, box.width);
        followLinkAt(
          page,
          (event.clientX - box.left) * scale,
          (event.clientY - box.top) * scale,
          TAP_DISTANCE * scale,
        );
      }
    } else if (!cancelled && event.timeStamp - velocity.at < 60) {
      coasting = requestAnimationFrame(coast);
    }
  };

  // --- Listeners ---

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      onTouchDown(event);
      return;
    }
    if (event.pointerType === "pen") {
      penSeen = true;
      penNearUntil = event.timeStamp + PEN_NEAR_TIME;
      // The palm was down first: stop what its touches were doing.
      for (const touch of touches.values()) touch.rejected = true;
      if (gesture?.pointerType === "touch") abandon();
      if (pinch) pinch = undefined;
      stopCoasting();
    } else if (event.button !== 0) {
      return;
    }
    if (gesture) return;
    // The view's own controls, such as a selection's handles, take their pointers.
    if (event.target instanceof Element && event.target.closest("[data-hm-notes-control]")) return;
    const page = pageOf(event.target);
    if (!page && host.settings().tool !== "hand") return;
    event.preventDefault();
    begin(event, page);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      onTouchMove(event);
      return;
    }
    if (event.pointerType === "pen") penNearUntil = event.timeStamp + PEN_NEAR_TIME;
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    const samples = event.getCoalescedEvents?.() ?? [];
    add(current, event, samples.length > 0 ? samples : [event]);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch") onTouchUp(event, false);
    else finish(event, false);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerType === "touch") onTouchUp(event, true);
    else finish(event, true);
  };

  /** A pinch on a trackpad arrives as a wheel event with Control held. */
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    host.commitZoom(Math.exp(-event.deltaY / 200), event.clientX, event.clientY);
  };

  /** A long press with a pen or a finger mustn't open the browser's menu over the page. */
  const onContextMenu = (event: Event) => {
    if (pageOf(event.target)) event.preventDefault();
  };

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerCancel);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("contextmenu", onContextMenu);

  return () => {
    abandon();
    stopCoasting();
    if (frame !== 0) cancelAnimationFrame(frame);
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", onPointerUp);
    viewport.removeEventListener("pointercancel", onPointerCancel);
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("contextmenu", onContextMenu);
  };
}
