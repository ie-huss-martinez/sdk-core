# 0013. Password-protected PDFs: opening them, and what an export keeps

- **Status:** Accepted
- **Date:** 2026-11-27
- **Builds on:** [ADR 0001](0001-pdf-engines.md) (pdf.js views, qpdf transforms and encrypts) and [ADR 0003](0003-page-plan-document-model.md) (bytes are built on export); in sdk-core, [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md) (hostile input, and nothing private in events), [ADR 0014](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0014-accessibility-and-translatable-text.md) (dialogs and announcements) and [ADR 0050](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0050-error-text-by-reason-and-warning-text.md) (one code, several reasons)
- **Refines:** [ADR 0009](0009-saving-the-document.md): the download tool asks one question before it saves, for a document that needed a password

## Context

The SDK recognises an encrypted PDF and refuses it with `PASSWORD_REQUIRED`, in the engine and in the processor. Nothing takes a password, so the editor can only say "This PDF is protected with a password", and the person has to remove the password with another tool, often an upload to a website, which is what a client-side editor exists to avoid.

Both engines already read encrypted files: pdf.js takes a password when it opens a document, and qpdf takes one for each input. The processor already encrypts its output with AES-256 ([ADR 0001](0001-pdf-engines.md)).

PDF encryption comes in two kinds, which need different answers:

- **A user password:** the file can't be read without it. The standard also gives every such file an owner password, which opens it too.
- **An owner password only:** the file opens for anyone, encrypted with an empty user password, and carries permission flags, such as "no printing" or "no changes". The flags are a request to the reader's software; nothing in the file enforces them. These files already open in the editor.

A password is the most sensitive thing the SDK is handed. The family's rules for file names and contents, never in events and never logged ([sdk-core ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md)), apply to it with more force, and it must also stay out of errors, which hosts send to their error reporting.

## Decision

### Giving the password

- **`session.open(file, { password })` and `session.insert(file, { password })`** take the password, and the editor's `handle.open` passes it on. An empty string is no password.
- **`PdfEngine.open(source, { password })`:** the engine port takes it in new `PdfEngineOpenOptions`. The pdf.js adapter gives it to pdf.js when pdf.js asks for one, through the loading task's `onPassword`, and declines a second request, which means the password was wrong.
- **`PdfBuildSource.password`:** the processor port takes one for each source. The qpdf adapter reads the source with it (`--password`), after trying without.
- **Both ports use a password only for a file that needs one.** pdf.js and qpdf, handed a password up front, try it on a file with only an owner password too, and refuse the file when it isn't that owner password. The adapters avoid that, and the contract tests check it.
- **Either password opens the file:** the user password or the owner password, as in every PDF reader.
- **The session knows whether the file needed it.** It opens the file without the password first, and tries the password only when that fails with `PASSWORD_REQUIRED`. So a password given for a file that opens without one is never kept and never protects an export. The first attempt fails as soon as the engine reads the file's encryption dictionary, so it costs a copy of the bytes, not a parse.

### Two failures, one code

| The file needs a password, and | Error |
|---|---|
| none was given | `PASSWORD_REQUIRED`, with no `details.reason` |
| the one given is wrong | `PASSWORD_REQUIRED`, with `details.reason` `"incorrect-password"` (`PdfPasswordRejection`) |

- **A reason, not a second code,** as sdk-core ADR 0050 decides for the family: a host does the same thing in both cases, which is to ask for the password and open the file again, and only the sentence differs. One check, `isPdfError(error, "PASSWORD_REQUIRED")`, drives a prompt that repeats until the password is right. A host that looks at nothing else still works; with a `PASSWORD_INCORRECT` code, the same host would show a wrong password as an unknown failure.
- **No new code,** so a host's exhaustive `switch` over `PdfErrorCode` still compiles.
- **Text:** `messages.error()` gives "That password didn't open this PDF." for the reason, from the new key `errors.PASSWORD_REQUIRED.incorrect-password`, and the code's own text otherwise.
- **pdf.js** says which it is with `PasswordException.code`, its `PasswordResponses`: `NEED_PASSWORD` (1) has no reason, and `INCORRECT_PASSWORD` (2) is `incorrect-password`. A browser test checks the two numbers against pdf.js's own.
- **qpdf** says "invalid password" for both, so the adapter decides by whether the source had a password.
- **Another engine** that only knows `PASSWORD_REQUIRED` is covered by the session: a file that needed a password and didn't open with the one given is reported as `incorrect-password`.

### The password dialog

When opening or inserting a file fails with `PASSWORD_REQUIRED`, `PdfEditor` asks for the password in ui's `Dialog`, and opens the file again with what the person types.

- **Every way in:** the editor's button, a dropped file, the insert tool, the `file` prop and `handle.open`. `handle.open` settles once the document has opened, or rejects with `PASSWORD_REQUIRED` once the person cancels. `session.open`, called directly, never asks: it's the headless path.
- **The field** is a password field with `autocomplete="current-password"`, so a password manager may fill it, with spelling and capitalisation help off. It takes focus when the dialog opens.
- **A wrong password** keeps the dialog open: the field is emptied, marked invalid and described by the error's text, focus stays in it, and the text is announced at once. A second wrong password is announced again.
- **Announcements come from inside the dialog.** A modal dialog makes everything outside it inert, the editor's live regions included, so the dialog has its own `AnnouncerProvider`. It says a wrong password assertively, and "Checking the password…" politely, only when a check takes more than a second: most end at once, and words about a check that's over would talk over its answer.
- **Cancelling:** Escape, the close button and Cancel. Nothing opens, a document that was open stays open, and the editor then shows the reason as it shows any failed open, with focus back where it was.
- **Opening:** the dialog closes, focus goes to the document, or to Easy mode's first start card, and the editor says what opened, or what was inserted. It says so once the dialog has closed: ui's toasts speak from inside an open modal dialog, and one that closes a moment later would take the words with it.
- **No alert behind the dialog.** While the editor is asking, the failure is the dialog's to show, so the start area's alert doesn't also announce it.
- **A virtual screen-reader test** asserts what's said at each step ([sdk-core ADR 0065](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0065-screen-reader-tests-with-a-virtual-screen-reader.md)).

### What an export keeps

**A document that needed a password to open keeps it.** `session.export()` encrypts the result with AES-256, whatever cipher the file had, so that it opens with the password `open()` was given. The person never loses protection by editing a file.

- **`keepPassword: false`** builds a document anyone can open. An `encrypt` option of the caller's own wins over both.
- **The password typed is the password kept.** The session knows one password. If the person opened the file with its owner password, the copy opens with that one. The original's other password, and its permission flags, can't be reproduced without it, and aren't.
- **An unchanged document is still its original bytes** ([ADR 0003](0003-page-plan-document-model.md)): exported with its password kept, it's the same file, in the cipher it had. With `keepPassword: false` it's built, without encryption.
- **Inserted documents:** a password given to `insert()` only reads that document. The result is protected by the password of the document that was opened, or not at all.
- **`passwordProtected`,** in the session's snapshot, says whether the open document needed a password, so a host can offer the choice. `document_exported`'s `encrypted` says whether the result is.
- **In the editor,** the download tool opens a dialog for such a document, before it saves: "Keep the password", chosen each time it opens, or "Remove the password", with a line saying what each gives. This is the dialog ADR 0009 expected once a download had a choice to make. A document without a password still downloads at once.

### Documents with only an owner password

They open without a password, as before, and the editor doesn't ask anything.

- **A built export carries no encryption and no restrictions.** The processor now decrypts every source when it normalises it, so every later step works on plain bytes, and the output is encrypted only when the job says so.
- **Why not keep the restrictions:** keeping them needs the owner password, which the person doesn't have, or copying the file's encryption dictionary as it is, weak cipher included. The flags never protected the content: any reader can ignore them, and the editor already lets the person rotate, delete and merge the pages they'd forbid. An export that kept them would look protected and not be.
- **What changes:** before, the result depended on the edit. qpdf kept the encryption when a document was only rotated, and dropped it when pages were reordered, and filling a form in such a document failed, because pdf-lib can't read an encrypted file. Now every build behaves the same.
- **An unchanged document** is its original bytes, restrictions included, as for any document.

### Where the password lives, and where it never goes

- **In memory only, with the document.** The session keeps it beside the source it opened, to read the source again when exporting. pdf.js keeps it in its worker with the open document. It's passed to qpdf for the length of a build.
- **Dropped on close and on replace:** when the session closes the document, or another document replaces it, and for an inserted document, when nothing refers to it any more.
- **Never persisted.** It isn't in the plan, the `hm-pdf-plan` format, a snapshot or the editor's preferences. Reopening a file asks again.
- **Never in an event:** `onEvent` gets the same anonymous events as before.
- **Never in an error:** not in `message`, `details` or `cause`. qpdf takes passwords as arguments, and its errors become causes, so the adapter replaces every password of the build in qpdf's message and output before the error leaves, whatever qpdf printed. qpdf 12 doesn't echo arguments; the replacement makes it hold if that changes.
- **Never in React's state, or the page:** the dialog's field is uncontrolled. Its value goes from the field to the session when the form is sent, and the field is emptied after a wrong password and when the dialog closes.
- **Tests:** contract tests of both ports, the session's tests and the editor's browser tests open, fail, edit and export with sentinel passwords, and assert that none appears in any error, cause, event, snapshot, build failure, or the page.

## Alternatives considered

- **A `PASSWORD_INCORRECT` code:** easier to narrow in TypeScript, but a second code for one recovery, against sdk-core ADR 0050, and a host that only handles `PASSWORD_REQUIRED` would treat a typing mistake as an unknown error. It would also break hosts' exhaustive switches for nothing.
- **Keeping the password in the engine only, and never in the session:** the processor is a separate engine in a separate worker, and reads the original bytes again, so the session has to hand it the password on every export.
- **Decrypting once on open, and keeping plain bytes:** the session would need the processor to open a document, pdf.js and qpdf would disagree on what a damaged file is, and an unchanged document could no longer be handed back as its own bytes.
- **The engine saying whether the password was needed, instead of the session opening twice:** one pass, with a new member on the document handle that every host's engine would have to report correctly. Opening twice asks nothing of an engine but the port's existing errors.
- **Keeping the original encryption with qpdf's `--copy-encryption`:** it preserves both passwords and the flags, and also RC4 on old files. An export should be as strong as the SDK can make it.
- **Removing the password by default:** one click fewer, and a person who forgets the question hands on an unprotected copy of a file someone chose to protect.
- **A "show password" button in the dialog:** useful for long passwords, and a ui component of its own, with its own announcements. It can follow.
- **Honouring permission flags in the editor,** such as refusing to edit a file that forbids changes: a product policy for hosts, which can read no flags from the SDK yet. It's not something an export can decide.

## Consequences

- People can open, edit, merge and save protected PDFs without their file or its password leaving the device.
- A protected file stays protected unless the person says otherwise, and comes out in AES-256 once it's been edited.
- **Additive API, a patch under the 0.x rule:** `password` on `PdfOpenOptions`, `PdfInsertOptions`, `PdfEngineOpenOptions` and `PdfBuildSource`; `keepPassword` on `PdfExportOptions`; `passwordProtected` on `PdfSessionSnapshot`; the `PdfPasswordRejection` type; and one error text.
  - A hand-written `PdfSessionSnapshot`, such as a test double, must add `passwordProtected`.
  - A host's own `PdfEngine` or `PdfProcessor` keeps working: it ignores the password and refuses protected files as before. To open them it must honour `password`, which the contract tests now check.
- **Two behaviour changes,** both for files that already opened: an export built from a document with only an owner password no longer carries its restrictions, and filling a form in one now works.
- Opening a protected file with its password costs one more copy of its bytes, for the attempt without it.
- The processor's normalising pass is `qpdf --decrypt` instead of a plain rewrite. For a file that isn't encrypted, the two are the same.
- **Not done:** setting a new password or permissions in the editor (hosts can, with `encrypt`), showing the password while typing, and remembering a password between visits, which the SDK will never do itself.
