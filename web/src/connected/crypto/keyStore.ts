// IndexedDB-backed storage for the local master key used by connected-invoice mode.
//
// The master key is a non-extractable AES-256-GCM CryptoKey, one per
// billingProfileRef (so different clients' profiles on the same browser never
// share key material). It is stored via IndexedDB's structured-clone support for
// CryptoKey objects — the raw key bytes never touch JS and are never written to
// localStorage.

import { generateAesGcmKey, isWebCryptoAvailable } from "./webCrypto";

const DB_NAME = "invoice-connected-keys";
const DB_VERSION = 1;
const STORE_NAME = "masterKeys";

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available in this browser"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open key store"));
  });
}

async function getRecord(profileRef: string): Promise<CryptoKey | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(profileRef);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error ?? new Error("Failed to read key store"));
  });
}

async function putRecord(profileRef: string, key: CryptoKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(key, profileRef);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to write key store"));
  });
}

/** Returns the existing master key for this profile, or null if none exists yet — never creates one. */
export async function getExistingMasterKey(profileRef: string): Promise<CryptoKey | null> {
  if (!isWebCryptoAvailable() || !isIndexedDbAvailable()) return null;
  const key = await getRecord(profileRef);
  return key ?? null;
}

/** Returns the existing master key for this profile, creating a fresh non-extractable one on first use. */
export async function getOrCreateMasterKey(profileRef: string): Promise<CryptoKey> {
  const existing = await getExistingMasterKey(profileRef);
  if (existing) return existing;
  const key = await generateAesGcmKey(false);
  await putRecord(profileRef, key);
  return key;
}

/** Test/debug helper only — not used by production code paths. */
export async function _clearAllKeysForTests(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to clear key store"));
  });
}
