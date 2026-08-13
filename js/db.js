// Envoltorio ligero sobre IndexedDB: almacenamiento local (modo demo) + cola de
// sincronización offline (modo producción) + fotos (blobs) en ambos modos.

const DB_NAME = "hub-agricola";
const DB_VERSION = 1;
const STORES = [
  "proveedores",
  "checklistCab",
  "checklistItems",
  "seguimientos",
  "rutas",
  "gastosCab",
  "gastosDet",
  "photos",
  "outbox",
  "meta",
];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          if (name === "checklistItems") store.createIndex("byChecklist", "checklistId");
          if (name === "gastosDet") store.createIndex("byGasto", "gastoId");
          if (name === "outbox") store.createIndex("byTs", "ts");
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        resolve({ t, store });
        t.onerror = () => reject(t.error);
      })
  );
}

export const idb = {
  async put(storeName, value) {
    const { t, store } = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const r = store.put(value);
      r.onsuccess = () => resolve(value);
      r.onerror = () => reject(r.error);
      t.onerror = () => reject(t.error);
    });
  },

  async get(storeName, id) {
    const { store } = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  },

  async getAll(storeName) {
    const { store } = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async getAllByIndex(storeName, indexName, value) {
    const { store } = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const idx = store.index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async delete(storeName, id) {
    const { t, store } = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      t.onerror = () => reject(t.error);
    });
  },

  async clear(storeName) {
    const { t, store } = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      t.onerror = () => reject(t.error);
    });
  },
};

export function newId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Fotos: guardadas siempre localmente como blob; en modo producción además
// se suben a la biblioteca de documentos y el registro guarda la URL resultante. ----

export async function savePhotoBlob(blob) {
  const id = newId("photo");
  await idb.put("photos", { id, blob, createdAt: Date.now() });
  return id;
}

export async function getPhotoUrl(photoId) {
  const rec = await idb.get("photos", photoId);
  if (!rec) return null;
  return URL.createObjectURL(rec.blob);
}

// ---- Cola de sincronización offline (modo producción, useMock=false) ----

export async function enqueueOutbox(op) {
  const id = newId("outbox");
  await idb.put("outbox", { id, ts: Date.now(), status: "pending", ...op });
  return id;
}

export async function listOutbox() {
  const all = await idb.getAll("outbox");
  return all.filter((o) => o.status === "pending").sort((a, b) => a.ts - b.ts);
}

export async function markOutboxDone(id) {
  const rec = await idb.get("outbox", id);
  if (rec) {
    rec.status = "done";
    await idb.put("outbox", rec);
  }
}
