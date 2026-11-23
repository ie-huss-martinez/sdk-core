import type { NotesAssetReference } from "../../core/model/items.js";

/**
 * The pictures of an open notebook, decoded once each by the browser's own
 * decoder, off the main thread (sdk-core ADR 0031: a platform decoder, on
 * files the SDK already checked when they were added).
 */
export interface ImageCache {
  /** The picture if it's ready. Otherwise it starts loading, and `onLoad` fires when it is. */
  get(reference: NotesAssetReference): ImageBitmap | undefined;
  /** Resolves to the picture, or `undefined` if it can't be read or decoded. */
  load(reference: NotesAssetReference): Promise<ImageBitmap | undefined>;
  dispose(): void;
}

export function createImageCache(
  read: (reference: NotesAssetReference) => Promise<Blob>,
  onLoad: () => void,
): ImageCache {
  const ready = new Map<string, ImageBitmap>();
  const pending = new Map<string, Promise<ImageBitmap | undefined>>();
  let disposed = false;

  const load = (reference: NotesAssetReference) => {
    const found = ready.get(reference.asset);
    if (found) return Promise.resolve(found);
    let loading = pending.get(reference.asset);
    if (!loading) {
      loading = read(reference)
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          if (disposed) {
            bitmap.close();
            return undefined;
          }
          ready.set(reference.asset, bitmap);
          onLoad();
          return bitmap;
        })
        // A picture that can't be read stays a placeholder.
        .catch(() => undefined);
      pending.set(reference.asset, loading);
    }
    return loading;
  };

  return {
    get(reference) {
      const found = ready.get(reference.asset);
      if (!found && !disposed) void load(reference);
      return found;
    },
    load,
    dispose() {
      disposed = true;
      for (const bitmap of ready.values()) bitmap.close();
      ready.clear();
    },
  };
}
