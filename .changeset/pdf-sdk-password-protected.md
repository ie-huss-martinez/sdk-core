---
"@hussmartinez/pdf-sdk": patch
---

pdf-sdk opens password-protected PDFs. Everything is additive.

- **`session.open(file, { password })` and `session.insert(file, { password })`** open a file that needs a password, with its user or its owner password. `PdfEditor` asks for it in a dialog when it's missing, says when it's wrong, and lets the person try again or cancel; `handle.open` settles once they have.
- **One error code, two cases:** `PASSWORD_REQUIRED` with no `details.reason` when no password was given, and with `details.reason` `"incorrect-password"` (`PdfPasswordRejection`) when the one given is wrong. There's no new code, so an exhaustive `switch` over `PdfErrorCode` still compiles. The wrong password's text is the new key `errors.PASSWORD_REQUIRED.incorrect-password`.
- **Exports keep the password.** `session.export()` of a document that needed a password encrypts the result with AES-256, with the same password. `keepPassword: false` builds a document anyone can open, and `encrypt` still sets passwords of your own. The editor's download tool asks which, keeping the password unless the person chooses otherwise.
- **`passwordProtected`** in the session's snapshot says whether the open document needed a password, and **`restricted`** whether its encryption restricts printing, copying or changing it. **`session.exportsOriginal(options)`** says whether an export would be the opened file's own bytes or a built copy. A hand-written `PdfSessionSnapshot` or `PdfSession`, such as a test double, must add them.
- **Ports:** `PdfEngine.open` takes `password` in new `PdfEngineOpenOptions`, `PdfBuildSource` takes `password`, and a `PdfDocumentHandle` may report `restricted`. An engine or processor of your own keeps working, and refuses protected files as before until it honours them.
- **The password stays in memory,** with the open document, and is dropped when it closes or another replaces it. It's never in an event, an error, a snapshot or any storage.

Two changes for PDFs that already opened, those with only an owner password, which restrict printing or changes: a document built from one no longer carries its restrictions, where before that depended on the edit, and filling a form in one now works instead of failing. The editor's download tool says so before it saves such a copy.
