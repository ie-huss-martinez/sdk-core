/**
 * The containers the editor's file pickers and drop zone accept. Browsers
 * give a `.dav` recording no MIME type, so it's listed by its extension
 * alone; the worker tells a file's format from its bytes either way.
 */
export const ACCEPT =
  "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv,.dav";
