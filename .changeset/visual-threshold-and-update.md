---
"@hussmartinez/sdk-config": minor
---

Compare screenshots strictly, and keep unchanged baselines when updating (sdk-core ADR 0054). This is a minor release because it can fail visual tests that pass today: take it in a pull request of its own.

**The visual preset now sets `threshold: 0.0038`** beside `maxDiffPixelRatio: 0`, exported as `visualComparison`. Until now it left Playwright's default threshold of 0.2, under which a colour token one step apart, text a few shades lighter, or a light border moved by a pixel counted as no difference at all. Now a pixel differs from the smallest difference above one level (1/255) per channel, which is the noise the browser test image shows between two captures of the same page.

**What to expect when you update:** run `pnpm test:visual`. Every failure is a difference the old threshold was hiding. For each one, look at the diff image in `e2e/test-results/visual/`:

- if it shows a mistake in the code, fix it;
- if the committed baseline is simply out of date, run `pnpm test:visual:update` and commit the new image.

Don't raise the threshold, and don't add `maxDiffPixelRatio` to a state, to get past a failure. Content that really varies is masked, as before.

**`hm-test-visual --update` now rewrites only the baselines that changed.** It used to capture every baseline afresh, so pull requests carried images that differed from `main` only by rendering noise. Now a baseline its own assertion still accepts is kept byte for byte, new states are added and stale baselines removed, as before. It runs the suite three times and is all or nothing: if a state never settles, or the result doesn't pass a plain run, the baselines are left exactly as they were. Nothing changes in how you call it.

**A known limit, unchanged:** Playwright doesn't compare pixels it classifies as anti-aliasing, so a change confined to the edges of text or of a rounded corner can still pass.
