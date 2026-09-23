import { describe, expect, it } from "vitest";
import { generateAesGcmKey } from "../crypto/webCrypto";
import { decryptVault, encryptVault } from "./vaultCodec";
import type { InvoiceVault } from "./vaultTypes";

function sampleVault(): InvoiceVault {
  return {
    schemaVersion: 1,
    company: { name: "Acme GmbH", addressLines: ["Main St 1", "12345 Berlin"], iban: "DE00000000000000000000" },
    profiles: {
      "profile-1": {
        client: { name: "Client Co", addressLines: ["Client Rd 2"] },
        dueDays: 14,
      },
    },
  };
}

describe("vaultCodec", () => {
  it("round-trips a vault through AES-GCM encrypt/decrypt", async () => {
    const key = await generateAesGcmKey(false);
    const vault = sampleVault();

    const saveRequest = await encryptVault(vault, key, { expectedRevision: 0, profileVersion: 1 });
    expect(saveRequest.cipherAlgorithm).toBe("AES-256-GCM");
    expect(saveRequest.encryptedPayloadBase64).not.toContain("Acme GmbH");

    const dto = {
      companyId: 1,
      revision: 1,
      profileVersion: 1,
      cipherAlgorithm: saveRequest.cipherAlgorithm!,
      encryptedPayloadBase64: saveRequest.encryptedPayloadBase64,
      payloadNonceBase64: saveRequest.payloadNonceBase64,
      ciphertextSha256Base64: saveRequest.ciphertextSha256Base64,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await decryptVault(dto, key);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vault).toEqual(vault);
    }
  });

  it("uses a fresh nonce on every encrypt call", async () => {
    const key = await generateAesGcmKey(false);
    const vault = sampleVault();

    const first = await encryptVault(vault, key, { expectedRevision: 0, profileVersion: 1 });
    const second = await encryptVault(vault, key, { expectedRevision: 1, profileVersion: 1 });

    expect(first.payloadNonceBase64).not.toBe(second.payloadNonceBase64);
    expect(first.encryptedPayloadBase64).not.toBe(second.encryptedPayloadBase64);
  });

  it("reports 'cannot-open' instead of throwing when the key cannot decrypt the vault", async () => {
    const key = await generateAesGcmKey(false);
    const wrongKey = await generateAesGcmKey(false);
    const saveRequest = await encryptVault(sampleVault(), key, { expectedRevision: 0, profileVersion: 1 });

    const dto = {
      companyId: 1,
      revision: 1,
      profileVersion: 1,
      cipherAlgorithm: saveRequest.cipherAlgorithm!,
      encryptedPayloadBase64: saveRequest.encryptedPayloadBase64,
      payloadNonceBase64: saveRequest.payloadNonceBase64,
      ciphertextSha256Base64: saveRequest.ciphertextSha256Base64,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await decryptVault(dto, wrongKey);
    expect(result).toEqual({ ok: false, reason: "cannot-open" });
  });
});
