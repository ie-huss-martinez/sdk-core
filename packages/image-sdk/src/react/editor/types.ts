import type { EditorPreferences } from "@hussmartinez/ui";
import type { IconComponent } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageCommand } from "../../core/operations/commands.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";
import type { ImageSession, ImageSessionExport } from "../../core/session/session.js";
import type { ImageEditorProviderProps } from "../ImageEditorProvider.js";

/**
 * The parts of `ImageEditor` that take extra classes through `classNames`.
 *
 * @public
 */
export type ImageEditorPart = "root" | "toolbar" | "stage" | "inspector";

/**
 * Which of the editor's capabilities are on (docs/adr/0007): the inspector's
 * panels and export. Each is on unless set to `false`. The toolbar's tools
 * are chosen with `tools` and `toolbar` instead.
 *
 * @public
 */
export interface ImageEditorFeatures {
  /** The Adjust panel's develop sliders. */
  readonly adjust?: boolean;
  /** The Filters panel's presets. */
  readonly filters?: boolean;
  /** The Info panel. */
  readonly info?: boolean;
  /**
   * The Export tool and its dialog. Off, the editor offers no export, and
   * the ref handle's `export()` still returns the file to the host.
   */
  readonly export?: boolean;
}

/**
 * The editor's colour mode: ui's light or dark theme, or the system's. Unset,
 * it inherits the page's.
 *
 * @public
 */
export type ImageEditorTheme = "light" | "dark" | "system";

/**
 * Props of {@link ImageEditor}. The session props are the provider's: pass
 * a `session` of your own over your `engine`, or let the editor create one.
 *
 * @public
 */
export interface ImageEditorProps extends Omit<ImageEditorProviderProps, "children"> {
  /** An image to open on mount. Images the user opens in the editor replace it. */
  readonly initialFile?: Blob;
  /**
   * The plan, for a host that holds it: the controlled form. When it changes,
   * the editor applies it as one undoable step (`session.applyPlan`). Use it
   * with `onChange`, which gets the plans the editor makes.
   */
  readonly plan?: ImagePlan;
  /** Called with the plan after each committed edit, open, undo or redo, never during a gesture. */
  readonly onChange?: (plan: ImagePlan) => void;
  /** Which tools are present, by id, in order. All of them by default. */
  readonly tools?: readonly string[];
  /** The toolbar's groups, as tool ids. */
  readonly toolbar?: readonly (readonly string[])[];
  /** Icon components by name, over ui's. */
  readonly icons?: Readonly<Record<string, IconComponent>>;
  /** Extra classes on the root. */
  readonly className?: string;
  /** Extra classes on each part. */
  readonly classNames?: Readonly<Partial<Record<ImageEditorPart, string>>>;
  /** Drop the visual styles, keeping layout and accessibility. */
  readonly unstyled?: boolean;
  /** Which capabilities are on: the inspector's panels and export. All of them by default. */
  readonly features?: ImageEditorFeatures;
  /** The colour mode, set as `data-hm-theme` on the editor's root. Unset, it inherits the page's. */
  readonly theme?: ImageEditorTheme;
  /**
   * The person's preferences (sdk-core ADR 0067): mode, theme, the panels,
   * density, motion and tips. Controlled with `onPreferencesChange`; the
   * editor never stores them, so the host decides where they're kept, such
   * as `localStorage`. A `theme` prop wins over the preferences' theme.
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
   * ad slot, passed to ui's `EditorFrame` unchanged (sdk-core ADR 0067). It
   * shows only while the panel's content and it both fit in the column's
   * height, and hides with the panel and below 45 rem. `<hm-image-editor>`
   * has no equivalent, as it takes no React content.
   */
  readonly propertiesFooter?: ReactNode;
  /**
   * Takes the exported file instead of the export dialog's download button;
   * the dialog closes once it's called.
   */
  readonly onExport?: (blob: Blob, details: ImageSessionExport) => void;
}

/**
 * What a ref to {@link ImageEditor} gives the host.
 *
 * @public
 */
export interface ImageEditorHandle {
  /** The editor's session, for state and commands beyond the handle's. */
  readonly session: ImageSession;
  /** Opens an image, replacing the current one once it has opened. */
  open(file: Blob): Promise<void>;
  /**
   * Adds an image as a layer in the middle of the image as it's shown, as
   * one undoable step, and shows the layers with it selected. A file that
   * can't be added is reported on the stage, as a failed open is.
   */
  insertImage(file: Blob): Promise<void>;
  /** Applies commands as one undoable step. */
  execute(commands: ImageCommand | readonly ImageCommand[]): void;
  /** Renders and encodes the image as it is now. */
  export(format: ImageExportFormat): Promise<ImageSessionExport>;
  /** Undoes the last edit, if there is one. */
  undo(): void;
  /** Redoes the last undone edit, if there is one. */
  redo(): void;
}
