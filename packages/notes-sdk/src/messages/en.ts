import { defineMessages, type MessageValue, plural, sdkCoreMessages } from "@hussmartinez/sdk-core";
import type { NotesErrorCode } from "../core/errors/notes-error.js";
import type { NotesLimitName } from "../core/errors/notes-limits.js";

/**
 * The notes SDK's English message catalogue for the server-safe entry:
 * sdk-core's messages, and text for every {@link NotesErrorCode} and every
 * limit's warning. Pass it to `createMessages` from `@hussmartinez/sdk-core`,
 * with the host's locale and overrides.
 *
 * It holds no interface text: the editor's is in `notesEditorMessages`,
 * from the React entry (sdk-core ADR 0059).
 *
 * Error text is looked up by code, with the error's `details` as
 * parameters, and never taken from `error.message` (sdk-core ADR 0019).
 *
 * It's built inside a function marked as free of side effects, because it
 * spreads sdk-core's catalogue: a bundler can't prove a spread is harmless,
 * and would otherwise keep the catalogue in every bundle that imports
 * anything from the package (sdk-core ADR 0056).
 *
 * @example
 * ```ts
 * const messages = createMessages(notesMessages, { locale: "en", overrides: props.messages });
 * messages.error(error); // "This notebook is open in another tab. Close it there to write here."
 * ```
 *
 * @public
 */
export const notesMessages = /* @__PURE__ */ (() =>
  defineMessages({
    ...sdkCoreMessages,
    "errors.INVALID_DOCUMENT": "This file is damaged, or it isn't a notes backup.",
    "errors.UNSUPPORTED_FORMAT":
      "This was saved by a newer version, or by another app. Update the app, and try again.",
    "errors.INVALID_COMMAND": "This edit couldn't be made. Please try again.",
    "errors.NOT_FOUND": "This couldn't be found. It may have been deleted in another tab.",
    "errors.NOTEBOOK_IN_USE": "This notebook is open in another tab. Close it there to write here.",
    "errors.STORAGE_FAILED":
      "Your notes couldn't be saved on this device. Keep this tab open, and try again.",
    "errors.STORAGE_FAILED.quota":
      "This device is out of space for notes. Free some space, or back up and delete notebooks you no longer need.",
    "errors.STORAGE_FAILED.unavailable":
      "This browser isn't letting the app keep notes on this device. Private windows often don't. Try a normal window.",
    "errors.INVALID_PDF": "This file isn't a PDF, or it's too damaged to open.",
    "errors.PASSWORD_REQUIRED":
      "This PDF is protected with a password. Remove the password, then import it again.",
    "errors.UNSUPPORTED_FILE":
      "This kind of file can't be added. Pictures can be PNG, JPEG, WebP or GIF.",
    "errors.EXPORT_FAILED": "The file couldn't be written. Please try again.",
    "errors.RECORDING_FAILED": "Sound couldn't be recorded on this device.",
    "errors.RECORDING_FAILED.denied":
      "The microphone is blocked for this site. Allow it in the browser's site settings to record.",
    "errors.TOO_MANY_PAGES":
      "That would make {actual, number} pages, which is over the {maximum, number}-page limit.",
    "errors.TOO_MANY_ITEMS":
      "This page is full: it can hold {maximum, number} strokes and other items. Continue on a new page.",
    "errors.IMAGE_TOO_LARGE":
      "This picture has {actual, megapixels}, which is over the {maximum, megapixels} limit.",
    "errors.BACKUP_TOO_LARGE":
      "This backup is {actual, fileSize}, which is over the {maximum, fileSize} limit.",
    "errors.TOO_MANY_BACKUP_ENTRIES": "This backup holds too many files to restore.",
    "warnings.maxPages": /* @__PURE__ */ plural("actual", {
      one: "This notebook has {actual} page. Large notebooks may be slow.",
      other: "This notebook has {actual} pages. Large notebooks may be slow.",
    }),
    "warnings.maxPageItems":
      "This page holds a lot of ink and may be slow. Continue on a new page.",
    "warnings.maxImagePixels": "This picture is very large and may be slow to show.",
    "warnings.maxBackupSize": "This backup is {actual, fileSize} and may take a while.",
    "warnings.maxBackupEntries": "This backup holds many files and may take a while.",
  }) satisfies Record<`errors.${NotesErrorCode}`, MessageValue> &
    Record<`warnings.${NotesLimitName}`, MessageValue>)();

/**
 * The type of {@link notesMessages}, for typing a host's overrides with
 * `MessageOverrides<NotesMessageCatalogue>`.
 *
 * @public
 */
export type NotesMessageCatalogue = typeof notesMessages;
