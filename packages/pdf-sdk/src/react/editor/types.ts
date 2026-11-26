import type { MessageOverrides } from "@hussmartinez/sdk-core";
import type { EditorPreferences } from "@hussmartinez/ui";
import type { IconComponent } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import type { PdfBytes } from "../../core/model/document.js";
import type { PdfExportOptions, PdfOpenOptions, PdfSession } from "../../core/session/session.js";
import type { PdfEditorMessageCatalogue } from "../editor-messages.js";
import type { PdfSessionProviderProps } from "../PdfSessionProvider.js";

/**
 * The parts of `PdfEditor` that take extra classes through `classNames`.
 * The `header` is the notices above the document: saving, alerts and
 * warnings. The `toolbar` is the tools panel's list (docs/adr/0012).
 *
 * @public
 */
export type PdfEditorPart =
  | "root"
  | "header"
  | "toolbar"
  | "body"
  | "sidebar"
  | "start"
  | "status"
  | "alert";

/**
 * What changed in the editor's document, for {@link PdfEditorProps.onChange}.
 *
 * - `open`: a document opened, replacing any other.
 * - `edit`: the document changed: an edit, an insert, an undo or a redo.
 * - `close`: the document closed.
 *
 * @public
 */
export interface PdfEditorChange {
  /** What happened: see {@link PdfEditorChange}. */
  readonly reason: "open" | "edit" | "close";
  /** The document's page count after the change; 0 once it's closed. */
  readonly pageCount: number;
  /**
   * On `open`, the opened file's name, cleaned (docs/adr/0009), if it had
   * one: from `File.name` or the `name` option. Show it only as text.
   */
  readonly fileName?: string;
}

/**
 * What {@link PdfEditorProps.downloadName} is given to name a download.
 *
 * @public
 */
export interface PdfDownloadNameInfo {
  /** The opened file's name, cleaned (docs/adr/0009), if it had one. */
  readonly sourceName?: string;
  /** The page count of the document being saved. */
  readonly pageCount: number;
}

/**
 * What {@link PdfEditorProps.onExport} is given with the saved document.
 *
 * @public
 */
export interface PdfExportInfo {
  /**
   * The name the browser download would have had: cleaned, ending in
   * `.pdf`, and `"document.pdf"` when there's none.
   */
  readonly fileName: string;
  /** The saved document's page count. */
  readonly pageCount: number;
}

/**
 * Props for {@link PdfEditor}. The session props are the provider's: pass a
 * `session` of your own, or let the editor create one from `engine`,
 * `processor`, `assetsUrl`, `filePolicy` and `onEvent`.
 *
 * @public
 */
export interface PdfEditorProps extends Omit<PdfSessionProviderProps, "children" | "messages"> {
  /**
   * Text overrides, typed against the editor's English catalogue, which
   * includes ui's text for the ui components it renders (sdk-core ADR 0046).
   */
  readonly messages?: MessageOverrides<PdfEditorMessageCatalogue>;
  /**
   * A document to open. The editor opens it on mount, and again whenever a
   * different file or buffer is passed; `null` closes the document. Files
   * the user opens in the editor don't change this prop.
   */
  readonly file?: Blob | PdfBytes | null;
  /** Called after the document opens, changes or closes. */
  readonly onChange?: (change: PdfEditorChange) => void;
  /**
   * Receives the document the download tool built, instead of the browser
   * downloading it, such as to store it in the host's own storage. The
   * bytes are a new buffer the host owns. If it throws or rejects, the
   * editor says the PDF couldn't be saved; its error is the host's to log.
   */
  readonly onExport?: (bytes: Uint8Array, info: PdfExportInfo) => void | Promise<void>;
  /**
   * Names the download tool's file. The result is cleaned as a file name
   * and given a `.pdf` extension; the opened file's name by default, or
   * `"document.pdf"` (docs/adr/0009).
   */
  readonly downloadName?: (info: PdfDownloadNameInfo) => string;
  /**
   * Which tools are present, by id, in order, such as
   * `["pdf.undo", "pdf.redo"]`. All of {@link pdfTools} by default. Their
   * shortcuts work only while they're present.
   */
  readonly tools?: readonly string[];
  /**
   * The tools' groups, as tool ids, such as
   * `[["pdf.undo", "pdf.redo"], ["pdf.rotate-left", "pdf.rotate-right"]]`.
   * Open, Undo, Redo and Download go in the top bar; the other groups make
   * the tools panel, each named after its first tool's group. Defaults to
   * the present tools in their usual groups; `[]` shows no tool, keeping the
   * shortcuts and the command palette. An unknown id throws.
   */
  readonly toolbar?: readonly (readonly string[])[];
  /**
   * The person's preferences (sdk-core ADR 0067): mode, theme, the tools
   * panel, density, motion and tips. Controlled with `onPreferencesChange`;
   * the editor never stores them, so the host decides where they're kept,
   * such as `localStorage`. The editor has no properties panel, so it
   * ignores `properties`.
   */
  readonly preferences?: EditorPreferences;
  /**
   * Preferences to start with when `preferences` isn't given. Fields left
   * out take ui's defaults, except the mode, which is Advanced, so every tool
   * is listed until the host or the person chooses otherwise. The theme,
   * density and motion are the page's until the host sets them here or the
   * person picks them.
   */
  readonly defaultPreferences?: Partial<EditorPreferences>;
  /** Called with the whole preferences when the person changes one. */
  readonly onPreferencesChange?: (preferences: EditorPreferences) => void;
  /**
   * Host content under the properties panel, in its column, such as an app's
   * ad slot, passed to ui's `EditorFrame` unchanged (sdk-core ADR 0067). The
   * frame shows it only under a properties panel, and this editor has none,
   * so for now it never shows: it's here so a host can pass the same props
   * to every editor in the family. `<hm-pdf-editor>` has no equivalent, as
   * it takes no React content.
   */
  readonly propertiesFooter?: ReactNode;
  /** Icon components by name, over the SDK's own from ui. */
  readonly icons?: Readonly<Record<string, IconComponent>>;
  /** Extra classes on the root. */
  readonly className?: string;
  /** Extra classes on each part. */
  readonly classNames?: Readonly<Partial<Record<PdfEditorPart, string>>>;
  /** Drop the visual styles, keeping layout and accessibility. */
  readonly unstyled?: boolean;
}

/**
 * What a ref to {@link PdfEditor} gives the host.
 *
 * @public
 */
export interface PdfEditorHandle {
  /** The editor's session, for commands and state beyond the handle's. */
  readonly session: PdfSession;
  /**
   * Opens a document, replacing the current one once it has opened. Pass
   * `name` with bytes or a plain `Blob`; a `File` gives its own.
   */
  open(file: Blob | PdfBytes, options?: PdfOpenOptions): Promise<void>;
  /** Builds the document as it is now. The result is a new buffer the caller owns. */
  export(options?: PdfExportOptions): Promise<Uint8Array>;
  /** Undoes the last edit, if there is one. */
  undo(): void;
  /** Redoes the last undone edit, if there is one. */
  redo(): void;
  /** Closes the document. */
  close(): Promise<void>;
}
