import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  comparePeerManifests,
  decodeVerifiedPeerContent,
  descriptorForContent,
  isPeerSyncPath,
  normalizePeerUrl,
  PeerSyncHelloResponse,
  validatePeerManifest,
  validatePeerWritePayload
} from "../src/peer-sync/protocol";
import { PeerSyncConflictError, PeerSyncSessionManager, dispatchPeerSyncRequest } from "../src/peer-sync/server-protocol";
import { computeHmacProof, decryptPeerPayload, derivePeerKey, deriveSessionKeys, encryptPeerPayload } from "../src/peer-sync/crypto";

describe("peer-sync protocol", () => {
  it("allows only Settings.md and dated habit logs (root or YYYY/MM)", () => {
    expect(isPeerSyncPath("Settings.md")).toBe(true);
    expect(isPeerSyncPath("2026-08-22.md")).toBe(true);
    expect(isPeerSyncPath("2026/08/2026-08-22.md")).toBe(true);
    expect(isPeerSyncPath("subfolder/2026-08-22.md")).toBe(false);
    expect(isPeerSyncPath("2026/2026-08-22.md")).toBe(false);
    expect(isPeerSyncPath("../Settings.md")).toBe(false);
    expect(isPeerSyncPath("data.json")).toBe(false);
  });

  it("compares identical, one-sided, and conflicting files safely", () => {
    const local = { version: 1 as const, files: [
      { path: "Settings.md", bytes: 1, sha256: "a".repeat(64) },
      { path: "2026-08-20.md", bytes: 1, sha256: "b".repeat(64) },
      { path: "2026-08-21.md", bytes: 1, sha256: "c".repeat(64) }
    ] };
    const remote = { version: 1 as const, files: [
      { path: "Settings.md", bytes: 1, sha256: "a".repeat(64) },
      { path: "2026-08-20.md", bytes: 2, sha256: "d".repeat(64) },
      { path: "2026-08-22.md", bytes: 1, sha256: "e".repeat(64) }
    ] };
    expect(comparePeerManifests(local, remote).map((item) => [item.path, item.status, item.defaultAction])).toEqual([
      ["2026-08-20.md", "different", "skip"],
      ["2026-08-21.md", "local-only", "upload"],
      ["2026-08-22.md", "remote-only", "download"],
      ["Settings.md", "same", "skip"]
    ]);
  });

  it("validates manifest and write payload boundaries", () => {
    expect(validatePeerManifest({ version: 1, files: [{ path: "2026-08-22.md", bytes: 12, sha256: "a".repeat(64) }] })).not.toBeNull();
    expect(validatePeerManifest({ version: 1, files: [{ path: "../data.json", bytes: 12, sha256: "a".repeat(64) }] })).toBeNull();
    expect(validatePeerWritePayload({
      path: "Settings.md",
      contentBase64: "dGVzdA==",
      sha256: "a".repeat(64),
      expectedDestinationSha256: null
    })).not.toBeNull();
    expect(validatePeerWritePayload({
      path: "Settings.md",
      contentBase64: "dGVzdA==",
      sha256: "bad",
      expectedDestinationSha256: null
    })).toBeNull();
  });

  it("preserves Unicode file contents and digests", async () => {
    const text = "# Habit log — café 🎸";
    const bytes = new TextEncoder().encode(text);
    const encoded = bytesToBase64(bytes);
    expect(new TextDecoder().decode(base64ToBytes(encoded)!)).toBe(text);
    const descriptor = await descriptorForContent("2026-08-22.md", text);
    expect(descriptor.bytes).toBe(bytes.byteLength);
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a payload whose bytes do not match its declared checksum", async () => {
    await expect(decodeVerifiedPeerContent("dGVzdA==", "a".repeat(64))).rejects.toThrow("checksum");
    await expect(decodeVerifiedPeerContent("dGVzdA==", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).resolves.toBeInstanceOf(Uint8Array);
  });

  it("accepts only a root HTTP endpoint", () => {
    expect(normalizePeerUrl("http://192.168.1.20:43887")).toBe("http://192.168.1.20:43887");
    expect(normalizePeerUrl("https://192.168.1.20:43887")).toBeNull();
    expect(normalizePeerUrl("http://192.168.1.20:43887/other")).toBeNull();
  });

  it("matches files across flat and nested directory structures in manifest comparison", () => {
    const local = { version: 1 as const, files: [
      { path: "2026/08/2026-08-25.md", bytes: 100, sha256: "a".repeat(64) },
      { path: "2026/08/2026-08-26.md", bytes: 100, sha256: "b".repeat(64) },
      { path: "Settings.md", bytes: 50, sha256: "s".repeat(64) }
    ] };
    const remote = { version: 1 as const, files: [
      { path: "2026-08-25.md", bytes: 100, sha256: "a".repeat(64) }, // identical hash, legacy flat structure!
      { path: "2026-08-26.md", bytes: 100, sha256: "c".repeat(64) }, // different hash, legacy flat structure!
      { path: "Settings.md", bytes: 50, sha256: "s".repeat(64) }
    ] };
    const plan = comparePeerManifests(local, remote);
    expect(plan.map((item) => [item.path, item.status, item.defaultAction])).toEqual([
      ["2026-08-25.md", "same", "skip"],
      ["2026-08-26.md", "different", "skip"],
      ["Settings.md", "same", "skip"]
    ]);
  });

  it("rejects both legacy plaintext and static-key encrypted endpoints", async () => {
    const files = { createManifest: async () => ({ version: 1 as const, files: [] }), readPayload: async () => { throw new Error("Unexpected read"); }, writePayload: async () => { throw new Error("Unexpected write"); } };
    for (const cryptoVersion of [undefined, "v1"]) expect((await dispatchPeerSyncRequest(files, "secret", {
      method: "GET", pathname: "/temperans-sync/v1/manifest", authorization: "Bearer secret", cryptoVersion
    })).status).toBe(426);
  });

  it("completes mutual challenge-response handshake without transmitting secret and executes authenticated RPC", async () => {
    const pairingSecret = "SUPER-SECRET-CODE-456";
    const sessionManager = new PeerSyncSessionManager();
    const files = {
      createManifest: async () => ({
        version: 1 as const,
        files: [{ path: "Settings.md", bytes: 50, sha256: "s".repeat(64) }]
      }),
      readPayload: async (path: string) => ({ path, contentBase64: "dGVzdA==", sha256: "a".repeat(64) }),
      writePayload: async () => {}
    };

    // Step 1 & 2: Client initiates /hello handshake
    const clientNonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const clientNonce = bytesToBase64(clientNonceBytes);

    const helloResponse = await dispatchPeerSyncRequest(files, pairingSecret, {
      method: "POST",
      pathname: "/temperans-sync/v1/hello",
      body: JSON.stringify({ clientNonce })
    }, sessionManager);

    expect(helloResponse.status).toBe(200);
    const helloPayload = helloResponse.payload as PeerSyncHelloResponse;
    expect(helloPayload.serverNonce).toBeDefined();
    expect(helloPayload.sessionSalt).toBeDefined();
    expect(helloPayload.serverProof).toBeDefined();

    // Step 3 & 4: Client verifies serverProof and computes clientProof
    const saltBytes = base64ToBytes(helloPayload.sessionSalt)!;
    const clientKeys = await deriveSessionKeys(pairingSecret, saltBytes);
    const expectedServerProof = await computeHmacProof(clientKeys.hmacKey, `${clientNonce}:${helloPayload.serverNonce}`);
    expect(expectedServerProof).toBe(helloPayload.serverProof);

    const clientProof = await computeHmacProof(clientKeys.hmacKey, `${helloPayload.serverNonce}:${clientNonce}`);

    // Step 5: Authenticated RPC request: manifest
    const encryptedRpcBody = await encryptPeerPayload({ action: "manifest" }, clientKeys.aesKey);
    const rpcResponse = await dispatchPeerSyncRequest(files, pairingSecret, {
      method: "POST",
      pathname: "/temperans-sync/v1/rpc",
      sessionAuth: clientProof,
      sessionSalt: helloPayload.sessionSalt,
      body: JSON.stringify({ encrypted: true, data: encryptedRpcBody })
    }, sessionManager);

    expect(rpcResponse.status).toBe(200);
    const rpcPayload = rpcResponse.payload as { encrypted: boolean; data: string };
    expect(rpcPayload.encrypted).toBe(true);

    const decrypted = await decryptPeerPayload<{ version: number; files: Array<{ path: string }> }>(rpcPayload.data, clientKeys.aesKey);
    expect(decrypted.version).toBe(1);
    expect(decrypted.files[0].path).toBe("Settings.md");

    // Step 6: Unauthorized RPC rejected if proof is incorrect
    const badRpcResponse = await dispatchPeerSyncRequest(files, pairingSecret, {
      method: "POST",
      pathname: "/temperans-sync/v1/rpc",
      sessionAuth: "bad-proof",
      sessionSalt: helloPayload.sessionSalt,
      body: JSON.stringify({ encrypted: true, data: encryptedRpcBody })
    }, sessionManager);

    expect(badRpcResponse.status).toBe(401);
  });
});
