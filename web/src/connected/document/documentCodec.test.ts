import { describe, expect, it } from "vitest";
import { generateAesGcmKey } from "../crypto/webCrypto";
import {
  decryptDocument,
  decryptPdf,
  encryptDocument,
  encryptPdf,
  generateDocumentKey,
  unwrapDocumentKey,
  wrapDocumentKey,
} from "./documentCodec";
import type { EncryptedDocumentPlaintext } from "./documentTypes";

function samplePlaintext(): EncryptedDocumentPlaintext {
  return {
    schemaVersion: 1,
    invoiceDataSubset: { currency: "EUR", number: "", notes: ["internal note"] } as any,
    manualLines: [{ localId: "m1", item: { description: "Extra fee", qty: 1, unitPrice: 50, vatRate: 19 } }],
    order: ["srv:wi-1", "local:m1"],
  };
}

describe("documentCodec", () => {
  it("wraps and unwraps a document key with the master key", async () => {
    const masterKey = await generateAesGcmKey(false);
    const documentKey = await generateDocumentKey();

    const wrapped = await wrapDocumentKey(documentKey, masterKey);
    expect(wrapped.wrappedDocumentKeyBase64).toBeTruthy();
    expect(wrapped.documentKeyNonceBase64).toBeTruthy();

    const unwrapped = await unwrapDocumentKey(wrapped.wrappedDocumentKeyBase64, wrapped.documentKeyNonceBase64, masterKey);

    // Prove the unwrapped key is functionally the same key: encrypt with one, decrypt with the other.
    const plaintext = samplePlaintext();
    const encrypted = await encryptDocument(plaintext, documentKey);
    const decrypted = await decryptDocument(encrypted.documentCiphertextBase64, encrypted.documentNonceBase64, unwrapped);
    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips the document plaintext through AES-GCM", async () => {
    const documentKey = await generateDocumentKey();
    const plaintext = samplePlaintext();

    const encrypted = await encryptDocument(plaintext, documentKey);
    expect(encrypted.cipherAlgorithm).toBe("AES-256-GCM");
    expect(encrypted.documentCiphertextBase64).not.toContain("internal note");

    const decrypted = await decryptDocument(encrypted.documentCiphertextBase64, encrypted.documentNonceBase64, documentKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips a PDF through AES-GCM", async () => {
    const documentKey = await generateDocumentKey();
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5]); // "%PDF" + junk

    const encrypted = await encryptPdf(pdfBytes, documentKey);
    expect(encrypted.pdfSizeBytes).toBe(pdfBytes.byteLength);

    const decrypted = await decryptPdf(encrypted.pdfCiphertextBase64, encrypted.pdfNonceBase64, documentKey);
    expect(Array.from(decrypted)).toEqual(Array.from(pdfBytes));
  });

  it("uses a fresh nonce for the document and the PDF on every encrypt call", async () => {
    const documentKey = await generateDocumentKey();
    const plaintext = samplePlaintext();

    const first = await encryptDocument(plaintext, documentKey);
    const second = await encryptDocument(plaintext, documentKey);
    expect(first.documentNonceBase64).not.toBe(second.documentNonceBase64);

    const bytes = new Uint8Array([1, 2, 3]);
    const firstPdf = await encryptPdf(bytes, documentKey);
    const secondPdf = await encryptPdf(bytes, documentKey);
    expect(firstPdf.pdfNonceBase64).not.toBe(secondPdf.pdfNonceBase64);
  });
});
