---
"@hussmartinez/sdk-config": minor
---

Add `hm-check-playwright-image`, which fails when a repository's Playwright can differ from its browser test image's (sdk-core ADR 0025). It reports each locked `playwright`, `playwright-core` or `@playwright/test` whose version isn't `ci/Dockerfile`'s tag, and each specifier for them that isn't that exact version, because a range such as `^1.65.0` drifts to 1.65.1 under a 1.65.0 image at the next install.

To adopt it:
- pin `playwright` and `@playwright/test` exactly to the image's version;
- add `"check:playwright-image": "hm-check-playwright-image"` to `verify` and `verify:fast`;
- delete your own `ci-image` test.

The sdk-config README has the Dependabot group that keeps the packages together.
