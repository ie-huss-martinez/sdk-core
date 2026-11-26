"use client";

/**
 * Accessible React components of the `@hussmartinez` design system.
 *
 * @remarks
 * A client entry: it starts with `"use client"`, which the build keeps
 * (ADR 0007). React and React DOM 18.3 or later are optional peer
 * dependencies.
 *
 * @packageDocumentation
 */

export type {
  Announce,
  AnnouncerProviderProps,
  Politeness,
} from "./components/announcer/Announcer.js";
export { AnnouncerProvider, useAnnounce } from "./components/announcer/Announcer.js";
export type {
  ButtonPart,
  ButtonProps,
  ButtonSize,
  ButtonVariant,
} from "./components/button/Button.js";
export { Button } from "./components/button/Button.js";
export type { ButtonLinkProps } from "./components/button/ButtonLink.js";
export { ButtonLink } from "./components/button/ButtonLink.js";
export type { IconButtonProps } from "./components/button/IconButton.js";
export { IconButton } from "./components/button/IconButton.js";
export type { CardPart, CardProps } from "./components/card/Card.js";
export { Card } from "./components/card/Card.js";
export type {
  ColorFieldPart,
  ColorFieldProps,
  ColorSwatch,
} from "./components/color-field/ColorField.js";
export { ColorField } from "./components/color-field/ColorField.js";
export type {
  ColorPickerPart,
  ColorPickerProps,
} from "./components/color-picker/ColorPicker.js";
export { ColorPicker } from "./components/color-picker/ColorPicker.js";
export { addRecentColor } from "./components/color-picker/color.js";
export type {
  CommandPaletteItem,
  CommandPalettePart,
  CommandPaletteProps,
} from "./components/command-palette/CommandPalette.js";
export { CommandPalette } from "./components/command-palette/CommandPalette.js";
export { filterCommandPaletteItems } from "./components/command-palette/filter.js";
export type { DialogPart, DialogProps } from "./components/dialog/Dialog.js";
export { Dialog } from "./components/dialog/Dialog.js";
export type {
  EditorFrameControls,
  EditorFramePart,
  EditorFramePropertiesState,
  EditorFrameProps,
  EditorFrameToolsState,
} from "./components/editor-frame/EditorFrame.js";
export {
  EditorFrame,
  useEditorFrame,
} from "./components/editor-frame/EditorFrame.js";
export type { FieldPart, FieldProps } from "./components/field/Field.js";
export { Field } from "./components/field/Field.js";
export type { FieldControlProps } from "./components/field/field-context.js";
export type {
  FileDropZonePart,
  FileDropZoneProps,
  FileRejection,
} from "./components/file-drop-zone/FileDropZone.js";
export { FileDropZone } from "./components/file-drop-zone/FileDropZone.js";
export type {
  HeadingLevelProviderProps,
  HeadingPart,
  HeadingProps,
} from "./components/heading/Heading.js";
export {
  Heading,
  HeadingLevelProvider,
  useHeadingLevel,
} from "./components/heading/Heading.js";
export type {
  UiMessages,
  UiMessagesProviderProps,
} from "./components/messages/UiMessagesProvider.js";
export { UiMessagesProvider, useUiMessages } from "./components/messages/UiMessagesProvider.js";
export type { ModeSwitchProps } from "./components/mode-switch/ModeSwitch.js";
export { ModeSwitch } from "./components/mode-switch/ModeSwitch.js";
export type { MorphTransitionOptions } from "./components/morph-transition/morph-transition.js";
export { startMorphTransition } from "./components/morph-transition/morph-transition.js";
export type { NumberFieldProps } from "./components/number-field/NumberField.js";
export { NumberField } from "./components/number-field/NumberField.js";
export type { ProgressBarProps } from "./components/progress-bar/ProgressBar.js";
export { ProgressBar } from "./components/progress-bar/ProgressBar.js";
export type {
  ProgressOverlayPart,
  ProgressOverlayProps,
} from "./components/progress-overlay/ProgressOverlay.js";
export { ProgressOverlay } from "./components/progress-overlay/ProgressOverlay.js";
export type {
  ReorderableListItemPart,
  ReorderableListItemProps,
  ReorderableListProps,
} from "./components/reorderable-list/ReorderableList.js";
export {
  focusReorderableListItem,
  ReorderableList,
  ReorderableListItem,
} from "./components/reorderable-list/ReorderableList.js";
export type {
  SegmentedControlOption,
  SegmentedControlPart,
  SegmentedControlProps,
} from "./components/segmented-control/SegmentedControl.js";
export { SegmentedControl } from "./components/segmented-control/SegmentedControl.js";
export type { SettingsPanelProps } from "./components/settings-panel/SettingsPanel.js";
export { SettingsPanel } from "./components/settings-panel/SettingsPanel.js";
export type { ClassNames, StyleProps } from "./components/shared/style-props.js";
export type { SheetProps } from "./components/sheet/Sheet.js";
export { Sheet } from "./components/sheet/Sheet.js";
export type { SliderProps } from "./components/slider/Slider.js";
export { Slider } from "./components/slider/Slider.js";
export type { SpinnerProps } from "./components/spinner/Spinner.js";
export { Spinner } from "./components/spinner/Spinner.js";
export type { TabBarItem, TabBarPart, TabBarProps } from "./components/tab-bar/TabBar.js";
export { TabBar } from "./components/tab-bar/TabBar.js";
export type { TagListProps, TagPart, TagProps, TagTone } from "./components/tag/Tag.js";
export { Tag, TagList } from "./components/tag/Tag.js";
export type { TextAreaProps } from "./components/text-area/TextArea.js";
export { TextArea } from "./components/text-area/TextArea.js";
export type { TextFieldProps, TextFieldType } from "./components/text-field/TextField.js";
export { TextField } from "./components/text-field/TextField.js";
export type { ThemeToggleProps } from "./components/theme-toggle/ThemeToggle.js";
export { ThemeToggle } from "./components/theme-toggle/ThemeToggle.js";
export type {
  TimelineLanes,
  TimelineLayerProps,
  TimelinePart,
  TimelineProps,
  TimelineRange,
  TimelineScale,
} from "./components/timeline/Timeline.js";
export {
  Timeline,
  TimelineLayer,
  useTimelineLanes,
  useTimelineScale,
} from "./components/timeline/Timeline.js";
export type {
  TimelineClip,
  TimelineClipDrop,
  TimelineClipEdge,
  TimelineClipsHandle,
  TimelineClipsPart,
  TimelineClipsProps,
} from "./components/timeline/TimelineClips.js";
export { TimelineClips } from "./components/timeline/TimelineClips.js";
export type {
  TimelineLanePart,
  TimelineLaneProps,
} from "./components/timeline/TimelineLane.js";
export { TimelineLane } from "./components/timeline/TimelineLane.js";
export type {
  TimelinePlayheadPart,
  TimelinePlayheadProps,
} from "./components/timeline/TimelinePlayhead.js";
export { TimelinePlayhead } from "./components/timeline/TimelinePlayhead.js";
export type {
  ToastApi,
  ToastOptions,
  ToastPart,
  ToastProviderProps,
} from "./components/toast/Toast.js";
export { ToastProvider, useToast } from "./components/toast/Toast.js";
export type {
  ToggleButtonBaseProps,
  ToggleButtonIconProps,
  ToggleButtonProps,
  ToggleButtonTextProps,
  ToggleButtonVariant,
} from "./components/toggle-button/ToggleButton.js";
export { ToggleButton } from "./components/toggle-button/ToggleButton.js";
export type {
  ToolListGroup,
  ToolListItem,
  ToolListPart,
  ToolListProps,
} from "./components/tool-list/ToolList.js";
export { ToolList } from "./components/tool-list/ToolList.js";
export type { ToolbarProps } from "./components/toolbar/Toolbar.js";
export { Toolbar } from "./components/toolbar/Toolbar.js";
export type { ToolbarGroupProps } from "./components/toolbar/ToolbarGroup.js";
export { ToolbarGroup } from "./components/toolbar/ToolbarGroup.js";
export type { ToolbarSeparatorProps } from "./components/toolbar/ToolbarSeparator.js";
export { ToolbarSeparator } from "./components/toolbar/ToolbarSeparator.js";
export type { TooltipPart, TooltipProps } from "./components/tooltip/Tooltip.js";
export { Tooltip } from "./components/tooltip/Tooltip.js";
export type { VisuallyHiddenProps } from "./components/visually-hidden/VisuallyHidden.js";
export { VisuallyHidden } from "./components/visually-hidden/VisuallyHidden.js";
// The type an SDK's `headingLevel` prop takes, beside the component that uses it.
export type { HeadingLevel } from "./heading/heading-level.js";
export type { IconComponent, IconProps } from "./icons/create-icon.js";
export type { IconName } from "./icons/icon-name.generated.js";
// One module-level function per icon, so bundlers keep only those imported
// (docs/adr/0005).
export * from "./icons/icons.generated.js";
export { uiMessages } from "./messages/en.js";
export type { EditorPreferences } from "./preferences/editor-preferences.js";
export {
  defaultEditorPreferences,
  editorPreferenceOptions,
  readEditorPreferences,
} from "./preferences/editor-preferences.js";
export type { InheritedEditorPreference } from "./preferences/inherited.js";
export type {
  ThemeProviderBaseProps,
  ThemeProviderModeProps,
  ThemeProviderProps,
  ThemeProviderSingleProps,
} from "./react/ThemeProvider.js";
export { ThemeProvider } from "./react/ThemeProvider.js";
export type {
  EditorPreferencesChange,
  EditorPreferencesControls,
  UseEditorPreferencesOptions,
} from "./react/use-editor-preferences.js";
export { useEditorPreferences } from "./react/use-editor-preferences.js";
export { useLatest } from "./react/use-latest.js";
export { usePlatform } from "./react/use-platform.js";
export type { ColorMode, Density, Theme, ThemePair } from "./theme/types.js";
