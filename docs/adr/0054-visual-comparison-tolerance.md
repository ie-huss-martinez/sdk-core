# 0054. How strictly screenshots are compared

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0048](0048-visual-regression-for-sdk-editors.md)'s "no tolerance by default", by setting the per-pixel threshold that rule left at Playwright's default, and by making an update rewrite only the baselines that changed

## Context

[ADR 0048](0048-visual-regression-for-sdk-editors.md) decided that visual tests have no tolerance: "any tolerance hides real changes, such as a 1 px border that moved". `sdk-config`'s preset implements that as `maxDiffPixelRatio: 0`, meaning no pixel may differ.

That setting says how many pixels may differ. A second setting says when a pixel counts as different, and the preset leaves it at Playwright's default: `threshold: 0.2`. Playwright compares with pixelmatch, which measures colour distance in YIQ space and counts a pixel only when the distance exceeds `35215 × threshold²`. So the preset allows no differing pixels, under a definition of "differing" that is far from zero.

Two more facts shape the decision, and both were measured for this record.

### What the default threshold lets through

Measured with Playwright 1.65.0's own comparator, on synthetic images, with `maxDiffPixelRatio: 0`:

| Change between baseline and screenshot | Counted at `threshold` 0.2 | Counted at 0 |
|---|---|---|
| A whole grey surface shifts by up to 52/255 per channel | 0 pixels | all |
| A whole surface changes from `#2563eb` to `#3b82f6` | 0 pixels | all |
| Text-like block changes from `#000` to `rgb(52,52,52)` | 0 pixels | all |
| A 1 px border of `#e2e8f0` on white moves by 1 px | 0 pixels | all |
| A 1 px border of `rgb(200,200,200)` on white moves by 1 px | all | all |

The fourth row is the example ADR 0048 gives for what tolerance must not hide, with a light border colour. Today it passes.

### How much a re-captured screenshot differs from itself

A threshold of exactly 0 is only safe if the same page always renders to the same pixels. It doesn't quite. Every committed baseline in the family was compared with the version before it in git history, 1,090 pairs, read-only:

| Repository | Baselines | Pairs | Resized | Differ by at most 1/255 | Differ on a few pixels by up to 16/255 | Larger changes |
|---|---|---|---|---|---|---|
| audio-sdk | 64 | 40 | 0 | 0 | 0 | 40 |
| image-sdk | 108 | 460 | 0 | 3 | 3 | 454 |
| video-sdk | 32 | 194 | 0 | 14 | 0 | 180 |
| pdf-sdk | 44 | 140 | 0 | 0 | 0 | 140 |
| ui | 582 | 256 | 84 | 0 | 4 | 168 |
| **Total** | **830** | **1,090** | **84** | **17** | **7** | **982** |

- **The 17 pairs that differ by at most 1/255** differ on 7 to 91 pixels, at anti-aliased edges. They came with commits that changed other screenshots on purpose, such as image-sdk's `2444883` and video-sdk's `14febe2`, where an update re-captured every baseline. They're the same page rendered twice.
- **The 7 pairs in the next column** are three of image-sdk's crop screenshots, which show a decoded image (52 to 65 pixels, nearly all by 1/255, and one to four pixels by up to 16/255), and four of `ui`'s, with a single pixel each.
- **audio-sdk measured the same directly** on 2026-11-18: re-capturing 40 baselines in the pinned image moved 4 of them, by 2 to 32 pixels, with a largest channel difference of 1/255.

So the pinned image renders almost identically, not identically. The cause hasn't been found.

How Playwright's comparator judges those 24 pairs, with no differing pixel allowed:

| `threshold` | Of the 17 that differ by at most 1/255 | Of the other 7 |
|---|---|---|
| 0 | 10 pass, 7 fail | 5 pass, 2 fail |
| 0.0038 | 17 pass | 7 pass |
| 0.2 | 17 pass | 7 pass |

At 0, nine re-captures of an unchanged page would have failed a test. At 0.0038, none would.

### What Playwright never counts

Playwright calls pixelmatch with `includeAA: false`, and doesn't expose that option. Pixels that pixelmatch classifies as anti-aliasing are left out at every threshold. Measured: a dark rectangle with a one-pixel grey edge all round, whose 244 edge pixels change from 128 to 255, has 8 pixels counted, at threshold 0 as at 0.2. In the history above, 2 of `ui`'s 168 larger baseline changes count no pixels at threshold 0.

That's why some of the 1/255 pairs pass even at 0, and it means no threshold makes Playwright's comparison exact.

### What an update rewrites

`hm-test-visual --update` moves the baselines aside and captures every one afresh. The 17 pairs above are the result: files in a pull request that differ from `main` only by noise, first noticed in [image-sdk#41](https://github.com/ie-huss-martinez/image-sdk/pull/41). A reviewer is asked to look at every changed image (ADR 0048), and can't tell those from a real change without tooling.

## Options

**A. Leave the threshold at 0.2.** No work. The table above shows what it lets through, including the case ADR 0048 names.

**B. `threshold: 0`.** The strictest setting Playwright has. Nine of the 24 noise pairs would have failed, so tests would fail at random on unchanged pages, and each failure is investigated before anyone sees it's noise. Anti-aliased pixels are still not counted.

**C. `threshold: 0.0038`, with no differing pixel allowed.** The smallest threshold at which a difference of 1/255 on every channel isn't counted (`35215 × 0.0038² = 0.5085`, and that difference measures 0.5053). A difference of 2/255 on every channel is counted (2.02). All 24 noise pairs pass, and every row of the first table is caught.
- **What it still lets through,** measured: a difference of 1/255 on any channel or any mix of them, and 2/255 on blue alone, because pixelmatch's distance is perceptual, not per channel, and the eye is least sensitive to blue. Blue alone at 3/255, and red or green alone at 2/255, are counted. And anti-aliased pixels, as in every option that uses Playwright's comparison.

**D. Our own comparator: exact, per channel, with no anti-aliasing exception.** `sdk-config` would compare pixels itself, with a largest difference of 1 per channel, and count edges like any other pixel. It's the only option that is exact.
- **Cost:** it replaces `toHaveScreenshot`, which also waits for the page to stop changing, writes the expected, actual and diff images that CI uploads, and manages baselines and their update. All of that would be rebuilt or wrapped.
- **It doesn't pass today's noise either:** the three crop screenshots differ by up to 16/255 on a few pixels, which only Playwright's anti-aliasing exception hides. They'd need a mask or a per-state tolerance first.

**E. Make rendering deterministic, then use `threshold: 0`.** Find what makes two captures differ (rasterisation threads, GPU or software paths, font hinting are candidates) and pin it with Chromium flags.
- **Unknown:** whether such a setting exists, and whether it would also change what the screenshots look like, which would retake every baseline. It needs repeated captures in the image, in every repository, to measure. It doesn't remove the anti-aliasing exception.

## Decision

**Option C: a threshold of 0.0038, with no differing pixel allowed, and an update that keeps unchanged baselines.**

- **The preset sets `threshold: 0.0038`** beside `maxDiffPixelRatio: 0`: a pixel counts as changed from the smallest difference above one level per channel, and no changed pixel is allowed. That's what ADR 0048's "no tolerance" can mean on a renderer that differs from itself by one level.
- **The number is written as a literal,** with its derivation in a comment beside it.
- **A test is its specification.** It runs Playwright's comparison on small generated images, and asserts that a difference of 1/255 on every channel passes, while 2/255 on every channel, a colour token one step apart, and a light 1 px border moved by 1 px all fail. An upgrade of Playwright that changes its comparison then fails `sdk-config`'s tests, not an SDK's baselines.
- **The threshold isn't raised to make a test pass.** A capture that differs by more than this is a finding: a real change, or nondeterminism to remove at its source or mask ([ADR 0048](0048-visual-regression-for-sdk-editors.md)'s masks and its per-state allowance for codec frames are unchanged).
- **An update keeps every committed baseline that its own assertion still accepts.** "Accepts" means what it means in a test run: Playwright's comparison with that assertion's effective settings, the preset's or, for a codec frame, the state's own allowance. A re-capture the test would pass leaves the repository unchanged, so every image in a pull request's diff is one its test calls different.
- **An update never writes an unstable capture.** A state whose consecutive screenshots don't settle fails the update, as it fails a test, and the previous baselines are restored.
- **An update still removes stale baselines,** those no state produces any more.
- **An update is all or nothing.** The committed baselines change only once every pass below has finished and passed. If a pass fails, or the update is cancelled or stopped part-way, the baselines are exactly as they were before it started; an update that finds a previous one's leftovers restores them first. Stale baselines are removed only at the end, never because a pass didn't reach a state.
- **How, in three passes over the suite,** each of which takes seconds:
  1. **What changed:** with the committed baselines in place, Playwright decides, assertion by assertion, which ones the new capture no longer matches.
  2. **Fresh captures:** with the baselines moved aside, as today, every state is captured afresh, which must be stable, and shows which baselines are still produced.
  3. **Proof:** the result is assembled, the fresh capture for each baseline the first pass rejected or that is new, the committed file for every other baseline still produced, and nothing for the rest, and the suite runs once more against it, as a plain test run. It must pass.

  The third pass is what makes the result trustworthy: whatever the page did between the first two, the baselines that get committed are ones a test run has just accepted. If it fails, a state renders differently from one run to the next by more than its assertion allows, which is a finding, and the update fails without changing anything.
- **A known limit that no threshold fixes: anti-aliased pixels aren't compared.** Playwright leaves out every pixel its comparison classifies as anti-aliasing, at any threshold, and offers no setting for it. So a change confined to edge pixels, such as a slightly different rasterisation of text or of a rounded corner, can pass these tests. It's accepted, because closing it means replacing Playwright's comparison (option D). If such a change is ever missed in practice, that's the next step, in a record that supersedes this one.
- **Deterministic rendering (option E) isn't pursued now.** It's a possible later step, if the noise ever grows beyond one level. Measuring it would take capturing every baseline many times in the browser test image, in each repository, under each candidate Chromium setting, and comparing the captures with each other: repeated heavy runs, which today's noise doesn't justify. If rendering were made deterministic, the threshold would drop to 0 in a later record.

### Adoption

- **The change ships as a minor release of `sdk-config`,** because it can fail an SDK's existing tests.
- **Each SDK adopts it in a pull request of its own.** A baseline that passes today at 0.2 either passes at 0.0038, or was hiding a difference. The first run after the update shows which, and the adoption pull request settles each one: it fixes what the difference revealed, or re-captures the baseline when the committed one was simply out of date.

## Alternatives considered

Beyond the options above:

- **`threshold: 0` with a few differing pixels allowed,** such as `maxDiffPixels: 100`: it absorbs the noise by count, not by size, so a 10 × 10 icon could change completely. The noise is small in size and unpredictable in count, which is the opposite shape.
- **Playwright's other comparator, `ssim-cie94`:** it's reached through an underscore-prefixed, undocumented option, so it can change or go without notice. It wasn't measured for this record.
- **Playwright's `--update-snapshots=changed` alone for the update:** it looks like exactly the wanted mode, but with a baseline in place it writes the last capture and passes even when consecutive captures never matched each other, where a capture without a baseline must be stable (read in Playwright 1.65.0's `toHaveScreenshot` and `expectScreenshot`). It would commit a baseline from a page that hadn't settled, silently, and it leaves stale baselines behind. It's used only as the first pass above, to decide what changed; what gets written comes from the second.
- **Comparing the new and committed files afterwards, with the preset's settings:** simpler, but it would ignore a state's own allowance, and rewrite a codec frame's baseline that its test accepts.
- **Retrying a failed comparison:** it would pass noise eventually, and pass a real difference never, at the cost of a slower and less honest test.

## Consequences

- A token one step off, a light border one pixel off, and a text colour a few shades off all fail, which they don't today.
- Re-captured baselines stop appearing in pull requests unless they changed by more than one level, so reviewers see only real image changes.
- Tightening may fail some SDK's current baselines on the first run. Each such failure is a difference that 0.2 was hiding.
- The comparison is still not exact: anti-aliased edges, and a blue-only difference of 2/255, pass. Both are recorded here, with what would close them.
- The number is odd-looking. Its derivation is above, and a test holds it to its meaning.
