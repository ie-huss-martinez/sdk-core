import { useLatest } from "@hussmartinez/ui/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { NotesText } from "../../core/model/items.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import { NOTES_TEXT_FONT, TEXT_LINE_HEIGHT } from "../canvas/text-layout.js";
import { useNotes } from "../context.js";

export interface TextEditorProps {
  /** The text box being edited: an existing one, or a new one that isn't on the page yet. */
  readonly item: NotesText;
  readonly pixelsPerPoint: number;
  /** Called with the text when editing ends. Empty text removes the box. */
  readonly onDone: (text: string) => void;
}

/**
 * The field a text box is typed in, placed over the box on the page, in the
 * box's own size and colour. Leaving it, or pressing Escape, ends the edit
 * and keeps the text; nothing is lost by tapping elsewhere, or by scrolling
 * its page out of view, which takes the field away without a blur.
 */
export function TextEditor({ item, pixelsPerPoint, onDone }: TextEditorProps): ReactNode {
  const { messages } = useNotes();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(item.text);
  const scale = pixelsPerPoint / NOTES_UNITS_PER_POINT;
  const width = item.width * scale;
  const fontSize = item.size * scale;
  const latest = useLatest({ text, onDone });
  const mounted = useRef(false);
  const ended = useRef(false);

  /** Ends the edit with the draft, once: a blur and an unmount can both ask. */
  const end = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    latest.current.onDone(latest.current.text);
  }, [latest]);

  // A page that scrolls out of view takes its field away, and a browser
  // doesn't blur a field that's removed while it has focus: the draft is
  // kept here instead.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // React's development mode runs this once on mount too, and mounts the
      // field again at once. Only a field still gone a moment later was removed.
      queueMicrotask(() => {
        if (!mounted.current) end();
      });
    };
  }, [end]);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // As tall as its text, so it never scrolls inside the page. A zoom changes
  // its width and its font size, and with them where its lines break.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    void text;
    void width;
    void fontSize;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text, width, fontSize]);

  return (
    <textarea
      ref={field}
      className="hm-notes-text-editor"
      data-hm-notes-control=""
      aria-label={messages.t("text.label")}
      value={text}
      rows={1}
      spellCheck
      style={{
        left: item.x * scale,
        top: item.y * scale,
        width,
        fontSize,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: NOTES_TEXT_FONT,
        color: item.color,
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={end}
      onKeyDown={(event) => {
        // The editor's own keys must not reach the notebook's shortcuts.
        event.stopPropagation();
        // While an input method composes, Escape cancels what it's composing, not the edit.
        if (event.key === "Escape" && !event.nativeEvent.isComposing) event.currentTarget.blur();
      }}
    />
  );
}
