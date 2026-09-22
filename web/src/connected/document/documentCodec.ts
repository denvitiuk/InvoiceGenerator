// Per-invoice encrypted document: a fresh AES-256-GCM document key wraps the
// serialized editable document (InvoiceData subset, item links, manual lines,
// schema version) and, separately, the final PDF. The document key itself is
// wrapped by the local master key. Never imports debug.ts.

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToUtf8,
  generateAesGcmKey,
  unwrapAesGcmKey,
  utf8ToBytes,
  wrapAesGcmKey,
} from "../crypto/webCrypto";
import type { EncryptedDocumentPlaintext } from "./documentTypes";

const CIPHER_ALGORITHM = "AES-256-GCM";
const ENCRYPTION_KEY_VERSION = 1;

// Extractable=true: not a weaker guarantee than the master key — a document
// key only ever leaves memory wrapped (AES-GCM-encrypted) by the
// non-extractable master key, and `wrapKey` itself requires the key being
// wrapped to be extractable (WebCrypto: InvalidAccessError otherwise).
export async function generateDocumentKey(): Promise<CryptoKey> {
  return generateAesGcmKey(true);
}

export async function wrapDocumentKey(
  documentKey: CryptoKey,
  masterKey: CryptoKey
): Promise<{ wrappedDocumentKeyBase64: string; documentKeyNonceBase64: string }> {
  const { wrappedKeyBase64, nonceBase64 } = await wrapAesGcmKey(documentKey, masterKey);
  return { wrappedDocumentKeyBase64: wrappedKeyBase64, documentKeyNonceBase64: nonceBase64 };
}

export async function unwrapDocumentKey(
  wrappedDocumentKeyBase64: string,
  documentKeyNonceBase64: string,
  masterKey: CryptoKey
): Promise<CryptoKey> {
  // extractable=true so this unwrapped key can be wrapped again on the next autosave.
  return unwrapAesGcmKey(wrappedDocumentKeyBase64, documentKeyNonceBase64, masterKey, true);
}

export interface EncryptedDocumentFields {
  cipherAlgorithm: string;
  encryptionKeyVersion: number;
  documentCiphertextBase64: string;
  documentNonceBase64: string;
  documentSha256Base64: string;
}

export async function encryptDocument(
  plaintext: EncryptedDocumentPlaintext,
  documentKey: CryptoKey
): Promise<EncryptedDocumentFields> {
  const bytes = utf8ToBytes(JSON.stringify(plaintext));
  const { ciphertextBase64, nonceBase64, sha256Base64 } = await aesGcmEncrypt(documentKey, bytes);
  return {
    cipherAlgorithm: CIPHER_ALGORITHM,
    encryptionKeyVersion: ENCRYPTION_KEY_VERSION,
    documentCiphertextBase64: ciphertextBase64,
    documentNonceBase64: nonceBase64,
    documentSha256Base64: sha256Base64,
  };
}

export async function decryptDocument(
  documentCiphertextBase64: string,
  documentNonceBase64: string,
  documentKey: CryptoKey
): Promise<EncryptedDocumentPlaintext> {
  const bytes = await aesGcmDecrypt(documentKey, documentCiphertextBase64, documentNonceBase64);
  return JSON.parse(bytesToUtf8(bytes)) as EncryptedDocumentPlaintext;
}

export interface EncryptedPdfFields {
  pdfCiphertextBase64: string;
  pdfNonceBase64: string;
  pdfSha256Base64: string;
  pdfSizeBytes: number;
}

export async function encryptPdf(pdfBytes: Uint8Array<ArrayBuffer>, documentKey: CryptoKey): Promise<EncryptedPdfFields> {
  const { ciphertextBase64, nonceBase64, sha256Base64 } = await aesGcmEncrypt(documentKey, pdfBytes);
  return {
    pdfCiphertextBase64: ciphertextBase64,
    pdfNonceBase64: nonceBase64,
    pdfSha256Base64: sha256Base64,
    pdfSizeBytes: pdfBytes.byteLength,
  };
}

export async function decryptPdf(
  pdfCiphertextBase64: string,
  pdfNonceBase64: string,
  documentKey: CryptoKey
): Promise<Uint8Array<ArrayBuffer>> {
  return aesGcmDecrypt(documentKey, pdfCiphertextBase64, pdfNonceBase64);
}
