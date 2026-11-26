import type { LearnIssue } from "../../core/errors/learn-issues.js";

/** A path inside a payload, as the editor's fields name it. */
export type IssuePath = readonly (string | number)[];

const same = (a: IssuePath, b: IssuePath) =>
  a.length === b.length && a.every((part, index) => part === b[index]);

/**
 * The issues of one exercise, with paths relative to it: `["payload", …]`,
 * `["title"]` and so on, from the draft's `["exercises", index, …]`.
 */
export function issuesOfExercise(issues: readonly LearnIssue[], index: number): LearnIssue[] {
  return issues
    .filter((issue) => issue.path[0] === "exercises" && issue.path[1] === index)
    .map((issue) => ({ ...issue, path: issue.path.slice(2) }));
}

/** The issues under a prefix, with the prefix taken off their paths. */
export function issuesUnder(issues: readonly LearnIssue[], prefix: IssuePath): LearnIssue[] {
  return issues
    .filter((issue) => prefix.every((part, index) => issue.path[index] === part))
    .map((issue) => ({ ...issue, path: issue.path.slice(prefix.length) }));
}

/** The first issue at exactly this path, which a field shows as its error. */
export function issueAt(issues: readonly LearnIssue[], path: IssuePath): LearnIssue | undefined {
  return issues.find((issue) => same(issue.path, path));
}

/**
 * The issues no field claims: shown in a list at the top of the exercise, so
 * none is hidden (ADR 0008).
 */
export function unclaimed(
  issues: readonly LearnIssue[],
  claimed: readonly IssuePath[],
): LearnIssue[] {
  return issues.filter((issue) => !claimed.some((path) => same(issue.path, path)));
}
