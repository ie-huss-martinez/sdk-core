/**
 * Headless core of the notes SDK: the notebook model and its portable
 * formats, the edit commands, the library and notebook sessions, the stores,
 * backup and restore, and the PDF exporter.
 *
 * @remarks
 * This entry is server-safe: it has no React and touches no DOM on import,
 * so Server Components and Node can import it (sdk-core ADR 0004, ADR 0007).
 *
 * @packageDocumentation
 */

export { createMemoryNotesStore } from "./adapters/memory-store/memory-store.js";
export type { OpfsNotesStoreOptions } from "./adapters/opfs-store/opfs-store.js";
export { createOpfsNotesStore } from "./adapters/opfs-store/opfs-store.js";
export type { NotesPdfEngineOptions } from "./adapters/pdf/pdf-engine.js";
export { createNotesPdfEngine } from "./adapters/pdf/pdf-engine.js";
export { createMediaNotesRecorder } from "./adapters/recorder/media-recorder.js";
export type { NotesRestoreReport } from "./core/backup/backup.js";
export type {
  NotesCommandRejection,
  NotesDocumentRejection,
  NotesErrorCode,
} from "./core/errors/notes-error.js";
export { isNotesError, NotesError } from "./core/errors/notes-error.js";
export type {
  NotesFilePolicy,
  NotesFilePolicyOverrides,
  NotesLimitDefinitions,
  NotesLimitName,
} from "./core/errors/notes-limits.js";
export { notesLimitDefinitions, notesLimits } from "./core/errors/notes-limits.js";
export type {
  NotesBackupManifest,
  NotesLibraryDocument,
  NotesNotebookDocument,
  NotesPageDocument,
} from "./core/format/documents.js";
export {
  NOTES_BACKUP_FORMAT,
  NOTES_BACKUP_VERSION,
  NOTES_LIBRARY_FORMAT,
  NOTES_LIBRARY_VERSION,
  NOTES_NOTEBOOK_FORMAT,
  NOTES_NOTEBOOK_VERSION,
  NOTES_PAGE_FORMAT,
  NOTES_PAGE_VERSION,
  readNotesBackupManifest,
  readNotesLibraryDocument,
  readNotesNotebookDocument,
  readNotesPageDocument,
  toNotesLibraryDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "./core/format/documents.js";
export { outlineToPathData, strokeOutline } from "./core/ink/outline.js";
export type { NotesPoint, NotesRect, NotesSize } from "./core/model/geometry.js";
export { pointsToUnits, unitsToPoints } from "./core/model/geometry.js";
export { createNotesId } from "./core/model/ids.js";
export type {
  NotesAssetReference,
  NotesAudioAnchor,
  NotesColor,
  NotesImage,
  NotesItem,
  NotesItemType,
  NotesLink,
  NotesStroke,
  NotesStrokeTool,
  NotesText,
} from "./core/model/items.js";
export type {
  NotesFolder,
  NotesLibraryIndex,
  NotesNotebookSummary,
} from "./core/model/library.js";
export type {
  NotesCover,
  NotesNotebook,
  NotesOutlineEntry,
  NotesPage,
  NotesPageBackground,
  NotesPageInfo,
  NotesPageSizeName,
  NotesRecording,
  NotesTemplate,
} from "./core/model/notebook.js";
export { NOTES_PAGE_SIZES } from "./core/model/notebook.js";
export {
  NOTES_MAX_ID_LENGTH,
  NOTES_MAX_OUTLINE_ENTRIES,
  NOTES_MAX_PAGE_SIDE,
  NOTES_MAX_RECORDINGS,
  NOTES_MAX_STROKE_POINTS,
  NOTES_MAX_TEXT_LENGTH,
  NOTES_MAX_TITLE_LENGTH,
  NOTES_MIN_PAGE_SIDE,
  NOTES_PAGE_MARGIN,
  NOTES_PRESSURE_MAX,
  NOTES_STROKE_SIZE_RANGE,
  NOTES_TEXT_SIZE_RANGE,
  NOTES_UNITS_PER_POINT,
} from "./core/model/portable.js";
export type {
  NotesAddItemsCommand,
  NotesAddPagesCommand,
  NotesCommand,
  NotesCommandLimits,
  NotesDocumentState,
  NotesRemoveItemsCommand,
  NotesRemovePagesCommand,
  NotesRenameCommand,
  NotesReorderPagesCommand,
  NotesReplaceItemsCommand,
  NotesRestoreItemsCommand,
  NotesRestorePagesCommand,
  NotesSetOutlineCommand,
  NotesSetRecordingsCommand,
  NotesSetTemplatesCommand,
} from "./core/operations/commands.js";
export { applyNotesCommand, readNotesCommandDocument } from "./core/operations/commands.js";
export type {
  NotesExportImage,
  NotesPdfExportOptions,
  NotesPdfExportPage,
  NotesPdfExportPorts,
  NotesTextLayout,
  NotesTextLine,
} from "./core/pdf/export.js";
export { wrapText, writeNotesPdf } from "./core/pdf/export.js";
export type {
  NotesPdfAssembly,
  NotesPdfAssemblyPage,
  NotesPdfDocument,
  NotesPdfEngine,
  NotesPdfRenderOptions,
} from "./core/ports/notes-pdf.js";
export type { NotesRecorder, NotesRecorderSession } from "./core/ports/notes-recorder.js";
export type {
  NotesPageText,
  NotesPageTextChange,
  NotesPersistence,
  NotesStore,
} from "./core/ports/notes-store.js";
export type {
  NotesCallOptions,
  NotesProgress,
  NotesProgressOptions,
} from "./core/ports/options.js";
export type {
  NotesImportOptions,
  NotesLibrary,
  NotesLibraryBackupOptions,
  NotesLibraryEvent,
  NotesLibraryOptions,
  NotesLibrarySnapshot,
  NotesNewNotebook,
} from "./core/session/library.js";
export { createNotesLibrary } from "./core/session/library.js";
export type {
  NotesSaveState,
  NotesSession,
  NotesSessionEvent,
  NotesSessionOptions,
  NotesSessionSnapshot,
  NotesWarning,
} from "./core/session/notebook-session.js";
export { openNotesSession } from "./core/session/notebook-session.js";
export type { NotesSearchHit } from "./core/session/search.js";
export type { NotesEditorMessageCatalogue } from "./messages/editor.js";
export type { NotesMessageCatalogue } from "./messages/en.js";
export { notesMessages } from "./messages/en.js";
