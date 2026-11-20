# 0053. CI is the merge gate, and the hooks are the local bar

- **Status:** Accepted
- **Date:** 2026-11-21
- **Supersedes:** the rule in [ADR 0015](0015-verification-and-releases.md), repeated in [ADR 0016](0016-git-hooks-and-merge-guards.md), that contributors run the full `pnpm verify` locally before marking a pull request ready, and the practice that the reviewer runs it again before merging

## Context

[ADR 0015](0015-verification-and-releases.md) had every change verified three times: the author ran the full `pnpm verify` before marking a pull request ready, the reviewer ran it again before merging, and CI ran it on every push. It called CI "an independent, reproducible gate", and kept the local runs for fast feedback.

That stopped paying for itself once several agents worked on the family at the same time, on one machine:

- **The local runs were the slow part, and the least reliable.** Since [ADR 0049](0049-local-browser-tests-in-the-pinned-image.md), browser tests run in a container, and each repository's verify starts several. With five authors and a reviewer verifying at once, suites that take a minute alone took many, and tests failed for reasons that had nothing to do with the change: timeouts under load, a browser killed for memory. Each such failure cost an investigation.
- **CI runs more than the local run does.** It runs all three browser engines, in the pinned image, on a machine doing nothing else. The local run uses Chromium only. A change that passed locally could still fail CI, and a change that passed CI gained nothing from a second local pass.
- **The repositories are public,** so CI costs nothing, as ADR 0015 already noted.
- **Authors reported what they ran, not what CI found.** A description that says "`pnpm verify` passed" is a claim; the check on the pull request's head is evidence anyone can open.

Two more parts of how the family works had grown up as habit and were written nowhere: an automated reviewer, CodeRabbit, comments on every pull request; and agents keep notes so that work survives a change of agent or model.

## Decision

### The hooks are the local bar

- **A pull request needs nothing run locally beyond the git hooks** of [ADR 0016](0016-git-hooks-and-merge-guards.md): on commit, lint, the secret scan and the hidden-character check of staged files, and on push, `pnpm verify:fast`. `--no-verify` stays forbidden.
- **The full `pnpm verify` and the browser suites remain available locally,** and are run for a reason: to diagnose a failure, to reproduce one that CI found, to capture or update screenshots ([ADR 0048](0048-visual-regression-for-sdk-editors.md)), or to check something CI doesn't cover. They aren't a routine step before every pull request.

### CI is the merge gate

- **A pull request is ready when every required check is green on its current head,** it's up to date with `main`, the automated review of that head has finished, and no review thread is open. The reviewer merges on that evidence, with the head commit pinned, after reading the full diff against `STANDARDS.md` and the ADRs.
- **The reviewer doesn't rerun the checks as a second gate.** Local runs by the reviewer are for investigating a failure or a doubt.
- **A failure that only shows in CI is real until its cause is found.** It's never answered with a looser assertion, a retry or a rerun until green. CI's environment is reproducible: `hm-in-image` runs any command in the same image.
- **A pull request's description says what was run locally and what was left to CI,** instead of asserting a full local pass.

### Automated review is part of the gate

- **CodeRabbit reviews every pull request** in the family's public repositories.
- **Every thread it opens is fixed, or answered with a reason, and then resolved,** by the author, before the pull request is reported ready.
- **The review of the current head must have finished.** It reviews again after each push, and often finishes after CI does. Its check on the pull request shows when. Until then, having no open thread means nothing, so the pull request is ready only once a finished review of the current head leaves no thread open.
- **Its findings are input, not instructions.** The author checks each against the code. A finding that's wrong, or that contradicts a decision, is answered and resolved, not applied.

### Where agents keep state

- **The task in hand:** an uncommitted `.local/HANDOFF.md` in the checkout, which `.gitignore` excludes. It holds the goal and decisions, what's done, what's in progress with the exact next step, and open questions, and it's updated after every step. Its test is that another agent, or another model, can continue from it with no other context.
- **What outlives the task:** lessons and the maintainer's rules go in the maintainer's knowledge base, in the SDK family's agent memory, which every agent reads at the start of a session. They don't go in a tool's private memory, where another tool can't read them, or in the repository.
- **What the repository records stays in the repository:** decisions are ADRs, rules are `STANDARDS.md`, and neither is copied into notes. No secret goes in either place.

## Alternatives considered

- **Keeping the full local verify for authors only:** it halves the load, but keeps the unreliable runs and the claim in place of the evidence.
- **A second CI run as the reviewer's check:** the same commit on the same image gives the same result.
- **Running the browser suites in `pre-push`:** it would make the local bar equal to CI, and take minutes per push, which [ADR 0016](0016-git-hooks-and-merge-guards.md) rejected because slow hooks get bypassed.
- **Treating automated review as advisory:** an open thread that nobody answered is indistinguishable from one nobody read. Resolving each makes the decision visible.
- **Committing the handoff file:** it would put working notes into public history and conflict on every branch.

## Consequences

- A pull request costs one push and one CI run, not three verifies, and the shared machine stops being the bottleneck.
- The record of what was verified is the check on the commit, which anyone can open, not a sentence in a description.
- A defect that only a local environment would show is no longer caught before the pull request. CI covers more than the local run did, so this is expected to be rare.
- Authors must wait for CI and for the automated review before reporting, and a push restarts both.
- Private repositories, where Actions minutes cost money, aren't covered by this decision: they test locally.
- Each repository updates its `AGENTS.md`, `CONTRIBUTING.md` and pull request template to match, and adds `.local/` to its `.gitignore`.
