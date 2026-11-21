# 0062. Fonts in browser tests

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0048](0048-visual-regression-for-sdk-editors.md) and [ADR 0025](0025-one-browser-test-image-in-one-place.md), by saying which fonts the browser test image renders the family's text with

## Context

[ADR 0048](0048-visual-regression-for-sdk-editors.md) compares screenshots taken in the pinned browser test image, "whose fonts, font rendering and Chromium build are pinned by digest". The fonts are pinned, but they aren't the right ones.

`ui`'s text uses the system's interface font:

```css
--hm-font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

In the image, `system-ui` resolves to WenQuanYi Zen Hei, a Chinese font the image has for coverage. It has one style. So every label in every baseline is drawn in a font no user of a Latin-script interface sees, and in Chromium, where screenshots are taken, text at `--hm-font-weight-strong`, 600, comes out as the same pixels as regular text.

### What the image does

`fc-match`, in `mcr.microsoft.com/playwright:v1.65.0-noble`:

| Asked for | Resolves to |
|---|---|
| `system-ui`, `sans-serif`, `Segoe UI`, `Roboto`, `Helvetica Neue` | WenQuanYi Zen Hei, Regular |
| `monospace` | WenQuanYi Zen Hei Mono, Regular |
| `Arial`, `Helvetica` | Liberation Sans, Regular |

The image has 20 font families. Liberation Sans, Serif and Mono are among them, each in four styles: regular, bold, italic and bold italic.

What the browsers then draw, for one line of text in `ui`'s sans stack at 14 px. Chromium names the font through its DevTools protocol; the other engines don't, so their line's width stands in for it:

| Engine | Weight 400 | Weight 600 |
|---|---|---|
| Chromium | WenQuanYi Zen Hei, 128.94 px | WenQuanYi Zen Hei, 128.94 px |
| Firefox | 128.93 px | 134.60 px, a synthesised bold |
| WebKit | 128.93 px | 128.93 px, a synthesised bold of the same width |

Screenshots of the same line at each weight, compared as files, say what the widths can't:

| Engine | 400 and 600 | 400 and 500 | 600 and 700 |
|---|---|---|---|
| Chromium | the same pixels | the same | the same |
| Firefox | different | the same | the same |
| WebKit | different | the same | the same |

- **Chromium draws strong text as the same pixels as regular text,** at every weight. Screenshots are taken in Chromium only ([ADR 0048](0048-visual-regression-for-sdk-editors.md)), so a regression that drops a label's weight can't show in one.
- **Firefox and WebKit thicken the one face they have.** Firefox also widens it; WebKit doesn't. So the three engines lay the same strong text out at two different widths, and draw it three different ways.
- **`ui`'s monospace stack is fine:** it names Liberation Mono, which the image has.
- **Nothing in the stack before `Arial` exists in the image,** and `system-ui` matches first.

### The constraint

CI's jobs run in Microsoft's image as it is. `ci/Dockerfile` holds one `FROM` line, and `sdk-ci`'s image action refuses anything else ([ADR 0025](0025-one-browser-test-image-in-one-place.md), [ADR 0026](0026-share-ci-steps-from-sdk-ci.md)). Locally, `hm-in-image` builds on that same line ([ADR 0049](0049-local-browser-tests-in-the-pinned-image.md)). A fix inside the image would mean building and publishing an image of the family's own, and every repository's CI pulling it.

## Options

| | Option | In short |
|---|---|---|
| A | Leave it | Baselines stay in a font with one weight |
| **B** | **A fontconfig file, passed to the browser when it launches** | **The presets set it. No image change. Chosen** |
| C | The family's own image, with fonts installed | A published image to build, sign and keep up to date |
| D | A web font injected by the tests | Tests render a font the components never ask for |
| E | `ui` names a font the image has, ahead of `system-ui` | Changes what users see, to fix what tests see |

### B, probed

Browsers on Linux ask fontconfig which font a family name means, and fontconfig reads its rules from the file `FONTCONFIG_FILE` names. A file that includes the system's rules and then prefers Liberation Sans for `system-ui` and `sans-serif` changes only those answers.

Passed in the browser's launch environment, in the pinned image, for the same line of text:

| Engine | Weight 400 | Weight 600 |
|---|---|---|
| Chromium | Liberation Sans, 127.64 px | Liberation Sans Bold, 136.94 px |
| Firefox | 127.58 px | 136.90 px |
| WebKit | 127.63 px | 136.94 px |

All three engines take it, and the strong weight gets a real bold face. The three engines' widths also agree within 0.06 px, where today Firefox differs from the other two by about 5.7 px at weight 600.

## Decision

**Option B: a fontconfig file, for every browser the presets launch in the image.**

- **`sdk-config` ships a fontconfig file.** It includes the system's configuration, and prefers:
  - Liberation Sans for `system-ui` and `sans-serif`;
  - Liberation Serif for `serif`;
  - Liberation Mono for `monospace` and `ui-monospace`.
- **The presets pass it to every browser they launch,** as `FONTCONFIG_FILE` in the launch environment:
  - `defineVisualConfig`, for screenshots;
  - `browserInstances`, for Vitest's browser projects;
  - a helper for an SDK's own Playwright configuration, for its end-to-end suite.
- **A configuration that launches browsers its own way gets the same environment from the same place.** `sdk-config` exports the launch environment, as an object to pass as `launchOptions.env`, and the file's path. The object is a whole environment, the process's own with the file added: Playwright replaces a browser's environment with `launchOptions.env` rather than adding to it, so an object with only the one variable would take `DISPLAY` and everything else away from the browser. `ui`'s Vitest browser configuration and its catalogue's test runner don't go through the presets, so they use that export. No repository writes the variable's name or the file's path itself.

  So a layout assertion, an end-to-end test and a screenshot all see the same text.
- **Liberation Sans, Serif and Mono, because the image already has them,** in four styles, so the family ships no font and takes on no font's licence. They're metric-compatible with Arial, Times New Roman and Courier New. Arial is the last named font in `ui`'s stack, and what a system without the others would use.
- **The image doesn't change.** `ci/Dockerfile` keeps its one `FROM` line, and CI and local runs stay the same by construction: the font rules travel with the preset, not with the machine.
- **A test in `sdk-config` holds it:** in Chromium, text in `ui`'s stack is drawn in Liberation Sans, and at weight 600 in its bold face.
- **Only in the image.** The launch environment carries the file where `HM_VISUAL_CONTAINER=1`, which is the image locally and in CI's jobs ([ADR 0049](0049-local-browser-tests-in-the-pinned-image.md)). Anywhere else it's the process's own environment, unchanged, so a browser started on a developer's machine, with the bypass for debugging, keeps that machine's own font configuration, including a `FONTCONFIG_FILE` of its own. A run outside the image proves nothing about a change anyway.

### What it doesn't fix

- **Weights between regular and bold.** Liberation has two weights, so 400 and 500 draw alike, in the regular face, and 600 and 700 draw alike, in the bold one. That's how CSS picks a face, and the screenshots with the file confirm it in all three engines. `ui` uses 400 and 600 today, which differ.
- **It isn't what users see either.** Users get their system's interface font. Screenshots prove layout and regressions, in one fixed font with real weights, not the look on any one platform.

### Adoption

- **A minor release of `sdk-config`:** taking it changes every screenshot with text in it, so it turns a consumer's visual check red until the baselines are retaken.
- **Each repository retakes its baselines in the pull request that takes the release,** with `pnpm test:visual:update`, and says in it that the font is the cause. A reviewer should see text change everywhere. Other things may move too, where a label got wider or narrower, or now wraps and pushes what's below it: the pull request explains each such move by the font, and anything it can't explain that way is a real difference.
- **`ui` goes first,** since its catalogue has the most text and its own comparator. Then each SDK, in its own adoption pull request, with its retaken baselines explained by this one cause.

## Alternatives considered

- **A, leaving it:** the baselines are stable today. They're stable in a font where Chromium draws strong and regular text as the same pixels, so they can't catch a lost weight, and Firefox's layout differs from the other engines' for a reason that has nothing to do with the code under test.
- **C, the family's own image:** it would fix fonts for any tool, not only the browsers the presets launch. It also means building, publishing and patching an image, a registry to trust in every repository's CI, and dropping the rule that the image is Microsoft's, pinned by digest, in one line. That's a large change for a problem a file solves.
- **D, a web font injected by the tests:** fully deterministic, on any image. But the page under test would then differ from the page that ships: another font request, another `@font-face`, and components measured in a font their styles never name.
- **E, changing `ui`'s stack:** naming Liberation Sans or Arial ahead of `system-ui` would fix the image and change the interface font on every Linux desktop and every system that has Arial.
- **Installing fonts in `hm-in-image`'s local image only:** local and CI screenshots would differ, which is the one thing [ADR 0049](0049-local-browser-tests-in-the-pinned-image.md) exists to prevent.

## Consequences

- Strong text is drawn bold in baselines, and the three engines lay text out alike.
- **Every baseline with text is retaken, once, in every repository.** Until a repository does, it stays on its current `sdk-config` minor.
- A browser launched outside the presets, such as one a repository's own script starts, still gets the image's default. The helper is there for those.
- If Microsoft's image drops Liberation, the preference falls through silently to another font. The test in `sdk-config` fails on the image bump that does it.
