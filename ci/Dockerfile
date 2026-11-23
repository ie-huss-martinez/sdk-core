# The browser test image (ADR 0025): Playwright's, with the browsers and their
# system libraries preinstalled. CI's package jobs run in it, and
# verify.yml's image job reads it from the FROM line below, so this is its
# only copy (ADR 0064). Locally,
# sdk-config's hm-in-image and hm-test-visual build their image from the FROM
# line (ADR 0049). Dependabot proposes digest and tag updates. playwright and
# @playwright/test are pinned exactly to the tag's version and move with it in
# the same pull request; hm-check-playwright-image checks that (ADR 0025).
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
