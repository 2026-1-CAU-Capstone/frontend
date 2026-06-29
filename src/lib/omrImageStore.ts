/* Client-side store for the ORIGINAL sheet image a user uploaded to OMR.
 *
 * The backend doesn't persist or expose the uploaded image (ChordProject has
 * no image field and there's no download endpoint), so to show "the sheet I
 * uploaded" next to the generated chart we keep the image locally in
 * IndexedDB, keyed by the chord-project publicId. localStorage is unsuitable
 * — sheet photos are easily >1 MB and would blow its ~5 MB quota — whereas
 * IndexedDB stores Blobs natively with a much larger quota.
 *
 * LIMITATIONS (by design — client-only): the image lives only on the device
 * that uploaded it, and is lost if the browser's site data is cleared. It is
 * NOT synced across devices. A cross-device version requires backend storage.
 */

const DB_NAME = 'jazzify-omr-images';
const STORE = 'images';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Persist the uploaded image blob for a chord project. Best-effort: resolves
 *  even on failure (the feature is a nice-to-have, never block the upload). */
export async function saveOmrSourceImage(projectId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = tx(db, 'readwrite').put(blob, projectId);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Retrieve the stored image blob, or null if none exists for this project. */
export async function getOmrSourceImage(projectId: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<Blob | null>((resolve) => {
    try {
      const req = tx(db, 'readonly').get(projectId);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Drop the stored image for a project (call when the project is deleted). */
export async function deleteOmrSourceImage(projectId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = tx(db, 'readwrite').delete(projectId);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Wipe EVERY stored sheet image. Called on logout / account switch so the
 *  next user on this device can't open the previous user's uploaded scores
 *  (the blobs aren't user-namespaced). Best-effort like the rest of this
 *  module — auth flows must never block on IndexedDB. */
export async function clearAllOmrSourceImages(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = tx(db, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
