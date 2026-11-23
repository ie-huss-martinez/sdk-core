/**
 * The store's locks: the browser's Web Locks, which every tab of the origin
 * shares.
 *
 * Where the Web Locks API is missing, the names are kept here, in the page.
 * Every store of the page shares them, so two stores on one page still keep
 * each other out. Another tab can't be seen there: it takes the same lock
 * as if nobody held it.
 */

/** The names held in this page, where there is no Web Locks API. */
const heldHere = new Set<string>();
/** The last call queued on each name in this page, where there is no Web Locks API. */
const queuedHere = new Map<string, Promise<void>>();

/**
 * What every lock's name starts with. The Web Locks API refuses a name that
 * starts with `-`, which a storage's name may.
 */
const LOCK_PREFIX = "hm-notes";

/**
 * The name of a lock of one storage.
 *
 * @param storage - The storage's name.
 * @param kind - What is locked, such as `notebook`.
 * @param what - Which one.
 */
export function lockName(storage: string, kind: string, what: string): string {
  return `${LOCK_PREFIX}:${storage}:${kind}:${what}`;
}

/** The browser's lock manager, looked up when called, or `undefined` where there is none. */
function lockManager(): LockManager | undefined {
  return (globalThis as { readonly navigator?: { readonly locks?: LockManager } }).navigator?.locks;
}

/**
 * Runs work behind the work already queued under the same key, whether that
 * succeeded or failed, and forgets the key once nothing is queued on it.
 *
 * @param queues - The last work queued under each key.
 * @param key - What the work is queued on.
 * @param work - What to run when its turn comes.
 */
export function queueOn<Result>(
  queues: Map<string, Promise<void>>,
  key: string,
  work: () => Promise<Result>,
): Promise<Result> {
  const result = (queues.get(key) ?? Promise.resolve()).then(work);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}

/**
 * Asks for a lock without waiting for it. Resolves to `undefined` when it's
 * held, by any store of this page or of another tab, and otherwise to a
 * function that gives it back and resolves once it's free again.
 *
 * @param name - The lock's name, from {@link lockName}.
 */
export function tryLock(name: string): Promise<(() => Promise<void>) | undefined> {
  const locks = lockManager();
  if (!locks) {
    if (heldHere.has(name)) return Promise.resolve(undefined);
    heldHere.add(name);
    return Promise.resolve(() => {
      heldHere.delete(name);
      return Promise.resolve();
    });
  }
  return new Promise((resolve, reject) => {
    let letGo: () => void = () => {};
    const untilLetGo = new Promise<void>((done) => {
      letGo = done;
    });
    // The lock is held for as long as the promise the callback returns is pending.
    const finished: Promise<void> = locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(undefined);
        return undefined;
      }
      resolve(() => {
        letGo();
        return finished;
      });
      return untilLetGo;
    });
    finished.catch(reject);
  });
}

/**
 * Runs work while holding a lock, waiting for whoever holds it first. So
 * only one store at a time, of this page or of another tab, does the work
 * of one name.
 *
 * @param name - The lock's name, from {@link lockName}.
 * @param work - What to do while it's held.
 */
export function whileLocked<Result>(name: string, work: () => Promise<Result>): Promise<Result> {
  const locks = lockManager();
  if (!locks) return queueOn(queuedHere, name, work);
  return locks.request(name, work);
}
