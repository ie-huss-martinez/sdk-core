# @hussmartinez/ui

[![npm version of @hussmartinez/ui](https://img.shields.io/npm/v/@hussmartinez/ui)](https://www.npmjs.com/package/@hussmartinez/ui) [![Verify workflow status on main](https://github.com/ie-huss-martinez/ui/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/ie-huss-martinez/ui/actions/workflows/verify.yml?query=branch%3Amain) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/ie-huss-martinez/ui/blob/main/LICENSE)

The design system of the `@hussmartinez` SDK family: design tokens, themes, base styles and accessible React components. Every SDK's editor uses it, and standalone applications can too.

> Status: `0.x`, so the API may still change between minor versions. Tokens, theming and the first components are available; more components are on the way.

## Install

```sh
npm install @hussmartinez/ui
```

For the React components, your application also needs `react` and `react-dom` 18.3 or later. They're optional peer dependencies, so the tokens and theme helpers work without them.

A React Native application needs `react-native` 0.81 or later, and `react-native-svg` 15 or later for the icons, and imports [`@hussmartinez/ui/native`](#react-native) instead of the React entry and the stylesheet.

## Quick start

Import the stylesheet once, at the root of your application, and use the components:

```tsx
import "@hussmartinez/ui/styles.css";
import { Button, ThemeProvider } from "@hussmartinez/ui/react";

export function App() {
  return (
    <ThemeProvider mode="system">
      <Button variant="primary">Save</Button>
    </ThemeProvider>
  );
}
```

`mode="system"` follows the operating system's light or dark preference, in CSS, so nothing flashes on load. Without `ThemeProvider`, the page follows the system preference too; the provider is for a forced mode, a density or a custom theme.

## Entry points

The package is ESM only ([ADR 0004](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0004-entry-points-and-module-format.md)).

| Entry | Contents |
|---|---|
| `@hussmartinez/ui` | Tokens, `createTheme`, `themeToCss`, the built-in themes and their types. No React and no DOM access on import, so it's safe in Server Components and build scripts |
| `@hussmartinez/ui/react` | `ThemeProvider`, `UiMessagesProvider` and the components. Starts with `"use client"`. React and React DOM `>=18.3` are optional peer dependencies |
| `@hussmartinez/ui/styles.css` | All styles: the built-in tokens and base styles, in the cascade layers `hm.tokens` and `hm.base`. Import it once in your application |
| `@hussmartinez/ui/native` | For React Native: the themes as native values, the icons as data with `Icon`, `Text`, `Button`, `ChoiceList`, and helpers for direction, preferences and announcements. No DOM and no stylesheet. `react-native` `>=0.81` and `react-native-svg` `>=15` are optional peer dependencies. See [React Native](#react-native) |

JavaScript never imports CSS, so your application decides where the stylesheet loads. Your own unlayered CSS overrides every `hm` layer without `!important` ([ADR 0005](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0005-plain-css-with-cascade-layers.md)).

## Tokens

Every visual value is a CSS custom property, such as `--hm-color-accent` or `--hm-radius-control`. Base tokens are raw scales; semantic tokens name a purpose, and are the ones to use. The [token reference](https://github.com/ie-huss-martinez/ui/blob/main/packages/ui/docs/tokens.md) lists them all, with their light, dark and compact values.

```css
.my-panel {
  background: var(--hm-color-surface);
  border-radius: var(--hm-radius-surface);
  padding: var(--hm-inset-normal);
}
```

## Themes

With `styles.css` loaded, the built-in light and dark themes follow the operating system's preference, in pure CSS, so nothing flashes on load. Attributes change any subtree:

```html
<section data-hm-theme="dark">Always dark</section>
<section data-hm-theme="system">Follows the system again</section>
<aside data-hm-density="compact">Tighter controls</aside>
```

`data-hm-theme` takes `light`, `dark` or `system`, and `data-hm-density` takes `comfortable` (the default) or `compact`. On touch screens, targets are 44 px in either density. A themed subtree also sets its text colour to `--hm-color-text`, in the lowest-priority layer, so your own CSS still wins. Backgrounds are left to you: paint them with `--hm-color-bg` or `--hm-color-surface`.

### Text outside components

Components set their own font and colour. Text you render yourself, such as an editor's own labels, values and status lines, takes the page's font unless you say otherwise. Put **`hm-text`** on its root, usually your editor's or application's outermost element:

```html
<div class="hm-text my-editor">…</div>
```

It sets `font-family`, `font-size`, `font-weight`, `letter-spacing`, `line-height` and `color` from the tokens (`--hm-font-family`, `--hm-font-size-body`, `--hm-font-weight-regular`, `--hm-letter-spacing`, `--hm-line-height-body`, `--hm-color-text`), and everything inside inherits them. It's opt-in, so ui never restyles a page that didn't ask, and it's in the lowest-priority layer, so an SDK's rules in `hm.sdk` and your own CSS still win. It follows `data-hm-theme` and `data-hm-density` like everything else.

### Custom themes

`createTheme` validates a set of token values. Extend a built-in theme and change only what you need, or set every semantic token to replace the look entirely.

```ts
import { createTheme } from "@hussmartinez/ui";

export const brandLight = createTheme({
  extends: "light",
  tokens: { "color-accent": "#5b21b6", "radius-control": "0" },
});
export const brandDark = createTheme({
  extends: "dark",
  tokens: { "color-accent": "#c4b5fd", "radius-control": "0" },
});
```

- **Validation:** every value is checked against its token's type and an allowlist grammar, so a value can't break out of its CSS, even when it comes from a user. Invalid values throw `UiError` with the code `INVALID_THEME_TOKEN`. Show users the text from `uiMessages`, never the error's `message`.
- **Contrast:** in development, `createTheme` warns when text, boundary or focus colours fall below WCAG 2.2 AA contrast. `checkContrast(theme)` returns the same report, for checking colours users choose.

There are two ways to apply a theme.

**`ThemeProvider`** applies a theme, a colour mode and a density to everything inside it. It renders on the server, so there's no flash before hydration. Create themes once, at module level, not during render.

```tsx
import { ThemeProvider } from "@hussmartinez/ui/react";

<ThemeProvider theme={{ light: brandLight, dark: brandDark }} mode="system" density="compact">
  <App />
</ThemeProvider>;
```

Without `theme`, it applies the built-in themes. `mode` is `light`, `dark` or `system`. Themes must come from `createTheme`; pass one loaded as JSON through `createTheme` first. An application that uses only the built-in themes doesn't ship the theme validator: `ThemeProvider` on its own is about 1 kB, minified and compressed.

**`themeToCss`** writes a theme as a static stylesheet, at build time or on the server:

```ts
import { themeToCss } from "@hussmartinez/ui";

const css = themeToCss({ light: brandLight, dark: brandDark }); // applies to :root
const scoped = themeToCss(brandLight, ".marketing"); // only inside .marketing
```

Custom themes always beat the built-in ones, whatever order stylesheets load in. Themes can nest; the closest one wins. Invalid selectors throw `UiError` with the code `INVALID_THEME_SELECTOR`.

## React Native

`@hussmartinez/ui/native` is `ui` for React Native ([ADR 0069 in sdk-core](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0069-react-native-entry-points.md)). It shares the web's tokens and icons, not its components: there's no DOM and no CSS on a device.

```tsx
import {
  announce,
  Button,
  ChoiceList,
  Dir,
  NativeUiProvider,
  Text,
} from "@hussmartinez/ui/native";

export function Question({ locale, preferences, question, choices, answer, t, next }) {
  return (
    <NativeUiProvider colorMode={preferences.theme} textScale={preferences.textScale}>
      <Dir locale={locale} style={{ flex: 1 }}>
        <Text variant="title">{question}</Text>
        <ChoiceList
          accessibilityLabel={question}
          choices={choices}
          correctKey={answer.key}
          feedbackLabels={{ correct: t("correct"), hint: t("yourAnswer") }}
          onValueChange={(key) =>
            announce(key === answer.key ? t("right") : t("itWas", { answer: answer.label }))
          }
        />
        <Button variant="primary" size="large" onPress={next}>
          {t("next")}
        </Button>
      </Dir>
    </NativeUiProvider>
  );
}
```

- **Themes:** `lightNativeTheme` and `darkNativeTheme` hold every semantic token under the web's name, such as `theme.tokens["color-accent"]`, resolved when `ui` is built: colours as `#rrggbb` or `#rrggbbaa`, lengths in density-independent pixels at 16 to a `rem`, durations in milliseconds, curves as four numbers for `Easing.bezier`. Targets are 44 dp, as on any touch screen. Tokens that describe CSS itself, such as font stacks and shadow lists, are left out.
  - `createNativeTheme({ extends, tokens })` changes the tokens you give, with native values, and throws `UiError` with the code `INVALID_THEME_TOKEN` for an unknown name or a value of the wrong kind. It doesn't check contrast: check a custom palette against the pairs in `contrastPairs` yourself.
  - **Four tokens are native only:** `color-hint`, `color-hint-subtle` and `color-hint-text`, a gentle tone for "not this one, look again", and `control-height-large`, 64 dp.
- **`NativeUiProvider`** gives components a theme, or a light and dark pair chosen by `colorMode` (`system` follows the device), a `textScale` from 1 to 2, and a `motion` preference. `useNativeTheme()` and `useTextScale()` read them for your own views. Without a provider, components use the light theme.
- **`Text`:** `variant` is `body`, `small` or `title`; `tone` is `default`, `muted`, `accent`, `success`, `hint`, `warning` or `danger`. Its size follows the text scale, on top of the device's own font size setting.
- **`Button`,** on `Pressable`: `variant` is `primary`, `secondary`, `quiet`, `selected`, `success` or `hint`; `size` is `medium`, a 44 dp target, or `large`, 64 dp, and both grow with the text scale. `icon` takes one of `ui`'s icons or any element. It shows focus, and tells screen readers it's a button and whether it's disabled.
- **`ChoiceList`:** a radio group with large targets. With `correctKey`, it's an errorless question: once a choice is picked, the right one is shown in the success colours with a check, a pick that wasn't right in the hint colours, never as an error, and the rest are dimmed. It has no text of its own: `feedbackLabels` is what a screen reader adds to those two choices' names. `choiceState(key, picked, correctKey)` is the same decision as a function, for a layout of your own.
- **Icons:** every icon of `ui`'s set is a plain object, such as `undoIcon`, and `<Icon icon={undoIcon} />` draws it with `react-native-svg` in the theme's text colour. Icons that point along the reading direction are mirrored inside right-to-left content. With `label`, the icon is an image with that name; without, it's hidden from screen readers.
- **Direction:** `isRTL("ar-EG")` reads a locale without `Intl`. `<Dir locale="ar">` lays out its subtree in that language's direction with the `direction` style, which takes effect at once, unlike `I18nManager.forceRTL`. `<NoFlip>` keeps a physical layout, such as a map or a grid, as it is. `useDirection()` returns the closest one's.
- **Preferences** are the application's to keep: `readNativePreferences(value)` reads `{ theme, textScale, motion }` from anything, such as JSON from storage, and never throws; `nativePreferenceOptions` lists what a settings screen offers. `useReducedMotion()` follows the `motion` preference and the device's setting, and answers `true` until the device's is known.
- **`announce(message)`** has the screen reader say a result, through `AccessibilityInfo`.

`ui`'s own checks build against Expo SDK 58, with React Native 0.88 and `react-native-svg` 15.16. Earlier versions inside the peer ranges, from React Native 0.81, are accepted but not built here.

Text is yours: the native components take every visible string and accessible name as a prop. Nothing renders on a device in `ui`'s own tests, so check a screen with VoiceOver and TalkBack when you first use a component.

## Server rendering and frameworks

Every component renders on the server and hydrates without warnings; end-to-end tests check it in a Next.js App Router application and a server-rendered Vite application ([ADR 0007](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0007-server-rendering-and-nextjs.md)). Nothing touches the browser when either entry is imported.

- **Next.js Server Components** can import `@hussmartinez/ui` (tokens, `createTheme`, `themeToCss`) and render components from `@hussmartinez/ui/react` directly, as long as they pass no functions. Put components that need callbacks, such as `Dialog`, in a client component.
- **Custom themes in Server Components:** a theme passed to a client component is serialised, so `ThemeProvider` can't receive one from a Server Component. Write it as CSS instead, `<style>{themeToCss(theme, ".brand")}</style>`, or create the theme in a client module.
- **Vite** may print "module level directive may not be preserved" for `@hussmartinez/ui/react`. It's harmless: `"use client"` only matters to frameworks with Server Components.

## Content Security Policy

- **The built-in themes** need no inline styles: `styles.css` and the `data-hm-*` attributes are enough.
- **`ThemeProvider` with a custom theme** renders a `<style>` element. Allow it with a nonce, `style-src 'self' 'nonce-…'`, and pass the same nonce to the `nonce` prop.
- **A strict policy without nonces:** generate the theme with `themeToCss` at build time and serve it as a stylesheet, then use `ThemeProvider` without `theme`, or plain `data-hm-*` attributes.

No styles are evaluated as JavaScript, and nothing needs `unsafe-eval`.

## Files from users

`FileDropZone` hands you `File` objects. Treat each one as untrusted:

- **`accept` is a hint, not a check.** A file's name and type are whatever its sender chose, so the zone's checks only spare people an obvious mistake. Check the contents, and the size, before using a file, as each SDK's file policy does.
- **Show names as text.** Render `file.name` as a React text child, never through `dangerouslySetInnerHTML` or `innerHTML`. The zone itself never shows a name.
- **Read in your own code.** The zone never reads a file, so reading, and its limits, stay under your control.

## Components

Every component follows one contract ([ADR 0003](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0003-component-contract.md)):

- **Styling:** `className` on the root, `classNames` per named part, and stable `.hm-*` classes to target. `unstyled` drops colours, borders, typography and motion, and keeps layout, focus rings and target sizes.
- **Theming:** component tokens, such as `--hm-button-radius`, fall back to semantic tokens. Set them on any ancestor.
- **Refs and props:** refs reach the root element, and native props pass through.
- **Text:** text props, falling back to `UiMessagesProvider`.

| Component | Use it for |
|---|---|
| `Button` | Actions. `variant` is `primary`, `secondary` (default), `quiet` or `danger`; `size` is `medium` or `small`; `pressed` shows a toggle state you control, as `ToggleButton` does; `startIcon` and `endIcon` take icons |
| `IconButton` | Icon-only actions. `label` is required: it's the accessible name |
| `ButtonLink` | Navigation that looks like a button: a native `<a href>` with `Button`'s `variant`, `size`, `startIcon` and `endIcon`. It's a link to assistive technology, Enter follows it and Space doesn't, and it has no `disabled` or `pressed`. With `target="_blank"`, `rel` defaults to `noopener noreferrer` and the link says "(opens in a new tab)", in text hidden on screen, after its own text or its `aria-label`: `newTabHint` replaces it, and `""` leaves it out. Show it too, with `endIcon={<ExternalLinkIcon />}`. A `javascript:` URL is refused: the link renders without an `href`. Static, so it needs no hydration ([ADR 0015](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/ui/docs/adr/0015-tag-and-button-link.md)) |
| `ToggleButton` | Turning something on or off, such as loop or the active tool, exposed as `aria-pressed`. `variant` is `secondary` (default) or `quiet`. Controlled with `pressed` and `onPressedChange`, or uncontrolled from `defaultPressed`. Text children, or `icon` with a required `label`. The label stays the same in both states, so a button whose label changes, such as play and pause, is an `IconButton` that swaps its `label` |
| `VisuallyHidden` | Text for assistive technology only |
| `Toolbar`, `ToolbarGroup`, `ToolbarSeparator` | A row or column of controls with one Tab stop: arrow keys move between items, Home and End jump to the ends. `label` is required on the toolbar and its groups |
| `SegmentedControl` | A few mutually exclusive choices side by side. A radio group: arrow keys move and select. Inside a `Toolbar`, it joins the toolbar's arrow keys, and Space or Enter selects |
| `FileDropZone` | Choosing or dropping files, such as a document to open. Its button opens the system's file picker and is the keyboard and screen reader path; the zone around it takes drops from a pointer, with `data-hm-dragging` while files are over it. `accept` and `multiple` are checked by name, type and count, and folders are turned away; `onFiles` gets the rest, and `onFilesRejected` the others, with a reason. It never reads a file or shows its name, and while it's on the page, a file dropped beside it doesn't open in place of the page; `preventStrayDrops={false}` leaves that to you |
| `Dialog` | A modal dialog on the native `<dialog>`: focus moves in and is trapped, the page behind is inert, Escape asks to close through `onOpenChange(false)`, and focus returns to the opener. Controlled by `open`; labelled by `title`. Its title is always an `<h2>`, and a `Heading` in its content is an `<h3>`. Long content scrolls in the body, which becomes keyboard-scrollable when it overflows |
| `Card` | Something the user opens, such as a notebook, a lesson or a recent file: an `<article>` labelled by its `title`. Put your link or button in `title`: it covers the whole card, with one Tab stop and the focus ring around the card. `eyebrow` shows a short label above the title, `media` an image at the top (both read after the title), and `footer` details or actions, whose buttons and links keep their own clicks. Its heading level follows `HeadingLevelProvider` or `headingLevel`. Static, so an `<a href>` card needs no hydration ([ADR 0014](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/ui/docs/adr/0014-card-and-morph-transition.md)) |
| `startMorphTransition` | Growing an element into the one that replaces it, such as a `Card` into its `Dialog`, with the browser's view transitions: `startMorphTransition({ from, to, update })`, and the reverse to close. With reduced motion, or without the API, it just runs `update` |
| `Heading`, `HeadingLevelProvider` and `useHeadingLevel` | The visible title of a section, as a native `<h2>` to `<h6>`, styled as a title through `--hm-heading-font-size`. Its level is `level`, or the closest `HeadingLevelProvider`'s, or 2. Give it an `id` and label its section with `aria-labelledby`. See [Heading levels](#heading-levels) |
| `Tag` and `TagList` | A short, static label, such as a category, a technology or a state: text, not a control, so it takes no focus. `tone` is `neutral` (default), `accent`, `success`, `warning` or `danger`, and never says a state alone: the text does. `icon` takes a decorative icon. Text too long for its line wraps inside the tag. `TagList` is a `<ul>` that wraps, and a `Tag` directly inside it is its `<li>`, so a screen reader counts the tags; name it with `aria-label` when nothing beside it does. `as="li"` makes a tag a list item where it can't know its list: in your own `<ul>`, or in an `.astro` file. Recolour a neutral tag with `--hm-tag-bg`, `--hm-tag-fg` and `--hm-tag-border-color`; each other tone has its own pair, such as `--hm-tag-success-bg` and `--hm-tag-success-fg`. Static, so they need no hydration. A tag that does something is a `Button` or a `ToggleButton` |
| `Tabs` | Sections of which one shows at a time, chosen from a row of tabs: `tabs` is a list of `{ id, label, icon, content }`, and `label` names the row. One Tab stop for the row; the arrow keys, Home and End move between tabs and select, mirrored in right-to-left text; Tab again reaches the panel. `activation="manual"` makes the arrows only move focus, and Enter or Space select. Controlled with `value` and `onValueChange`, or uncontrolled from `defaultValue`. A row too long for its width scrolls, and keeps the selected tab in view. **Before JavaScript runs, every panel is shown,** one after another, each under a heading with its tab's label, at `headingLevel` or the closest `HeadingLevelProvider`'s level; once it hydrates it becomes tabs, and what's inside the panels is kept ([ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/ui/docs/adr/0016-tabs.md)) |
| `Spinner` | Loading for an unknown time. An indeterminate progress bar to assistive technology, named by `label`; its size follows `--hm-spinner-size` |
| `ProgressBar` | Progress for a known amount, on the native `<progress>`: `value`, `max`, `label`, `valueText`. Indeterminate without `value`. It needs no inline styles, so it works under a strict Content Security Policy |
| `Field` | A visible `label`, an optional `description` and an optional `error`, wired to one control: the label names it, the description and error describe it, and an error marks it `aria-invalid`. `Slider`, `NumberField`, `TextField`, `TextArea` and `ColorField` connect themselves; for a native `<input>` or `<select>`, pass a function and spread the props it receives |
| `NumberField` | A number typed as text, exposed as a spin button. Typing is committed on blur or Enter and kept within `min` and `max`; text that isn't a number goes back to the last value, so `onValueChange` never receives `NaN`. Arrow Up and Down step by `step`, Page Up and Down by `largeStep`, and Escape throws the typing away. `parse` and `format` default to the `locale`, or `UiMessagesProvider`'s, digits and separators included; replace them for units or a timecode. With `name`, forms receive the number |
| `TextField` | Single-line text: `text`, `search`, `email`, `url`, `tel` or `password`. Native input props pass through, plus `onValueChange(value)`. In a `Field`, it takes the field's label, description and error, and shows the error with its border |
| `TextArea` | Multi-line text, styled like `TextField` and with its tokens. `rows` sets its height, three by default, and the user can drag it taller. Native textarea props pass through, plus `onValueChange(value)`; the value separates lines with `\n`. In a `Field`, it takes the field's label, description and error |
| `ColorField` | A colour: a hex input (`#rrggbb` or `#rgb`, with or without the `#`) beside a preview, and optional `swatches` to pick from, each `{ value, label }`. Controlled with `value` and `onValueChange`, or uncontrolled from `defaultValue`; the value is always lowercase `#rrggbb`. Typing commits on Enter or blur, text that isn't a colour goes back to the last value, and Escape throws the typing away. The swatches are a radio group with one Tab stop, named after the field. It doesn't use the browser's own colour picker. In a `Field`, it takes the field's label, description and error |
| `Slider` | A value in a range, such as volume or zoom, on the native `<input type="range">`: `value` or `defaultValue`, `onValueChange`, `min`, `max`, `step` and `largeStep`. `formatValue` gives screen readers the value as text, such as "−6 dB". Arrow keys, Page Up and Down, Home and End work the same in every browser, mirrored in right-to-left text. In a `Toolbar`, it keeps the arrow keys, so put it last. `onValueCommit(value)` is called once when a gesture that changed the value ends: the pointer let go, the last key let go, however long it repeated, or focus leaving first. Use it for an undo step, and `onValueChange` for what follows the value as it moves |
| `AnnouncerProvider`, `useAnnounce` | Announcements for screen readers, such as "Saved 1.3 MB": `announce(message, { politeness })`. The provider renders the live regions once, on the server too |
| `useLatest` | A ref that holds the latest value of a prop, such as a callback, for an effect or an event handler that must call the newest version without re-subscribing. It updates during the commit, in an insertion effect, so a child's layout effect and a handler fired right after a commit both read the latest value, and it renders on the server without warnings. Use it instead of writing a ref while rendering, `latest.current = onChange`, which React's rules forbid ([sdk-core ADR 0063](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0063-a-lint-for-what-react-components-do-while-rendering.md)) |
| `usePlatform` | The platform for keyboard shortcuts: `"apple"` on macOS, iOS and iPadOS, where `Mod` is ⌘, otherwise `"other"`. It's `"other"` on the server and during hydration, then Apple devices switch right after, so hydration never mismatches. Pass it to sdk-core's `createShortcutRegistry({ platform })`, and never read `navigator` during render for this |
| `Tooltip` | Short text about a control, shown on hover and on keyboard focus; Escape closes it (WCAG 1.4.13). While it's open, the first Escape closes only the tooltip, so an editor's own Escape action, such as cancelling a crop, runs on the second press; Escape handlers should skip events with `defaultPrevented`. `type="label"` makes it an icon-only button's name, and `description`, the default, describes the button. `shortcut` takes sdk-core's `registry.describe(toolId)[0]`, shows it in the platform's notation (⌘⇧Z or Ctrl+Shift+Z) and sets `aria-keyshortcuts`. It's in the top layer, so no stacking context hides it. Disabled triggers need `focusableWhenDisabled` |
| `ReorderableList` and `ReorderableListItem` | A list whose items the user selects, reorders and removes, such as layers, tracks or pages: one Tab stop for the whole list, and room for `controls` in each row, such as a visibility toggle. ↑ and ↓ move between rows and select (with Ctrl or ⌘, without selecting), and the row whose item receives focus is selected however focus arrives, including Tab; ← and → move between a row's cells; Alt+↑ and Alt+↓ (Option on macOS) move the focused item through `onMove(id, toIndex)`; Delete and Backspace remove it through `onRemove(id)`. You own the order and render the result; focus stays with a moved item, and moves are announced through `AnnouncerProvider` unless `announceMoves` is `false`. **Also render buttons that move the selected item**, with `aria-keyshortcuts`, for touch and for people who don't know the keys. It's a WAI-ARIA grid ([ADR 0009](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0009-reorderable-list.md)) |
| `Timeline`, `TimelineLane`, `TimelineClips`, `TimelinePlayhead` and `TimelineLayer` | A timeline over whole units, such as frames or samples ([ADR 0011](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0011-timeline.md)): a scrolling track as wide as `length` at the current `zoom`, where 1 fits it to the width and `onMaxZoomChange` says where zooming stops. `TimelineClips` is the clip track, a horizontal listbox with one Tab stop: each clip is `{ key, length, label, content }`, as wide as its length; ← and → move between clips and select, and with `selectionMode="single"` the focused clip is selected however focus arrives, including Tab and `focusClip`; with `selectionMode="multiple"`, Shift extends, Ctrl or ⌘ moves without selecting, Space adds or removes, and Ctrl or ⌘+A selects all. Give each clip a `label` with its range, not its place: screen readers count a listbox's options themselves. Adding or removing a clip is announced through the closest `AnnouncerProvider`. `TimelinePlayhead` is a slider over the units with a line at its `position`; a press on the track moves it, snapping to the clips' boundaries and `snapTargets` within 8 px unless Alt is held, and `following` keeps it in view. `TimelineLayer` holds your own drawing, such as a waveform, and `useTimelineScale()` gives it the same mapping: `toPixels`, `unitAt`, `snap` and `visibleRange`. It formats no time: pass `formatValue` and the labels. **Editing is reported, not done:** `onMove(keys, direction)` for Alt+← and Alt+→ (Option on macOS), which the track always takes so the browser never goes back; `onTrim(key, edge, delta)` for Alt+`[` and Alt+`]` (with Shift, outward) and for dragging a clip's edge, which snaps, shows the new length as it goes and reports once on release; `onTrimToPlayhead(key, edge)` for `[` and `]`. Render the result. **Also render buttons that move and trim the selected clips**, with `aria-keyshortcuts`, and **offer zoom**: a clip narrower than 24 px is a small target, and zooming is how a pointer reaches it. **Several tracks are lanes:** wrap each track's layers and clips in a `TimelineLane` with an `id`, a `label` and a `header`, its controls, which the lane renders as a toolbar that stays in view as time scrolls. Lanes stack under one playhead; ↑ and ↓ on a clip go to the clip nearest in time on the next lane. **Give every lane's `TimelineClips` the same `selectedKeys`:** it's the timeline's selection, a plain choice replaces it on every lane, and adding or removing keeps the other lanes' clips. A layer written outside the lanes covers them all, and `useTimelineLanes()` tells it the lane under a pointer. **Lanes let presses through:** a press on a lane's empty space, or on a clip's body when `moveHandle="title"`, reaches a layer written *before* the lanes, under them, such as one that selects a range of time across tracks. A lane's own layers let presses through too, unless they're `interactive`. Draw what must show over the clips in a second layer, written after the lanes, that takes no presses. Below 720 px of the timeline's width, headers sit above their lanes. A timeline without lanes works as before. **Clips can have a start:** give every clip of a track `at`, in time order and without overlap, and each is placed there, with room wherever no clip is; give it to none, and they lie back to back. The two kinds share a timeline, a lane each, and every lane's clip edges are snap targets for all of them. When clips run past `length`, pass `extent`: the track is drawn that far, the playhead still ends at `length`, and those clips carry `data-hm-past-end` for you to dim. **Moving clips:** with `onDrop`, a clip is dragged with a mouse or pen, along time and to another lane, snapping its start or end to other clips; it's reported once, on release, as `{ by, lane }`, and `canDrop` lets you refuse a place, such as an overlap. Alt+↑ and Alt+↓ (Option on macOS) move clips to the lane above or below, through `onMoveLane`. `moveHandle="title"` makes only a clip's title the handle, so a press on the rest reaches a layer beneath, such as a range selection. **Also render buttons that move clips earlier, later and between lanes:** on a touch screen, they're the way to move a clip |

```tsx
import { Button, DownloadIcon, IconButton, RotateLeftIcon } from "@hussmartinez/ui/react";

<Button variant="primary" startIcon={<DownloadIcon />} onClick={save}>
  {messages.t("toolbar.download")}
</Button>
<IconButton label={messages.t("toolbar.rotate")} icon={<RotateLeftIcon />} onClick={rotate} />
```

Pass ui's icons, below, or any element that draws with `currentColor`. Each component costs a few hundred bytes minified and compressed, and a bundler drops the ones you don't import.

**On a static page,** such as an Astro component without a `client:` directive, `Tag`, `TagList` and `ButtonLink` are complete as rendered: they have no state and no handlers, so nothing needs hydrating. Your own unlayered CSS beats every `hm` layer, whatever its specificity, so a bare `a { color: … }` or `a { text-decoration: … }` rule restyles a `ButtonLink`. Scope such a rule to your own links, `a:not(.hm-button)`, or put it in a layer below `hm`.

**`Tabs` on a static page** is every panel under its heading, which is complete but isn't tabs. To get tabs, hydrate it: in Astro, put it in a `.tsx` component and give that a `client:` directive, such as `client:load`. The panels collapse to one when it hydrates, so hydrate early what's high on the page.

**In an `.astro` file,** Astro renders each React component on its own and hands a parent its children as markup, so components there share no React context. A `Tag` can't tell that it's inside a `TagList`: write `<Tag as="li">` for each, or compose the list in a `.tsx` component, where it works without `as`. For the same reason no `UiMessagesProvider` reaches a component there, so pass text props, such as `newTabHint`, in the page's language.

### Icons

ui has its own icon set, generated from [Lucide](https://lucide.dev) ([ADR 0005](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0005-icon-set.md)). Each icon is a component named after its use in the SDK family, such as `UndoIcon`, `RotateLeftIcon`, `PlayIcon` or `PageGridIcon`; the catalogue shows them all. Beside the editors' icons there are icons for pages, such as `ArrowRightIcon`, `ExternalLinkIcon`, `MailIcon`, `TimeIcon` and `TipIcon`. There are no brand marks or logos: draw your own with `currentColor`, and pass it wherever an icon goes.

```tsx
import { IconButton, RotateLeftIcon } from "@hussmartinez/ui/react";

<IconButton label={messages.t("toolbar.rotateLeft")} icon={<RotateLeftIcon />} />;
```

- **Size and colour:** icons draw with `currentColor` and size to `--hm-icon-size`; in a button's icon slot, the slot sets the size.
- **Accessibility:** icons are decorative and hidden from assistive technology, as they should be inside a labelled button. For an icon that means something on its own, pass `label`, from your message catalogue, and it becomes a named image.
- **Right to left:** icons that point along the reading direction, such as undo, redo and a link's arrow, mirror in right-to-left text.
- **Only what you import ships:** each icon is its own export, about 140 bytes compressed.
- **Icons by name:** tools refer to icons by their `IconName`, such as `"rotate-left"` (sdk-core ADR 0030). ui has no name-to-component registry, which would ship every icon, so map the names your tools use:

  ```tsx
  import type { IconComponent, IconName } from "@hussmartinez/ui/react";
  import { RotateLeftIcon, UndoIcon } from "@hussmartinez/ui/react";

  const toolIcons: Partial<Record<IconName, IconComponent>> = {
    undo: UndoIcon,
    "rotate-left": RotateLeftIcon,
  };
  ```

- **Licence:** Lucide's ISC licence, and the MIT licence of its icons derived from Feather, are in `THIRD_PARTY_NOTICES.md` in the package.

### Text

Components never contain inline text. Text props win; otherwise, components read `UiMessagesProvider`, which takes an sdk-core `Messages` object whose catalogue includes `uiMessages`:

```tsx
const messages = createMessages({ ...sdkCoreMessages, ...uiMessages, ...yourMessages }, { locale });

<UiMessagesProvider messages={messages}>
  <App />
</UiMessagesProvider>
```

## Using ui from an SDK

The `@hussmartinez` SDKs build their editors from ui's components, so an application using an SDK already has ui ([ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)).

- **One stylesheet, required.** Import `@hussmartinez/ui/styles.css` once, before the SDKs' stylesheets. The SDKs' stylesheets never include it, so it loads once however many SDKs you use. Don't leave it out: the focus rings and target sizes of the components inside an SDK live there.
- **One copy of ui.** Each `ui` copy has its own providers, so `UiMessagesProvider`, `ThemeProvider` and `AnnouncerProvider` from one copy don't reach components from another: their text falls back to English, and announcements are lost. If your application uses ui itself, depend on the same minor version as your SDKs; `npm ls @hussmartinez/ui` should list one version. In development, ui warns when a second copy is in use, and names the versions it found.
- **Providers once, at the root.** One `ThemeProvider` and `AnnouncerProvider` around your application reach ui's components inside every SDK too.
- **Text through the SDK's `messages`.** Inside an SDK, ui's own strings, such as `FileDropZone`'s "Choose a file" or `Dialog`'s "Close", come from the SDK's messages ([ADR 0046](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0046-ui-text-through-the-sdk.md)). Override or translate them through the SDK's `messages` prop, next to the SDK's own text: `{ "fileDropZone.choose": "Datei auswählen" }`. Your own `UiMessagesProvider` reaches only the ui components you render yourself.
- **Headless use.** An SDK's `.` entry never loads React or ui's React components; it may use ui's server-safe root entry, such as the `IconName` type. ui is installed with the SDK, but its `react` and `react-dom` peers are optional, so there are no peer warnings.

**For SDK authors:**

- **The dependency:** list ui in `dependencies` with a caret range on the current minor, such as `^0.4.0`, and import its components only from `features/`, `react/` and `element/`. `sdk-config`'s dependency-cruiser preset fails the build when the core, an adapter or a worker imports ui, or when anything the `.` entry reaches imports React or ui's React entry.
- **The catalogue:** spread `uiMessages` into your catalogue, next to `sdkCoreMessages`, and pass the one `Messages` object you create with the host's locale and overrides to `UiMessagesProvider` around everything you render. Don't create a second, ui-only object, or hosts can't translate ui's strings.

  ```ts
  export const myMessages = defineMessages({ ...sdkCoreMessages, ...uiMessages, ...ownMessages });
  ```

- **Key collisions:** keep a test that your own keys don't overlap `sdkCoreMessages` or `uiMessages`, so a later release can't silently replace your text. ui's keys use component names as prefixes, such as `dialog.` and `fileDropZone.`.
- **Heading levels:** an editor that renders headings takes `headingLevel?: HeadingLevel`, as below.

### Heading levels

An editor sits in a page whose outline belongs to the host, so it never picks its own heading levels ([sdk-core ADR 0058](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0058-heading-levels-in-editors.md)). An editor that renders headings takes `headingLevel?: HeadingLevel`, from `2` to `6` and `2` by default, on its React component as `headingLevel` and on its element as the `heading-level` attribute. It re-exports the `HeadingLevel` type from its React entry.

- **`toHeadingLevel(value)`,** from the root entry, turns a host's value into a level: a number, or an attribute's text such as `"3"`. Anything else is `2`, with a development warning.
- **`HeadingLevelProvider`** passes the level to the editor's own parts, and each `Heading` inside renders at it. **`nestedHeadingLevel(level)`,** from the root entry, gives the level one step down for nested headings, and never passes 6.
- **Dialogs keep their own outline:** a `Dialog`'s title is always an `<h2>`, and headings in its content start at 3, whatever the page's level.

```tsx
import { nestedHeadingLevel, toHeadingLevel } from "@hussmartinez/ui";
import { Heading, HeadingLevelProvider } from "@hussmartinez/ui/react";

<HeadingLevelProvider level={toHeadingLevel(headingLevel)}>
  <section aria-labelledby={titleId}>
    <Heading id={titleId}>{messages.t("inspector.title")}</Heading>
    <HeadingLevelProvider level={nestedHeadingLevel(toHeadingLevel(headingLevel))}>
      {details}
    </HeadingLevelProvider>
  </section>
</HeadingLevelProvider>
```

## Errors and messages

Errors are `UiError`s, subclasses of sdk-core's `SdkError`, with a stable `code` and `details`. `uiMessages` has English text for each code; spread it into your catalogue next to `sdkCoreMessages`:

```ts
import { createMessages, defineMessages, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";

const messages = createMessages(defineMessages({ ...sdkCoreMessages, ...uiMessages }));
messages.error(error); // "The theme setting color-accent has a value that can't be used."
```

## License

[Apache-2.0](https://github.com/ie-huss-martinez/ui/blob/main/LICENSE)
