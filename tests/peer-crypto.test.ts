import { describe, expect, it } from "vitest";
import {
  computeHmacProof,
  decryptPeerPayload,
  derivePeerKey,
  deriveSessionKeys,
  encryptPeerPayload,
  PeerSyncSecurityError,
  verifyHmacProof
} from "../src/peer-sync/crypto";

describe("peer-sync crypto (AES-256-GCM + PBKDF2)", () => {
  const secret = "A9F2-81C4-DE90";

  it("encrypts and decrypts payloads accurately", async () => {
    const key = await derivePeerKey(secret);
    const data = {
      message: "Habit logs transfer",
      files: ["Settings.md", "2026/08/2026-08-25.md"],
      count: 42
    };

    const ciphertextBase64 = await encryptPeerPayload(data, key);
    expect(typeof ciphertextBase64).toBe("string");
    expect(ciphertextBase64).not.toContain("Habit logs transfer");

    const decrypted = await decryptPeerPayload<typeof data>(ciphertextBase64, key);
    expect(decrypted).toEqual(data);
  });

  it("rejects decryption with a wrong pairing secret", async () => {
    const senderKey = await derivePeerKey("SECRET-AAA");
    const receiverKey = await derivePeerKey("SECRET-BBB");

    const ciphertext = await encryptPeerPayload({ sensitive: "data" }, senderKey);
    await expect(decryptPeerPayload(ciphertext, receiverKey)).rejects.toThrow(PeerSyncSecurityError);
  });

  it("rejects tampered ciphertexts via GCM authentication", async () => {
    const key = await derivePeerKey(secret);
    const ciphertext = await encryptPeerPayload({ test: "data" }, key);

    // Tamper with one character in the base64 string
    const tampered = ciphertext.slice(0, -4) + "AAAA";
    await expect(decryptPeerPayload(tampered, key)).rejects.toThrow(PeerSyncSecurityError);
  });

  it("derives dynamic session keys (AES + HMAC) with dynamic session salts", async () => {
    const dynamicSalt = crypto.getRandomValues(new Uint8Array(16));
    const sessionKeys = await deriveSessionKeys(secret, dynamicSalt);

    expect(sessionKeys.aesKey).toBeDefined();
    expect(sessionKeys.hmacKey).toBeDefined();

    // Verify HMAC proof computation and verification
    const message = "clientNonce123:serverNonce456";
    const proof = await computeHmacProof(sessionKeys.hmacKey, message);
    expect(typeof proof).toBe("string");

    const valid = await verifyHmacProof(sessionKeys.hmacKey, message, proof);
    expect(valid).toBe(true);

    const invalid = await verifyHmacProof(sessionKeys.hmacKey, "wrong-message", proof);
    expect(invalid).toBe(false);
  });
});
