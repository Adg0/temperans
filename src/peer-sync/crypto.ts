import { base64ToBytes, bytesToBase64 } from "./protocol";

const DEFAULT_STATIC_SALT = new TextEncoder().encode("temperans-peer-sync-v1");
export const PBKDF2_ITERATIONS = 100_000;

export class PeerSyncSecurityError extends Error {
  constructor(message = "Peer-sync authentication failed: invalid pairing key or tampered payload.") {
    super(message);
  }
}

export interface PeerSessionKeys {
  aesKey: CryptoKey;
  hmacKey: CryptoKey;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey using PBKDF2.
 * Supports dynamic salt (recommended) with backward-compatible static salt fallback.
 */
export async function derivePeerKey(secret: string, salt: Uint8Array = DEFAULT_STATIC_SALT): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret.trim());
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derives both AES-256-GCM and HMAC-SHA256 session keys from the pairing secret
 * and a dynamic random session salt.
 */
export async function deriveSessionKeys(secret: string, salt: Uint8Array): Promise<PeerSessionKeys> {
  const secretBytes = new TextEncoder().encode(secret.trim());
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    512
  );
  const aesBytes = derivedBits.slice(0, 32);
  const hmacBytes = derivedBits.slice(32, 64);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    hmacBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  return { aesKey, hmacKey };
}

export async function computeHmacProof(key: CryptoKey, message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyHmacProof(key: CryptoKey, message: string, expectedProofBase64: string): Promise<boolean> {
  const expectedBytes = base64ToBytes(expectedProofBase64);
  if (!expectedBytes) return false;
  const data = new TextEncoder().encode(message);
  return crypto.subtle.verify("HMAC", key, expectedBytes, data);
}

export async function encryptPeerPayload(payload: unknown, key: CryptoKey): Promise<string> {
  const json = JSON.stringify(payload);
  const plaintext = new TextEncoder().encode(json);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  // Concatenate [12-byte IV] + [Ciphertext + 16-byte Auth Tag]
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  return bytesToBase64(combined);
}

export async function decryptPeerPayload<T = unknown>(encryptedBase64: string, key: CryptoKey): Promise<T> {
  const combined = base64ToBytes(encryptedBase64);
  if (!combined || combined.length < 12 + 16) {
    throw new PeerSyncSecurityError("Encrypted payload is malformed or too short.");
  }
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    const json = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(json) as T;
  } catch {
    throw new PeerSyncSecurityError();
  }
}
