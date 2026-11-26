import type { ReactNode } from "react";
import type { LearnIssue } from "../../core/errors/learn-issues.js";
import { issueText } from "./EditorField.js";
import type { LearnEditorMessages } from "./editor-messages.js";

/**
 * Problems no field on screen shows, listed so none is hidden (ADR 0008).
 * Renders nothing when there are none.
 */
export function IssueList({
  issues,
  messages,
}: {
  readonly issues: readonly LearnIssue[];
  readonly messages: LearnEditorMessages;
}): ReactNode {
  if (issues.length === 0) return null;
  return (
    <div className="hm-learn-editor-issues">
      <p className="hm-learn-editor-issues-title">{messages.t("editor.problemsHeading")}</p>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.path.join(".")}:${issue.code}`}>{issueText(messages, issue)}</li>
        ))}
      </ul>
    </div>
  );
}
