# The browser test image (ADR 0025): Playwright's, with the browsers and their
# system libraries preinstalled. CI's verify jobs, in verify.yml and
# release.yml, run in it; both read it from the FROM line below, through
# sdk-ci's image action (ADR 0026), so this is its only copy. Locally,
# sdk-config's hm-in-image and hm-test-visual build their image from the FROM
# line (ADR 0049). Dependabot proposes digest and tag updates. playwright and
# @playwright/test are pinned exactly to the tag's version and move with it in
# the same pull request; hm-check-playwright-image checks that (ADR 0025).
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:9beb546099e11f52d62e505537914870e01a67e0e6b00ae41da4775324e73dbe
