/**
 * The token definitions: every token's name, level, category, value type and
 * purpose. This is the single source the CSS, the types and the token
 * reference are generated from (ADR 0006).
 */

/**
 * The value types a token can have. Each type has its own grammar, which
 * {@link createTheme} checks values against.
 *
 * @public
 */
export type TokenType =
  | "color"
  | "length"
  | "duration"
  | "easing"
  | "number"
  | "integer"
  | "font-family"
  | "font-weight"
  | "shadow"
  | "outline"
  | "color-scheme";

/**
 * What a token is for, used to group the token reference.
 *
 * @public
 */
export type TokenCategory =
  | "color"
  | "typography"
  | "space"
  | "size"
  | "shape"
  | "shadow"
  | "motion"
  | "z-index"
  | "opacity"
  | "focus";

/**
 * Base tokens are raw scales that only other tokens use. Semantic tokens name
 * a purpose, and are what components use (ADR 0006).
 *
 * @public
 */
export type TokenLevel = "base" | "semantic" | "component";

/**
 * What a token is, for tooling: its name, level, category and value type.
 * What each token is for is documented in the token reference,
 * `docs/tokens.md`, rather than shipped to applications (docs/adr/0001).
 *
 * @public
 */
export interface TokenDefinition {
  /** The name without the `--hm-` prefix, such as `color-accent`. */
  readonly name: string;
  /** Base, semantic or component (ADR 0006). */
  readonly level: TokenLevel;
  /** What the token styles, used to group the token reference. */
  readonly category: TokenCategory;
  /** The grammar its values must follow. */
  readonly type: TokenType;
  /**
   * Whether density changes the token. Density tokens are set by
   * `data-hm-density`, not by the colour mode.
   */
  readonly density: boolean;
  /**
   * For component tokens, the semantic token they fall back to. `ui` never
   * declares component tokens; components read them as
   * `var(--hm-<name>, var(--hm-<fallback>))`, so a theme or host can set them
   * on any ancestor (docs/adr/0001).
   */
  readonly fallback?: SemanticTokenName;
}

/** The hues of the base colour palettes. */
export const HUES = ["gray", "blue", "red", "green", "amber"] as const;
/** The steps of every base colour palette, from lightest to darkest. */
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * The names of the base tokens: the raw colour, space, radius, border, type
 * and motion scales.
 *
 * @public
 */
export type BaseTokenName =
  | `${"gray" | "blue" | "red" | "green" | "amber"}-${50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950}`
  | "white"
  | "black"
  | `space-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`
  | "radius-none"
  | "radius-sm"
  | "radius-md"
  | "radius-lg"
  | "radius-xl"
  | "radius-2xl"
  | "radius-full"
  | "border-width-1"
  | "border-width-2"
  | "font-sans"
  | "font-mono"
  | `font-size-${1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | "font-weight-400"
  | "font-weight-500"
  | "font-weight-600"
  | "font-weight-700"
  | "leading-tight"
  | "leading-normal"
  | "leading-relaxed"
  | "duration-fast"
  | "duration-normal"
  | "duration-slow"
  | "easing-standard"
  | "easing-decelerate"
  | "easing-accelerate"
  | "easing-emphasized"
  | "easing-spring";

/**
 * The names of the semantic tokens, which components use.
 *
 * @public
 */
export type SemanticTokenName =
  | "color-scheme"
  | "color-bg"
  | "color-surface"
  | "color-surface-raised"
  | "color-surface-sunken"
  | "color-overlay"
  | "color-text"
  | "color-text-muted"
  | "color-text-disabled"
  | "color-border"
  | "color-border-strong"
  | "color-control"
  | "color-control-hover"
  | "color-control-active"
  | "color-control-disabled"
  | "color-surface-glass"
  | "color-accent"
  | "color-accent-hover"
  | "color-accent-active"
  | "color-on-accent"
  | "color-accent-subtle"
  | "color-accent-text"
  | "color-danger"
  | "color-danger-hover"
  | "color-on-danger"
  | "color-danger-subtle"
  | "color-danger-text"
  | "color-warning"
  | "color-on-warning"
  | "color-warning-subtle"
  | "color-warning-text"
  | "color-success"
  | "color-on-success"
  | "color-success-subtle"
  | "color-success-text"
  | "focus-ring-color"
  | "focus-ring-width"
  | "focus-ring-offset"
  | "focus-ring"
  | "font-family"
  | "font-family-mono"
  | "font-size-small"
  | "font-size-body"
  | "font-size-title"
  | "font-weight-regular"
  | "font-weight-strong"
  | "line-height-body"
  | "line-height-tight"
  | "letter-spacing"
  | "control-height"
  | "control-height-small"
  | "control-padding-x"
  | "control-gap"
  | "icon-size"
  | "target-size"
  | "gap-tight"
  | "gap-normal"
  | "gap-loose"
  | "inset-tight"
  | "inset-normal"
  | "inset-loose"
  | "surface-width-small"
  | "surface-width-medium"
  | "surface-width-large"
  | "track-size"
  | "sidebar-width"
  | "rail-width"
  | "inspector-width"
  | "bar-height"
  | "radius-control"
  | "radius-surface"
  | "radius-round"
  | "border-width"
  | "shadow-raised"
  | "shadow-overlay"
  | "shadow-floating"
  | "blur-glass"
  | "motion-duration-feedback"
  | "motion-duration-enter"
  | "motion-duration-exit"
  | "motion-easing-standard"
  | "motion-easing-enter"
  | "motion-easing-exit"
  | "motion-duration-panel"
  | "motion-easing-panel"
  | "motion-easing-spring"
  | "motion-duration-loop"
  | "motion-easing-loop"
  | "z-raised"
  | "z-sticky"
  | "z-overlay"
  | "opacity-disabled";

/**
 * The semantic tokens that density changes: control sizes, gaps and insets.
 *
 * @public
 */
export type DensityTokenName =
  | "control-height"
  | "control-height-small"
  | "control-padding-x"
  | "control-gap"
  | "icon-size"
  | "target-size"
  | "gap-tight"
  | "gap-normal"
  | "gap-loose"
  | "inset-tight"
  | "inset-normal"
  | "inset-loose";

type SemanticSpec = {
  readonly category: TokenCategory;
  readonly type: TokenType;
  readonly density?: true;
};

const semantic = {
  "color-scheme": {
    category: "color",
    type: "color-scheme",
  },
  "color-bg": {
    category: "color",
    type: "color",
  },
  "color-surface": {
    category: "color",
    type: "color",
  },
  "color-surface-raised": {
    category: "color",
    type: "color",
  },
  "color-surface-sunken": {
    category: "color",
    type: "color",
  },
  "color-overlay": {
    category: "color",
    type: "color",
  },
  "color-text": { category: "color", type: "color" },
  "color-text-muted": {
    category: "color",
    type: "color",
  },
  "color-text-disabled": {
    category: "color",
    type: "color",
  },
  "color-border": {
    category: "color",
    type: "color",
  },
  "color-border-strong": {
    category: "color",
    type: "color",
  },
  "color-control": {
    category: "color",
    type: "color",
  },
  "color-control-hover": {
    category: "color",
    type: "color",
  },
  "color-control-active": {
    category: "color",
    type: "color",
  },
  "color-control-disabled": { category: "color", type: "color" },
  "color-surface-glass": { category: "color", type: "color" },
  "color-accent": {
    category: "color",
    type: "color",
  },
  "color-accent-hover": {
    category: "color",
    type: "color",
  },
  "color-accent-active": {
    category: "color",
    type: "color",
  },
  "color-on-accent": {
    category: "color",
    type: "color",
  },
  "color-accent-subtle": {
    category: "color",
    type: "color",
  },
  "color-accent-text": {
    category: "color",
    type: "color",
  },
  "color-danger": {
    category: "color",
    type: "color",
  },
  "color-danger-hover": {
    category: "color",
    type: "color",
  },
  "color-on-danger": {
    category: "color",
    type: "color",
  },
  "color-danger-subtle": {
    category: "color",
    type: "color",
  },
  "color-danger-text": {
    category: "color",
    type: "color",
  },
  "color-warning": { category: "color", type: "color" },
  "color-on-warning": {
    category: "color",
    type: "color",
  },
  "color-warning-subtle": {
    category: "color",
    type: "color",
  },
  "color-warning-text": {
    category: "color",
    type: "color",
  },
  "color-success": { category: "color", type: "color" },
  "color-on-success": {
    category: "color",
    type: "color",
  },
  "color-success-subtle": {
    category: "color",
    type: "color",
  },
  "color-success-text": {
    category: "color",
    type: "color",
  },
  "focus-ring-color": {
    category: "focus",
    type: "color",
  },
  "focus-ring-width": {
    category: "focus",
    type: "length",
  },
  "focus-ring-offset": {
    category: "focus",
    type: "length",
  },
  "focus-ring": {
    category: "focus",
    type: "outline",
  },
  "font-family": {
    category: "typography",
    type: "font-family",
  },
  "font-family-mono": {
    category: "typography",
    type: "font-family",
  },
  "font-size-small": {
    category: "typography",
    type: "length",
  },
  "font-size-body": {
    category: "typography",
    type: "length",
  },
  "font-size-title": {
    category: "typography",
    type: "length",
  },
  "font-weight-regular": {
    category: "typography",
    type: "font-weight",
  },
  "font-weight-strong": {
    category: "typography",
    type: "font-weight",
  },
  "line-height-body": {
    category: "typography",
    type: "number",
  },
  "line-height-tight": {
    category: "typography",
    type: "number",
  },
  "letter-spacing": {
    category: "typography",
    type: "length",
  },
  "control-height": {
    category: "size",
    type: "length",
    density: true,
  },
  "control-height-small": {
    category: "size",
    type: "length",
    density: true,
  },
  "control-padding-x": {
    category: "space",
    type: "length",
    density: true,
  },
  "control-gap": {
    category: "space",
    type: "length",
    density: true,
  },
  "icon-size": {
    category: "size",
    type: "length",
    density: true,
  },
  "target-size": {
    category: "size",
    type: "length",
    density: true,
  },
  "gap-tight": {
    category: "space",
    type: "length",
    density: true,
  },
  "gap-normal": {
    category: "space",
    type: "length",
    density: true,
  },
  "gap-loose": {
    category: "space",
    type: "length",
    density: true,
  },
  "inset-tight": {
    category: "space",
    type: "length",
    density: true,
  },
  "inset-normal": {
    category: "space",
    type: "length",
    density: true,
  },
  "inset-loose": {
    category: "space",
    type: "length",
    density: true,
  },
  "surface-width-small": { category: "size", type: "length" },
  "surface-width-medium": { category: "size", type: "length" },
  "surface-width-large": { category: "size", type: "length" },
  "track-size": { category: "size", type: "length" },
  "sidebar-width": { category: "size", type: "length" },
  "rail-width": { category: "size", type: "length" },
  "inspector-width": { category: "size", type: "length" },
  "bar-height": { category: "size", type: "length" },
  "radius-control": {
    category: "shape",
    type: "length",
  },
  "radius-surface": {
    category: "shape",
    type: "length",
  },
  "radius-round": {
    category: "shape",
    type: "length",
  },
  "border-width": { category: "shape", type: "length" },
  "shadow-raised": {
    category: "shadow",
    type: "shadow",
  },
  "shadow-overlay": {
    category: "shadow",
    type: "shadow",
  },
  "motion-duration-feedback": {
    category: "motion",
    type: "duration",
  },
  "motion-duration-enter": {
    category: "motion",
    type: "duration",
  },
  "motion-duration-exit": {
    category: "motion",
    type: "duration",
  },
  "motion-easing-standard": {
    category: "motion",
    type: "easing",
  },
  "motion-easing-enter": {
    category: "motion",
    type: "easing",
  },
  "motion-easing-exit": {
    category: "motion",
    type: "easing",
  },
  "shadow-floating": { category: "shadow", type: "shadow" },
  "blur-glass": { category: "shadow", type: "length" },
  "motion-duration-panel": { category: "motion", type: "duration" },
  "motion-easing-panel": { category: "motion", type: "easing" },
  "motion-easing-spring": { category: "motion", type: "easing" },
  "motion-duration-loop": { category: "motion", type: "duration" },
  "motion-easing-loop": { category: "motion", type: "easing" },
  "z-raised": {
    category: "z-index",
    type: "integer",
  },
  "z-sticky": {
    category: "z-index",
    type: "integer",
  },
  "z-overlay": {
    category: "z-index",
    type: "integer",
  },
  "opacity-disabled": {
    category: "opacity",
    type: "number",
  },
} as const satisfies Record<SemanticTokenName, SemanticSpec>;

// The unions above are written out so the API reads plainly; these checks keep
// them in step with the definitions.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type DensityKeys<T> = { [K in keyof T]: T[K] extends { density: true } ? K : never }[keyof T];
export type NamesMatch = Assert<Exact<SemanticTokenName, keyof typeof semantic>>;
export type DensityMatches = Assert<Exact<DensityTokenName, DensityKeys<typeof semantic>>>;
export type ComponentNamesMatch = Assert<Exact<ComponentTokenName, keyof typeof component>>;

/**
 * The name of any token `@hussmartinez/ui` defines.
 *
 * @public
 */
export type TokenName = BaseTokenName | SemanticTokenName | ComponentTokenName;

/**
 * The names of `ui`'s component tokens: fine-grained overrides for one
 * component, each falling back to a semantic token.
 *
 * @public
 */
export type ComponentTokenName =
  | "button-height"
  | "button-small-height"
  | "button-padding-x"
  | "button-gap"
  | "button-icon-size"
  | "button-radius"
  | "button-font-weight"
  | "button-bg"
  | "button-bg-hover"
  | "button-bg-active"
  | "button-fg"
  | "button-border-color"
  | "button-primary-bg"
  | "button-primary-bg-hover"
  | "button-primary-bg-active"
  | "button-primary-fg"
  | "button-quiet-bg-hover"
  | "button-quiet-bg-active"
  | "button-danger-bg"
  | "button-danger-bg-hover"
  | "button-danger-fg"
  | "button-disabled-bg"
  | "button-disabled-fg"
  | "button-pressed-bg"
  | "button-pressed-border-color"
  | "button-pressed-fg"
  | "toolbar-bg"
  | "toolbar-border-color"
  | "toolbar-radius"
  | "toolbar-padding"
  | "toolbar-gap"
  | "toolbar-group-gap"
  | "toolbar-separator-color"
  | "segmented-control-height"
  | "segmented-control-small-height"
  | "segmented-control-padding"
  | "segmented-control-gap"
  | "segmented-control-radius"
  | "segmented-control-bg"
  | "segmented-control-border-color"
  | "segmented-control-option-padding-x"
  | "segmented-control-option-fg"
  | "segmented-control-option-bg-hover"
  | "segmented-control-option-checked-bg"
  | "segmented-control-option-checked-fg"
  | "segmented-control-option-checked-border-color"
  | "dialog-bg"
  | "dialog-fg"
  | "dialog-border-color"
  | "dialog-radius"
  | "dialog-shadow"
  | "dialog-padding"
  | "dialog-gap"
  | "dialog-backdrop"
  | "dialog-title-font-size"
  | "dialog-small-width"
  | "dialog-width"
  | "dialog-large-width"
  | "card-bg"
  | "card-fg"
  | "card-border-color"
  | "card-border-color-hover"
  | "card-shadow-hover"
  | "card-radius"
  | "card-padding"
  | "card-gap"
  | "card-title-font-size"
  | "heading-font-size"
  | "spinner-size"
  | "spinner-thickness"
  | "spinner-color"
  | "spinner-track-color"
  | "spinner-duration"
  | "tag-padding-y"
  | "tag-padding-x"
  | "tag-gap"
  | "tag-radius"
  | "tag-font-size"
  | "tag-icon-size"
  | "tag-bg"
  | "tag-fg"
  | "tag-border-color"
  | "tag-accent-bg"
  | "tag-accent-fg"
  | "tag-success-bg"
  | "tag-success-fg"
  | "tag-warning-bg"
  | "tag-warning-fg"
  | "tag-danger-bg"
  | "tag-danger-fg"
  | "tag-list-gap"
  | "tabs-gap"
  | "tabs-list-gap"
  | "tabs-list-border-color"
  | "tabs-tab-height"
  | "tabs-tab-padding-x"
  | "tabs-tab-radius"
  | "tabs-tab-fg"
  | "tabs-tab-bg-hover"
  | "tabs-tab-selected-fg"
  | "tabs-indicator-color"
  | "tabs-indicator-size"
  | "progress-height"
  | "progress-radius"
  | "progress-track-color"
  | "progress-fill-color"
  | "progress-duration"
  | "slider-track-size"
  | "slider-track-color"
  | "slider-radius"
  | "slider-thumb-size"
  | "slider-thumb-color"
  | "slider-thumb-color-hover"
  | "slider-thumb-color-active"
  | "field-gap"
  | "field-label-fg"
  | "field-label-font-weight"
  | "field-description-fg"
  | "field-error-fg"
  | "field-message-font-size"
  | "number-field-height"
  | "number-field-padding-x"
  | "number-field-radius"
  | "number-field-bg"
  | "number-field-fg"
  | "number-field-border-color"
  | "number-field-invalid-border-color"
  | "file-drop-zone-gap"
  | "file-drop-zone-padding"
  | "file-drop-zone-radius"
  | "file-drop-zone-border-color"
  | "file-drop-zone-dragging-border-color"
  | "file-drop-zone-dragging-bg"
  | "file-drop-zone-hint-fg"
  | "tooltip-bg"
  | "tooltip-fg"
  | "tooltip-radius"
  | "tooltip-padding"
  | "tooltip-font-size"
  | "tooltip-shadow"
  | "tooltip-max-width"
  | "tooltip-offset"
  | "text-field-height"
  | "text-field-padding-x"
  | "text-field-radius"
  | "text-field-bg"
  | "text-field-fg"
  | "text-field-placeholder-fg"
  | "text-field-border-color"
  | "text-field-invalid-border-color"
  | "text-area-padding-y"
  | "search-field-gap"
  | "search-field-icon-fg"
  | "reorderable-list-gap"
  | "reorderable-list-row-height"
  | "reorderable-list-row-padding-x"
  | "reorderable-list-row-radius"
  | "reorderable-list-row-fg"
  | "reorderable-list-row-bg-hover"
  | "reorderable-list-row-selected-bg"
  | "reorderable-list-row-selected-border-color"
  | "timeline-track-bg"
  | "timeline-track-radius"
  | "timeline-lane-height"
  | "timeline-playhead-color"
  | "timeline-clip-bg"
  | "timeline-clip-fg"
  | "timeline-clip-border-color"
  | "timeline-clip-radius"
  | "timeline-clip-padding-x"
  | "timeline-clip-selected-bg"
  | "timeline-clip-selected-border-color"
  | "timeline-clip-edge-size"
  | "timeline-header-max-width"
  | "timeline-header-bg"
  | "timeline-lane-border-color"
  | "timeline-clip-moving-shadow"
  | "timeline-clip-refused-border-color"
  | "color-field-gap"
  | "color-field-swatch-size"
  | "color-field-swatch-radius"
  | "color-field-swatch-border-color"
  | "color-field-swatch-checked-border-color"
  | "color-picker-gap"
  | "color-picker-max-width"
  | "color-picker-radius"
  | "color-picker-border-color"
  | "color-picker-strip-height"
  | "color-picker-thumb-size"
  | "color-picker-thumb-color"
  | "color-picker-thumb-outline-color"
  | "color-picker-swatch-size"
  | "color-picker-swatch-checked-border-color"
  | "color-picker-hint-fg"
  | "editor-frame-bg"
  | "editor-frame-gap"
  | "editor-frame-inset"
  | "editor-frame-bar-height"
  | "editor-frame-bar-bg"
  | "editor-frame-bar-fg"
  | "editor-frame-border-color"
  | "editor-frame-panel-bg"
  | "editor-frame-sidebar-width"
  | "editor-frame-rail-width"
  | "editor-frame-inspector-width"
  | "editor-frame-glass-bg"
  | "editor-frame-floating-shadow"
  | "tool-list-group-gap"
  | "tool-list-group-label-fg"
  | "tool-list-item-radius"
  | "tool-list-description-fg"
  | "command-palette-width"
  | "command-palette-bg"
  | "command-palette-radius"
  | "command-palette-shadow"
  | "command-palette-backdrop"
  | "command-palette-option-active-bg"
  | "toast-bg"
  | "toast-fg"
  | "toast-radius"
  | "toast-shadow"
  | "toast-blur"
  | "toast-max-width"
  | "toast-danger-bg"
  | "toast-danger-fg"
  | "progress-overlay-scrim"
  | "progress-overlay-card-bg"
  | "progress-overlay-card-radius"
  | "progress-overlay-card-shadow"
  | "progress-overlay-card-width"
  | "tab-bar-item-radius"
  | "sheet-width"
  | "settings-panel-gap"
  | "settings-panel-label-fg";

type ComponentSpec = { readonly fallback: SemanticTokenName };

const component = {
  "button-height": { fallback: "control-height" },
  "button-small-height": {
    fallback: "control-height-small",
  },
  "button-padding-x": { fallback: "control-padding-x" },
  "button-gap": { fallback: "control-gap" },
  "button-icon-size": { fallback: "icon-size" },
  "button-radius": { fallback: "radius-round" },
  "button-font-weight": {
    fallback: "font-weight-strong",
  },
  "button-bg": { fallback: "color-control" },
  "button-bg-hover": {
    fallback: "color-control-hover",
  },
  "button-bg-active": {
    fallback: "color-control-active",
  },
  "button-fg": { fallback: "color-text" },
  "button-border-color": {
    fallback: "color-border-strong",
  },
  "button-primary-bg": { fallback: "color-accent" },
  "button-primary-bg-hover": {
    fallback: "color-accent-hover",
  },
  "button-primary-bg-active": {
    fallback: "color-accent-active",
  },
  "button-primary-fg": { fallback: "color-on-accent" },
  "button-quiet-bg-hover": {
    fallback: "color-control-hover",
  },
  "button-quiet-bg-active": {
    fallback: "color-control-active",
  },
  "button-danger-bg": { fallback: "color-danger" },
  "button-danger-bg-hover": {
    fallback: "color-danger-hover",
  },
  "button-danger-fg": { fallback: "color-on-danger" },
  "button-disabled-bg": { fallback: "color-control-disabled" },
  "button-disabled-fg": { fallback: "color-text-disabled" },
  "button-pressed-bg": {
    fallback: "color-accent-subtle",
  },
  "button-pressed-border-color": {
    fallback: "color-accent",
  },
  "button-pressed-fg": {
    fallback: "color-text",
  },
  "toolbar-bg": { fallback: "color-surface" },
  "toolbar-border-color": { fallback: "color-border" },
  "toolbar-radius": { fallback: "radius-surface" },
  "toolbar-padding": { fallback: "inset-tight" },
  "toolbar-gap": { fallback: "gap-tight" },
  "toolbar-group-gap": { fallback: "gap-tight" },
  "toolbar-separator-color": { fallback: "color-border" },
  "segmented-control-height": { fallback: "control-height" },
  "segmented-control-small-height": { fallback: "control-height-small" },
  "segmented-control-padding": { fallback: "gap-tight" },
  "segmented-control-gap": { fallback: "gap-tight" },
  "segmented-control-radius": { fallback: "radius-round" },
  "segmented-control-bg": { fallback: "color-surface-sunken" },
  "segmented-control-border-color": { fallback: "color-border-strong" },
  "segmented-control-option-padding-x": { fallback: "control-padding-x" },
  "segmented-control-option-fg": { fallback: "color-text" },
  "segmented-control-option-bg-hover": { fallback: "color-control-hover" },
  "segmented-control-option-checked-bg": { fallback: "color-surface-raised" },
  "segmented-control-option-checked-fg": { fallback: "color-text" },
  "segmented-control-option-checked-border-color": { fallback: "color-border-strong" },
  "dialog-bg": { fallback: "color-surface-raised" },
  "dialog-fg": { fallback: "color-text" },
  "dialog-border-color": { fallback: "color-border" },
  "dialog-radius": { fallback: "radius-surface" },
  "dialog-shadow": { fallback: "shadow-overlay" },
  "dialog-padding": { fallback: "inset-loose" },
  "dialog-gap": { fallback: "gap-loose" },
  "dialog-backdrop": { fallback: "color-overlay" },
  "dialog-title-font-size": { fallback: "font-size-title" },
  "dialog-small-width": { fallback: "surface-width-small" },
  "dialog-width": { fallback: "surface-width-medium" },
  "dialog-large-width": { fallback: "surface-width-large" },
  "card-bg": { fallback: "color-surface" },
  "card-fg": { fallback: "color-text" },
  "card-border-color": { fallback: "color-border" },
  "card-border-color-hover": { fallback: "color-border-strong" },
  "card-shadow-hover": { fallback: "shadow-raised" },
  "card-radius": { fallback: "radius-surface" },
  "card-padding": { fallback: "inset-normal" },
  "card-gap": { fallback: "gap-normal" },
  "card-title-font-size": { fallback: "font-size-body" },
  "heading-font-size": { fallback: "font-size-title" },
  "spinner-size": { fallback: "icon-size" },
  "spinner-thickness": { fallback: "focus-ring-width" },
  "spinner-color": { fallback: "color-accent" },
  "spinner-track-color": { fallback: "color-border" },
  "spinner-duration": { fallback: "motion-duration-loop" },
  "tag-padding-y": { fallback: "gap-tight" },
  "tag-padding-x": { fallback: "inset-tight" },
  "tag-gap": { fallback: "gap-tight" },
  "tag-radius": { fallback: "radius-round" },
  "tag-font-size": { fallback: "font-size-small" },
  "tag-icon-size": { fallback: "font-size-body" },
  "tag-bg": { fallback: "color-control" },
  "tag-fg": { fallback: "color-text" },
  "tag-border-color": { fallback: "color-border" },
  "tag-accent-bg": { fallback: "color-accent-subtle" },
  "tag-accent-fg": { fallback: "color-text" },
  "tag-success-bg": { fallback: "color-success-subtle" },
  "tag-success-fg": { fallback: "color-success-text" },
  "tag-warning-bg": { fallback: "color-warning-subtle" },
  "tag-warning-fg": { fallback: "color-warning-text" },
  "tag-danger-bg": { fallback: "color-danger-subtle" },
  "tag-danger-fg": { fallback: "color-danger-text" },
  "tag-list-gap": { fallback: "gap-normal" },
  "tabs-gap": { fallback: "gap-loose" },
  "tabs-list-gap": { fallback: "gap-tight" },
  "tabs-list-border-color": { fallback: "color-border" },
  "tabs-tab-height": { fallback: "control-height" },
  "tabs-tab-padding-x": { fallback: "control-padding-x" },
  "tabs-tab-radius": { fallback: "radius-control" },
  "tabs-tab-fg": { fallback: "color-text-muted" },
  "tabs-tab-bg-hover": { fallback: "color-control-hover" },
  "tabs-tab-selected-fg": { fallback: "color-text" },
  "tabs-indicator-color": { fallback: "color-accent" },
  "tabs-indicator-size": { fallback: "focus-ring-width" },
  "progress-height": { fallback: "track-size" },
  "progress-radius": { fallback: "radius-round" },
  "progress-track-color": { fallback: "color-surface-sunken" },
  "progress-fill-color": { fallback: "color-accent" },
  "progress-duration": { fallback: "motion-duration-loop" },
  "slider-track-size": { fallback: "track-size" },
  "slider-track-color": { fallback: "color-border-strong" },
  "slider-radius": { fallback: "radius-round" },
  "slider-thumb-size": { fallback: "icon-size" },
  "slider-thumb-color": { fallback: "color-accent" },
  "slider-thumb-color-hover": { fallback: "color-accent-hover" },
  "slider-thumb-color-active": { fallback: "color-accent-active" },
  "field-gap": { fallback: "gap-tight" },
  "field-label-fg": { fallback: "color-text" },
  "field-label-font-weight": { fallback: "font-weight-strong" },
  "field-description-fg": { fallback: "color-text-muted" },
  "field-error-fg": { fallback: "color-danger-text" },
  "field-message-font-size": { fallback: "font-size-small" },
  "number-field-height": { fallback: "control-height" },
  "number-field-padding-x": { fallback: "control-padding-x" },
  "number-field-radius": { fallback: "radius-control" },
  "number-field-bg": { fallback: "color-surface" },
  "number-field-fg": { fallback: "color-text" },
  "number-field-border-color": { fallback: "color-border-strong" },
  "number-field-invalid-border-color": { fallback: "color-danger-text" },
  "file-drop-zone-gap": { fallback: "gap-normal" },
  "file-drop-zone-padding": { fallback: "inset-loose" },
  "file-drop-zone-radius": { fallback: "radius-surface" },
  "file-drop-zone-border-color": { fallback: "color-border-strong" },
  "file-drop-zone-dragging-border-color": { fallback: "color-accent" },
  "file-drop-zone-dragging-bg": { fallback: "color-accent-subtle" },
  "file-drop-zone-hint-fg": { fallback: "color-text-muted" },
  "tooltip-bg": { fallback: "color-text" },
  "tooltip-fg": { fallback: "color-bg" },
  "tooltip-radius": { fallback: "radius-control" },
  "tooltip-padding": { fallback: "inset-tight" },
  "tooltip-font-size": { fallback: "font-size-small" },
  "tooltip-shadow": { fallback: "shadow-raised" },
  "tooltip-max-width": { fallback: "surface-width-small" },
  "tooltip-offset": { fallback: "gap-tight" },
  "text-field-height": { fallback: "control-height" },
  "text-field-padding-x": { fallback: "control-padding-x" },
  "text-field-radius": { fallback: "radius-control" },
  "text-field-bg": { fallback: "color-surface" },
  "text-field-fg": { fallback: "color-text" },
  "text-field-placeholder-fg": { fallback: "color-text-muted" },
  "text-field-border-color": { fallback: "color-border-strong" },
  "text-field-invalid-border-color": { fallback: "color-danger-text" },
  "text-area-padding-y": { fallback: "inset-tight" },
  "search-field-gap": { fallback: "control-gap" },
  "search-field-icon-fg": { fallback: "color-text-muted" },
  "reorderable-list-gap": { fallback: "gap-tight" },
  "reorderable-list-row-height": { fallback: "control-height" },
  "reorderable-list-row-padding-x": { fallback: "control-padding-x" },
  "reorderable-list-row-radius": { fallback: "radius-control" },
  "reorderable-list-row-fg": { fallback: "color-text" },
  "reorderable-list-row-bg-hover": { fallback: "color-control-hover" },
  "reorderable-list-row-selected-bg": { fallback: "color-accent-subtle" },
  "reorderable-list-row-selected-border-color": { fallback: "color-accent" },
  "timeline-track-bg": { fallback: "color-surface-sunken" },
  "timeline-track-radius": { fallback: "radius-control" },
  "timeline-lane-height": { fallback: "control-height" },
  "timeline-playhead-color": { fallback: "color-accent" },
  "timeline-clip-bg": { fallback: "color-control" },
  "timeline-clip-fg": { fallback: "color-text" },
  "timeline-clip-border-color": { fallback: "color-border-strong" },
  "timeline-clip-radius": { fallback: "radius-control" },
  "timeline-clip-padding-x": { fallback: "gap-tight" },
  "timeline-clip-selected-bg": { fallback: "color-accent-subtle" },
  "timeline-clip-selected-border-color": { fallback: "color-accent" },
  "timeline-clip-edge-size": { fallback: "gap-normal" },
  "timeline-header-max-width": { fallback: "surface-width-small" },
  "timeline-header-bg": { fallback: "color-surface" },
  "timeline-lane-border-color": { fallback: "color-border" },
  "timeline-clip-moving-shadow": { fallback: "shadow-raised" },
  "timeline-clip-refused-border-color": { fallback: "color-danger-text" },
  "color-field-gap": { fallback: "gap-tight" },
  "color-field-swatch-size": { fallback: "control-height-small" },
  "color-field-swatch-radius": { fallback: "radius-control" },
  "color-field-swatch-border-color": { fallback: "color-border-strong" },
  "color-field-swatch-checked-border-color": { fallback: "color-text" },
  "color-picker-gap": { fallback: "gap-normal" },
  "color-picker-max-width": { fallback: "surface-width-small" },
  "color-picker-radius": { fallback: "radius-control" },
  "color-picker-border-color": { fallback: "color-border-strong" },
  "color-picker-strip-height": { fallback: "control-height-small" },
  "color-picker-thumb-size": { fallback: "icon-size" },
  "color-picker-thumb-color": { fallback: "color-surface-raised" },
  "color-picker-thumb-outline-color": { fallback: "color-text" },
  "color-picker-swatch-size": { fallback: "control-height-small" },
  "color-picker-swatch-checked-border-color": { fallback: "color-text" },
  "color-picker-hint-fg": { fallback: "color-text-muted" },
  "editor-frame-bg": { fallback: "color-surface-sunken" },
  "editor-frame-gap": { fallback: "gap-normal" },
  "editor-frame-inset": { fallback: "inset-normal" },
  "editor-frame-bar-height": { fallback: "bar-height" },
  "editor-frame-bar-bg": { fallback: "color-surface-raised" },
  "editor-frame-bar-fg": { fallback: "color-text" },
  "editor-frame-border-color": { fallback: "color-border" },
  "editor-frame-panel-bg": { fallback: "color-surface" },
  "editor-frame-sidebar-width": { fallback: "sidebar-width" },
  "editor-frame-rail-width": { fallback: "rail-width" },
  "editor-frame-inspector-width": { fallback: "inspector-width" },
  "editor-frame-glass-bg": { fallback: "color-surface-glass" },
  "editor-frame-floating-shadow": { fallback: "shadow-floating" },
  "tool-list-group-gap": { fallback: "gap-loose" },
  "tool-list-group-label-fg": { fallback: "color-text-muted" },
  "tool-list-item-radius": { fallback: "radius-control" },
  "tool-list-description-fg": { fallback: "color-text-muted" },
  "command-palette-width": { fallback: "surface-width-medium" },
  "command-palette-bg": { fallback: "color-surface-raised" },
  "command-palette-radius": { fallback: "radius-surface" },
  "command-palette-shadow": { fallback: "shadow-overlay" },
  "command-palette-backdrop": { fallback: "color-overlay" },
  "command-palette-option-active-bg": { fallback: "color-accent-subtle" },
  "toast-bg": { fallback: "color-surface-glass" },
  "toast-fg": { fallback: "color-text" },
  "toast-radius": { fallback: "radius-round" },
  "toast-shadow": { fallback: "shadow-floating" },
  "toast-blur": { fallback: "blur-glass" },
  "toast-max-width": { fallback: "surface-width-medium" },
  "toast-danger-bg": { fallback: "color-danger-subtle" },
  "toast-danger-fg": { fallback: "color-danger-text" },
  "progress-overlay-scrim": { fallback: "color-overlay" },
  "progress-overlay-card-bg": { fallback: "color-surface-raised" },
  "progress-overlay-card-radius": { fallback: "radius-surface" },
  "progress-overlay-card-shadow": { fallback: "shadow-overlay" },
  "progress-overlay-card-width": { fallback: "surface-width-small" },
  "tab-bar-item-radius": { fallback: "radius-control" },
  "sheet-width": { fallback: "surface-width-small" },
  "settings-panel-gap": { fallback: "gap-loose" },
  "settings-panel-label-fg": { fallback: "color-text" },
} as const satisfies Record<ComponentTokenName, ComponentSpec>;

function baseDefinitions(): TokenDefinition[] {
  const list: TokenDefinition[] = [];
  const add = (name: BaseTokenName, category: TokenCategory, type: TokenType): void => {
    list.push({ name, level: "base", category, type, density: false });
  };
  for (const hue of HUES) {
    for (const step of STEPS) {
      add(`${hue}-${step}`, "color", "color");
    }
  }
  add("white", "color", "color");
  add("black", "color", "color");
  for (let step = 1; step <= 12; step++) {
    add(`space-${step}` as BaseTokenName, "space", "length");
  }
  for (const size of ["none", "sm", "md", "lg", "xl", "2xl", "full"] as const) {
    add(`radius-${size}`, "shape", "length");
  }
  add("border-width-1", "shape", "length");
  add("border-width-2", "shape", "length");
  add("font-sans", "typography", "font-family");
  add("font-mono", "typography", "font-family");
  for (let step = 1; step <= 7; step++) {
    add(`font-size-${step}` as BaseTokenName, "typography", "length");
  }
  for (const weight of [400, 500, 600, 700] as const) {
    add(`font-weight-${weight}`, "typography", "font-weight");
  }
  for (const leading of ["tight", "normal", "relaxed"] as const) {
    add(`leading-${leading}`, "typography", "number");
  }
  for (const speed of ["fast", "normal", "slow"] as const) {
    add(`duration-${speed}`, "motion", "duration");
  }
  for (const easing of ["standard", "decelerate", "accelerate", "emphasized", "spring"] as const) {
    add(`easing-${easing}`, "motion", "easing");
  }
  return list;
}

function semanticDefinitions(): TokenDefinition[] {
  return Object.entries(semantic).map(([name, spec]) => ({
    name,
    level: "semantic",
    category: spec.category,
    type: spec.type,
    density: "density" in spec,
  }));
}

/**
 * Every token `@hussmartinez/ui` defines, base tokens first, in a stable
 * order. Use it to build token documentation or tooling.
 *
 * @public
 */
export const tokens: readonly TokenDefinition[] = /* @__PURE__ */ allDefinitions();

/** Every definition, frozen. A function, so importing this module has no side effects. */
function allDefinitions(): readonly TokenDefinition[] {
  const semanticList = semanticDefinitions();
  return Object.freeze(
    [...baseDefinitions(), ...semanticList, ...componentDefinitions(semanticList)].map(
      (definition) => Object.freeze(definition),
    ),
  );
}

/** Component tokens take their category and type from their fallback. */
function componentDefinitions(semanticList: readonly TokenDefinition[]): TokenDefinition[] {
  const byFallback = new Map(semanticList.map((definition) => [definition.name, definition]));
  return Object.entries(component).map(([name, spec]) => {
    const fallback = byFallback.get(spec.fallback) as TokenDefinition;
    return {
      name,
      level: "component",
      category: fallback.category,
      type: fallback.type,
      density: false,
      fallback: spec.fallback,
    };
  });
}

/** Token definitions by name. */
export const tokensByName: ReadonlyMap<string, TokenDefinition> = /* @__PURE__ */ byName(tokens);

function byName(list: readonly TokenDefinition[]): ReadonlyMap<string, TokenDefinition> {
  return new Map(list.map((definition) => [definition.name, definition]));
}

/** The names of the density tokens, in definition order. */
export const densityTokenNames: readonly DensityTokenName[] = /* @__PURE__ */ densityNames();

function densityNames(): DensityTokenName[] {
  return tokens
    .filter((definition) => definition.density)
    .map((definition) => definition.name as DensityTokenName);
}
