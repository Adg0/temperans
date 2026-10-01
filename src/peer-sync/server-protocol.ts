import {
  PEER_SYNC_API_PREFIX,
  PeerSyncFilePayload,
  PeerSyncHelloRequest,
  PeerSyncHelloResponse,
  PeerSyncManifest,
  PeerSyncRpcRequest,
  base64ToBytes,
  bytesToBase64,
  validatePeerWritePayload
} from "./protocol";
import {
  PeerSessionKeys,
  computeHmacProof,
  decryptPeerPayload,
  deriveSessionKeys,
  encryptPeerPayload,
  verifyHmacProof
} from "./crypto";

export class PeerSyncConflictError extends Error {
  constructor() {
    super("The destination file changed after comparison. Refresh the preview before trying again.");
  }
}

export interface PeerSyncServerFiles {
  createManifest(): Promise<PeerSyncManifest>;
  readPayload(path: string): Promise<PeerSyncFilePayload>;
  writePayload(path: string, contentBytes: Uint8Array, incomingSha256: string, expectedDestinationSha256: string | null): Promise<void>;
}

export interface PeerSyncServerRequest {
  method: string | undefined;
  pathname: string;
  authorization?: string | undefined;
  sessionAuth?: string | undefined;
  sessionSalt?: string | undefined;
  body?: string;
  cryptoVersion?: string | null;
}

export interface PeerSyncServerResponse {
  status: number;
  payload: unknown;
}

export interface PeerSyncActiveSession {
  saltBase64: string;
  keys: PeerSessionKeys;
  expectedClientProof: string;
  createdAt: number;
  proofMessage: string;
  usedNonces: Set<string>;
}

export class PeerSyncSessionManager {
  private sessions = new Map<string, PeerSyncActiveSession>();
  private secret = "";
  private epoch = 0;
  private handshakes = 0;
  private attempts: number[] = [];

  bindSecret(secret: string): void {
    if (this.secret !== secret) { this.clear(); this.secret = secret; }
  }
  clear(): void { this.sessions.clear(); this.epoch++; }


  async handleHello(secret: string, req: PeerSyncHelloRequest): Promise<PeerSyncHelloResponse> {
    this.bindSecret(secret);
    if (!req || typeof req.clientNonce !== "string" || !req.clientNonce.trim() || req.clientNonce.length > 128) {
      throw new Error("Invalid client nonce.");
    }
    this.attempts = this.attempts.filter(time => time > Date.now() - 60_000);
    if (this.handshakes >= 2 || this.attempts.length >= 20) throw new Error("Too many pairing requests. Wait a minute and retry.");
    this.attempts.push(Date.now());
    this.handshakes++;
    const epoch = this.epoch;
    try {
    const clientNonce = req.clientNonce.trim();
    const serverNonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const sessionSaltBytes = crypto.getRandomValues(new Uint8Array(16));
    const serverNonce = bytesToBase64(serverNonceBytes);
    const sessionSalt = bytesToBase64(sessionSaltBytes);

    const keys = await deriveSessionKeys(secret, sessionSaltBytes);
    const serverProof = await computeHmacProof(keys.hmacKey, `${clientNonce}:${serverNonce}`);
    const expectedClientProof = await computeHmacProof(keys.hmacKey, `${serverNonce}:${clientNonce}`);

    if (epoch !== this.epoch) throw new Error("Pairing key changed during handshake.");
    this.sessions.set(sessionSalt, {
      saltBase64: sessionSalt,
      keys,
      expectedClientProof,
      createdAt: Date.now(),
      proofMessage: `${serverNonce}:${clientNonce}`,
      usedNonces: new Set()
    });

    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [salt, session] of this.sessions.entries()) {
      if (session.createdAt < cutoff) this.sessions.delete(salt);
    }
    if (this.sessions.size > 50) {
      const first = this.sessions.keys().next().value;
      if (first) this.sessions.delete(first);
    }

    return { serverNonce, sessionSalt, serverProof };
    } finally { this.handshakes--; }
  }

  getSession(salt: string): PeerSyncActiveSession | undefined {
    const session = this.sessions.get(salt);
    if (!session) return undefined;
    if (Date.now() - session.createdAt > 10 * 60 * 1000) {
      this.sessions.delete(salt);
      return undefined;
    }
    return session;
  }
}

export const defaultSessionManager = new PeerSyncSessionManager();

export async function dispatchPeerSyncRequest(
  files: PeerSyncServerFiles,
  secret: string,
  request: PeerSyncServerRequest,
  sessionManager: PeerSyncSessionManager = defaultSessionManager
): Promise<PeerSyncServerResponse> {
  sessionManager.bindSecret(secret);
  if ((request.body?.length ?? 0) > 1_500_000) return { status: 413, payload: { error: "Request too large." } };
  // 1. Handshake initiation endpoint (/hello)
  if (request.pathname === `${PEER_SYNC_API_PREFIX}/hello`) {
    if (request.method !== "POST") return { status: 405, payload: { error: "Method not allowed" } };
    try {
      const parsed = JSON.parse(request.body ?? "{}") as PeerSyncHelloRequest;
      const helloResp = await sessionManager.handleHello(secret, parsed);
      return { status: 200, payload: helloResp };
    } catch (err) {
      return { status: 400, payload: { error: err instanceof Error ? err.message : "Handshake failed" } };
    }
  }

  // 2. Authenticated RPC endpoint (/rpc)
  if (request.pathname === `${PEER_SYNC_API_PREFIX}/rpc`) {
    if (request.method !== "POST") return { status: 405, payload: { error: "Method not allowed" } };
    const salt = request.sessionSalt;
    const auth = request.sessionAuth;
    if (!salt || !auth) {
      return { status: 401, payload: { error: "Missing session authentication headers." } };
    }
    const session = sessionManager.getSession(salt);
    if (!session || !await verifyHmacProof(session.keys.hmacKey, session.proofMessage, auth)) {
      return { status: 401, payload: { error: "Unauthorized session proof." } };
    }

    try {
      const parsedBody = JSON.parse(request.body ?? "{}") as { encrypted?: boolean; data?: string };
      const encryptedData = parsedBody.encrypted && parsedBody.data ? parsedBody.data : (typeof parsedBody === "string" ? parsedBody : "");
      if (!encryptedData) {
        return { status: 400, payload: { error: "Missing encrypted RPC payload." } };
      }
      const rpc = await decryptPeerPayload<PeerSyncRpcRequest>(encryptedData, session.keys.aesKey);
      if (sessionManager.getSession(salt) !== session) return { status: 401, payload: { error: "Session revoked." } };
      const bytes = base64ToBytes(encryptedData)!;
      const nonce = bytesToBase64(bytes.slice(0, 12));
      if (session.usedNonces.has(nonce)) return { status: 409, payload: { error: "Repeated request rejected." } };
      if (session.usedNonces.size >= 4096) return { status: 401, payload: { error: "Session request limit reached. Reconnect." } };
      session.usedNonces.add(nonce);
      let rpcResult: unknown;

      if (rpc.action === "manifest") {
        rpcResult = await files.createManifest();
      } else if (rpc.action === "get") {
        if (!rpc.path) return { status: 400, payload: { error: "Missing file path in RPC." } };
        rpcResult = await files.readPayload(rpc.path);
      } else if (rpc.action === "put") {
        const payload = validatePeerWritePayload(rpc.payload);
        if (!payload) return { status: 400, payload: { error: "Invalid write payload." } };
        const bytes = base64ToBytes(payload.contentBase64);
        if (!bytes) return { status: 400, payload: { error: "Invalid base64 content." } };
        await files.writePayload(payload.path, bytes, payload.sha256, payload.expectedDestinationSha256);
        rpcResult = { ok: true };
      } else {
        return { status: 400, payload: { error: "Unknown RPC action." } };
      }

      const encryptedResponse = await encryptPeerPayload(rpcResult, session.keys.aesKey);
      return { status: 200, payload: { encrypted: true, data: encryptedResponse } };
    } catch (err) {
      if (err instanceof PeerSyncConflictError) return { status: 409, payload: { error: err.message } };
      return { status: 400, payload: { error: err instanceof Error ? err.message : "RPC execution failed." } };
    }
  }

  return { status: 426, payload: { error: "Legacy peer sync is disabled. Update both devices to use encrypted RPC." } };
}
