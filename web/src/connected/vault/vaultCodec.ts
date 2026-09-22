// AES-GCM encrypt/decrypt for the local Invoice Vault (company + per-profile
// client info). Never imports debug.ts — ciphertext/keys/plaintext can
// structurally never reach a log call from this module.

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToUtf8,
  utf8ToBytes,
} from "../crypto/webCrypto";
import type { EncryptedVaultDTO, SaveEncryptedVaultRequest } from "../types";
import type { InvoiceVault } from "./vaultTypes";

const CIPHER_ALGORITHM = "AES-256-GCM";

export async function encryptVault(
  vault: InvoiceVault,
  masterKey: CryptoKey,
  opts: { expectedRevision: number; profileVersion: number }
): Promise<SaveEncryptedVaultRequest> {
  const plaintext = utf8ToBytes(JSON.stringify(vault));
  const { ciphertextBase64, nonceBase64, sha256Base64 } = await aesGcmEncrypt(masterKey, plaintext);
  return {
    expectedRevision: opts.expectedRevision,
    profileVersion: opts.profileVersion,
    cipherAlgorithm: CIPHER_ALGORITHM,
    encryptedPayloadBase64: ciphertextBase64,
    payloadNonceBase64: nonceBase64,
    ciphertextSha256Base64: sha256Base64,
  };
}

export type VaultDecryptResult =
  | { ok: true; vault: InvoiceVault }
  | { ok: false; reason: "cannot-open" };

/**
 * Attempts to decrypt a remote vault with the local master key. Never throws for
 * the "wrong/missing key" case — callers use `ok:false` to show the
 * "can't be opened on this device" state without ever overwriting the remote
 * vault.
 */
export async function decryptVault(dto: EncryptedVaultDTO, masterKey: CryptoKey): Promise<VaultDecryptResult> {
  try {
    const plaintextBytes = await aesGcmDecrypt(masterKey, dto.encryptedPayloadBase64, dto.payloadNonceBase64);
    const vault = JSON.parse(bytesToUtf8(plaintextBytes)) as InvoiceVault;
    if (vault.schemaVersion !== 1 || typeof vault.profiles !== "object") {
      return { ok: false, reason: "cannot-open" };
    }
    return { ok: true, vault };
  } catch {
    return { ok: false, reason: "cannot-open" };
  }
}
