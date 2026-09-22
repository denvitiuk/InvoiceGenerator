// Low-level Web Crypto helpers for connected-invoice mode.
//
// AES-256-GCM everywhere, a fresh random 12-byte nonce for every single encrypt
// operation, and a SHA-256 of the ciphertext for integrity checks the backend can
// verify without ever seeing plaintext. There is intentionally no less-secure
// fallback: if `crypto.subtle` (or IndexedDB, checked by keyStore.ts) isn't
// available, callers must show the "unsupported browser" state instead of
// degrading silently.

export class CryptoUnsupportedError extends Error {
  constructor(message = "Web Crypto (crypto.subtle) is not available in this browser") {
    super(message);
    this.name = "CryptoUnsupportedError";
  }
}

export function isWebCryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle === "object" && crypto.subtle !== null;
}

function requireSubtle(): SubtleCrypto {
  if (!isWebCryptoAvailable()) throw new CryptoUnsupportedError();
  return crypto.subtle;
}

export const AES_GCM = "AES-GCM" as const;
export const NONCE_BYTES = 12;

export function generateNonce12(): Uint8Array<ArrayBuffer> {
  if (!isWebCryptoAvailable()) throw new CryptoUnsupportedError();
  return crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
}

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder().decode(bytes);
}

export async function sha256Base64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = requireSubtle();
  const digest = await subtle.digest("SHA-256", bytes);
  return bytesToBase64(new Uint8Array<ArrayBuffer>(digest));
}

export interface AesGcmCiphertext {
  ciphertextBase64: string;
  nonceBase64: string;
  sha256Base64: string;
}

/** Encrypts `plaintext` with `key` using a fresh random 12-byte nonce. */
export async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>): Promise<AesGcmCiphertext> {
  const subtle = requireSubtle();
  const nonce = generateNonce12();
  const ciphertext = new Uint8Array<ArrayBuffer>(
    await subtle.encrypt({ name: AES_GCM, iv: nonce }, key, plaintext)
  );
  const sha256 = await sha256Base64(ciphertext);
  return {
    ciphertextBase64: bytesToBase64(ciphertext),
    nonceBase64: bytesToBase64(nonce),
    sha256Base64: sha256,
  };
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  ciphertextBase64: string,
  nonceBase64: string
): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = requireSubtle();
  const ciphertext = base64ToBytes(ciphertextBase64);
  const nonce = base64ToBytes(nonceBase64);
  const plaintext = await subtle.decrypt({ name: AES_GCM, iv: nonce }, key, ciphertext);
  return new Uint8Array<ArrayBuffer>(plaintext);
}

export async function generateAesGcmKey(extractable = false): Promise<CryptoKey> {
  const subtle = requireSubtle();
  return subtle.generateKey({ name: AES_GCM, length: 256 }, extractable, [
    "encrypt",
    "decrypt",
    "wrapKey",
    "unwrapKey",
  ]);
}

/** Wraps `keyToWrap` with `wrappingKey` using a fresh random 12-byte nonce. */
export async function wrapAesGcmKey(
  keyToWrap: CryptoKey,
  wrappingKey: CryptoKey
): Promise<{ wrappedKeyBase64: string; nonceBase64: string }> {
  const subtle = requireSubtle();
  const nonce = generateNonce12();
  const wrapped = new Uint8Array<ArrayBuffer>(
    await subtle.wrapKey("raw", keyToWrap, wrappingKey, { name: AES_GCM, iv: nonce })
  );
  return { wrappedKeyBase64: bytesToBase64(wrapped), nonceBase64: bytesToBase64(nonce) };
}

export async function unwrapAesGcmKey(
  wrappedKeyBase64: string,
  nonceBase64: string,
  wrappingKey: CryptoKey,
  extractable = false
): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const nonce = base64ToBytes(nonceBase64);
  const wrapped = base64ToBytes(wrappedKeyBase64);
  return subtle.unwrapKey(
    "raw",
    wrapped,
    wrappingKey,
    { name: AES_GCM, iv: nonce },
    { name: AES_GCM, length: 256 },
    extractable,
    ["encrypt", "decrypt"]
  );
}
