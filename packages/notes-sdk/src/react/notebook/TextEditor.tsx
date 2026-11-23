import { type ReactNode, useEffect, useRef, useState } from "react";
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
 * and keeps the text; nothing is lost by tapping elsewhere.
 */
export function TextEditor({ item, pixelsPerPoint, onDone }: TextEditorProps): ReactNode {
  const { messages } = useNotes();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(item.text);
  const scale = pixelsPerPoint / NOTES_UNITS_PER_POINT;

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // As tall as its text, so it never scrolls inside the page.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    void text;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

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
        width: item.width * scale,
        fontSize: item.size * scale,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: NOTES_TEXT_FONT,
        color: item.color,
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(event) => {
        // The editor's own keys must not reach the notebook's shortcuts.
        event.stopPropagation();
        if (event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}
