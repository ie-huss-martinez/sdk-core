import type { ShortcutPart } from "@hussmartinez/sdk-core";
import { useAnnounce, useLatest, usePlatform } from "@hussmartinez/ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoOutput } from "../core/ports/video-output.js";
import type { VideoSession, VideoSessionSnapshot } from "../core/session/session.js";
import type { VideoToolContext, VideoToolState } from "../features/tools/tools.js";
import { useVideoEditor, useVideoOutput, useVideoSession } from "./context.js";

/** Whether a tool can run now, and whether a toggle is on. */
export interface ToolFlags {
  readonly enabled: boolean;
  readonly active: boolean;
}

/** What the toolbar, the transport and the editor's keys use to run tools. */
export interface VideoTools {
  /** Each present tool's flags, by id. They change only when one of them does. */
  readonly flags: ReadonlyMap<string, ToolFlags>;
  /** Runs a tool, if it's present and enabled now. Returns whether it ran. */
  run(id: string): boolean;
  /** A tool's shortcuts, for `aria-keyshortcuts`. */
  ariaKeyShortcuts(id: string): string | undefined;
  /** A tool's label with its first shortcut, such as "Undo (Ctrl+Z)", for its tooltip. */
  labelWithKeys(id: string): string;
  /** A tool's first shortcut as text, such as "Ctrl+Z" or "⌘Z", if it has one. */
  keysText(id: string): string | undefined;
}

/**
 * What a tool did, in words: the toast the editor shows, or what the
 * building blocks announce (docs/adr/0010). An edit's can offer Undo.
 */
export interface VideoToolResult {
  readonly message: string;
  /** Whether it changed the plan as an edit, rather than undoing or redoing one. */
  readonly edit: boolean;
}

type EditorMessages = ReturnType<typeof useVideoEditor>["messages"];

/**
 * What a tool that ran did, for the people who can't see it change: an edit
 * or a step through the history, if the plan changed. Playback, zoom,
 * adding videos and exporting have none: their results show, or come later.
 */
function resultOf(
  id: string,
  state: VideoToolState,
  before: VideoSessionSnapshot,
  after: VideoSessionSnapshot,
  messages: EditorMessages,
): VideoToolResult | undefined {
  if (after.plan === before.plan) return undefined;
  const count = state.selectedClips.length;
  switch (id) {
    case "video.undo":
      return { message: messages.t("announce.undone"), edit: false };
    case "video.redo":
      return { message: messages.t("announce.redone"), edit: false };
    case "video.split":
      return { message: messages.t("editor.split"), edit: true };
    case "video.delete":
      return { message: messages.t("editor.deleted", { count }), edit: true };
    case "video.mute": {
      const muted = state.selectedClips.every(
        (key) => after.plan?.clips.find((clip) => clip.key === key)?.muted,
      );
      return {
        message: messages.t(muted ? "editor.muted" : "editor.unmuted", { count }),
        edit: true,
      };
    }
    default:
      return undefined;
  }
}

/**
 * The editor's tools, bound to its session, output and view (docs/adr/0007).
 * The flags follow the session, the output and the view in the same render
 * as everything else. The playhead is read on animation frames, and renders
 * again only when it changes a flag, so a toolbar doesn't re-render every
 * frame while playing.
 *
 * What a tool did goes to `onResult`, such as the editor's toasts, or else
 * to the editor's announcer.
 *
 * @internal
 */
export function useVideoTools(onResult?: (result: VideoToolResult) => void): VideoTools {
  const editor = useVideoEditor();
  const {
    messages,
    tools,
    shortcuts,
    selectedClips,
    zoom,
    maxZoom,
    setZoom,
    chooseFiles,
    setDialog,
  } = editor;
  const { session, snapshot } = useVideoSession();
  const { output, snapshot: playback } = useVideoOutput();
  const announce = useAnnounce();
  const platform = usePlatform();
  const report = useLatest(onResult);

  const stateAt = useCallback(
    (playhead: number): VideoToolState => ({
      plan: snapshot.plan,
      selectedClips,
      playhead,
      playing: playback?.state === "playing",
      canPlay: output !== null,
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
      zoom,
      maxZoom,
    }),
    [snapshot, selectedClips, playback, output, zoom, maxZoom],
  );
  const flagsAt = useCallback(
    (state: VideoToolState) =>
      new Map(
        tools.tools.map((tool) => [
          tool.id,
          {
            enabled: tool.isEnabled?.(state) ?? true,
            active: tool.isActive?.(state) ?? false,
          },
        ]),
      ),
    [tools],
  );

  // The flags are worked out while rendering, from the same state the rest of
  // the editor renders from, so a zoom widens the track and enables Zoom out
  // in one commit. Only the playhead changes nothing React sees, so it's read
  // on animation frames, and a change it makes to a flag renders again.
  const [, setPlayheadTick] = useState(0);
  const computed = flagsAt(stateAt(output?.position() ?? 0));
  const key = JSON.stringify([...computed]);
  // The same Map while nothing changes, so a toolbar doesn't render for nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- by value, through the key
  const flags = useMemo(() => computed, [key]);
  const rendered = useRef(key);
  rendered.current = key;
  useEffect(() => {
    let pending = requestAnimationFrame(function read() {
      const next = JSON.stringify([...flagsAt(stateAt(output?.position() ?? 0))]);
      if (next !== rendered.current) setPlayheadTick((tick) => tick + 1);
      pending = requestAnimationFrame(read);
    });
    return () => cancelAnimationFrame(pending);
  }, [flagsAt, stateAt, output]);

  const run = useCallback(
    (id: string) => {
      const tool = tools.get(id);
      if (!tool) return false;
      const state = stateAt(output?.position() ?? 0);
      if (tool.isEnabled && !tool.isEnabled(state)) return false;
      const before = session.getSnapshot();
      void tool.run(contextOf(state, { session, output, setZoom, chooseFiles, setDialog }));
      // Edits and the history's steps change the plan at once.
      const result = resultOf(id, state, before, session.getSnapshot(), messages);
      if (result) {
        if (report.current) report.current(result);
        else announce(result.message);
      }
      return true;
    },
    [tools, stateAt, output, session, setZoom, chooseFiles, setDialog, announce, messages, report],
  );

  const describe = useCallback(
    (parts: readonly ShortcutPart[]) =>
      parts
        .map((part) => (part.message ? messages.t(part.message as "keys.control") : part.value))
        // Apple writes chords without separators, such as ⌘⇧Z.
        .join(platform === "apple" ? "" : "+"),
    [messages, platform],
  );

  return useMemo(
    () => ({
      flags,
      run,
      ariaKeyShortcuts: (id: string) => shortcuts.ariaKeyShortcuts(id),
      labelWithKeys: (id: string) => {
        const tool = tools.get(id);
        const label = tool ? messages.t(tool.label as "tools.undo") : id;
        const [first] = shortcuts.describe(id);
        return first ? messages.t("toolbar.withKeys", { label, keys: describe(first) }) : label;
      },
      keysText: (id: string) => {
        const [first] = shortcuts.describe(id);
        return first ? describe(first) : undefined;
      },
    }),
    [flags, run, shortcuts, tools, messages, describe],
  );
}

function contextOf(
  state: VideoToolState,
  {
    session,
    output,
    setZoom,
    chooseFiles,
    setDialog,
  }: {
    readonly session: VideoSession;
    readonly output: VideoOutput | null;
    readonly setZoom: (zoom: number) => void;
    readonly chooseFiles: () => void;
    readonly setDialog: (dialog: "export" | null) => void;
  },
): VideoToolContext {
  return {
    state,
    execute(commands) {
      try {
        session.execute(commands);
      } catch {
        // The session's snapshot holds the error, which the stage shows.
      }
    },
    // What they did is said by whoever ran them (useVideoTools).
    undo: () => void session.undo(),
    redo: () => void session.redo(),
    // A play the editor's unmount cuts short rejects; there's nothing to show then.
    play: () => void output?.play().catch(() => {}),
    pause: () => output?.pause(),
    seek: (frame) => output?.seek(frame),
    step: (delta) => output?.step(delta),
    setZoom,
    chooseFiles,
    openExport: () => setDialog("export"),
    newClipKey: () => session.newClipKey(),
  };
}
