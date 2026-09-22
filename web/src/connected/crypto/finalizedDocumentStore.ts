// IndexedDB storage for the encrypted local copy of a finalized invoice document
// (including its PDF), keyed by invoiceId, so an admin can still get to the
// confirmed PDF after closing and reopening the tab in the same browser —
// without needing to re-hit the network. Never stores plaintext.

import { isIndexedDbAvailable } from "./keyStore";

const DB_NAME = "invoice-connected-finalized";
const DB_VERSION = 1;
const STORE_NAME = "documents";

export interface FinalizedDocumentRecord {
  invoiceId: string;
  documentCiphertextBase64: string;
  documentNonceBase64: string;
  documentSha256Base64: string;
  wrappedDocumentKeyBase64: string;
  documentKeyNonceBase64: string;
  vaultProfileVersion: number;
  encryptionKeyVersion: number;
  pdfCiphertextBase64?: string;
  pdfNonceBase64?: string;
  pdfSha256Base64?: string;
  savedAt: string;
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
        db.createObjectStore(STORE_NAME, { keyPath: "invoiceId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open finalized-document store"));
  });
}

export async function saveFinalizedDocument(record: FinalizedDocumentRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to save finalized document"));
  });
}

export async function getFinalizedDocument(invoiceId: string): Promise<FinalizedDocumentRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(invoiceId);
    req.onsuccess = () => resolve((req.result as FinalizedDocumentRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Failed to read finalized document"));
  });
}
