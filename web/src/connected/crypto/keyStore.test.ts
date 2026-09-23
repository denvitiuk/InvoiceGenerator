import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { _clearAllKeysForTests, getExistingMasterKey, getOrCreateMasterKey } from "./keyStore";

describe("keyStore", () => {
  beforeEach(async () => {
    await _clearAllKeysForTests().catch(() => {});
  });

  it("getExistingMasterKey returns null when no key has been created yet", async () => {
    const key = await getExistingMasterKey("profile-never-seen");
    expect(key).toBeNull();
  });

  it("getOrCreateMasterKey creates a non-extractable key on first use", async () => {
    const key = await getOrCreateMasterKey("profile-a");
    expect(key).toBeTruthy();
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("getOrCreateMasterKey returns the same key on subsequent calls instead of creating a new one", async () => {
    const first = await getOrCreateMasterKey("profile-b");
    const second = await getOrCreateMasterKey("profile-b");
    expect(second).toEqual(first);
  });

  it("getExistingMasterKey finds a key created by getOrCreateMasterKey", async () => {
    await getOrCreateMasterKey("profile-c");
    const found = await getExistingMasterKey("profile-c");
    expect(found).not.toBeNull();
  });

  it("keeps keys for different billingProfileRefs independent", async () => {
    const a = await getOrCreateMasterKey("profile-d1");
    const b = await getOrCreateMasterKey("profile-d2");
    // Different CryptoKey objects (can't compare key material directly since both are non-extractable).
    expect(a).not.toBe(b);
  });
});
