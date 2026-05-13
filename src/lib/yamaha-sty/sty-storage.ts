/**
 * IndexedDB key-value store for user-uploaded Yamaha .sty / .sst files.
 *
 * Each entry: { name: string, data: ArrayBuffer, uploadedAt: number }.
 * The DB lives under `jazzify-styles.styles` and survives across sessions.
 * Built-in styles (like /styles/psBase.sst served from the public folder)
 * are not stored here — they're identified by their URL and fetched on
 * demand. User uploads are the ones that need persistence.
 */

const DB_NAME = 'jazzify-styles';
const DB_VERSION = 1;
const STORE = 'styles';

export interface StyleEntry {
  name: string;
  data: ArrayBuffer;
  uploadedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save (or overwrite) a style file. Name is the user-facing identifier. */
export async function saveStyleFile(name: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await wrap(tx.objectStore(STORE).put({ name, data, uploadedAt: Date.now() }));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Fetch the stored bytes for a given name, or null. */
export async function loadStyleFile(name: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const entry = await wrap(tx.objectStore(STORE).get(name)) as StyleEntry | undefined;
    return entry?.data ?? null;
  } finally {
    db.close();
  }
}

/** All stored style names, ascending by upload time. */
export async function listStyleFiles(): Promise<{ name: string; uploadedAt: number }[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await wrap(tx.objectStore(STORE).getAll()) as StyleEntry[];
    return all
      .map((e) => ({ name: e.name, uploadedAt: e.uploadedAt }))
      .sort((a, b) => a.uploadedAt - b.uploadedAt);
  } finally {
    db.close();
  }
}

/** Delete a stored style file. */
export async function deleteStyleFile(name: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await wrap(tx.objectStore(STORE).delete(name));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
