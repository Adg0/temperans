import { requestUrl } from "obsidian";
import {
  PEER_SYNC_API_PREFIX,
  PeerSyncFilePayload,
  PeerSyncHelloRequest,
  PeerSyncHelloResponse,
  PeerSyncManifest,
  PeerSyncRpcAction,
  PeerSyncRpcRequest,
  PeerSyncWritePayload,
  base64ToBytes,
  bytesToBase64,
  normalizePeerUrl,
  validatePeerManifest
} from "./protocol";
import {
  PeerSessionKeys,
  PeerSyncSecurityError,
  computeHmacProof,
  decryptPeerPayload,
  deriveSessionKeys,
  encryptPeerPayload,
  verifyHmacProof
} from "./crypto";

export class PeerSyncRemoteConflictError extends Error {
  constructor(message = "The paired device changed this file after comparison. Refresh the preview before trying again.") {
    super(message);
  }
}

interface ClientActiveSession {
  keys: PeerSessionKeys;
  sessionSalt: string;
  clientProof: string;
}

export class PeerSyncClient {
  private readonly endpoint: string;
  private sessionPromise: Promise<ClientActiveSession> | null = null;

  constructor(endpoint: string, private readonly secret: string) {
    const normalized = normalizePeerUrl(endpoint);
    if (!normalized) throw new Error("Enter a local HTTP address such as http://192.168.1.20:43887.");
    if (!secret.trim()) throw new Error("Enter the pairing code shown on the desktop host.");
    this.endpoint = normalized;
  }

  private async getSession(): Promise<ClientActiveSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.performHandshake().catch(error => { this.sessionPromise = null; throw error; });
    }
    return this.sessionPromise;
  }

  private async performHandshake(): Promise<ClientActiveSession> {
    const clientNonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const clientNonce = bytesToBase64(clientNonceBytes);

    const helloRequest: PeerSyncHelloRequest = { clientNonce };
    const response = await requestUrl({
      url: `${this.endpoint}${PEER_SYNC_API_PREFIX}/hello`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(helloRequest),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(this.errorMessage(response.json) || `Peer sync handshake failed (HTTP ${response.status}).`);
    }

    const helloResponse = response.json as Partial<PeerSyncHelloResponse>;
    if (!helloResponse.serverNonce || !helloResponse.sessionSalt || !helloResponse.serverProof) {
      throw new Error("Invalid handshake response from paired host.");
    }

    const saltBytes = base64ToBytes(helloResponse.sessionSalt);
    if (!saltBytes) {
      throw new Error("Malformed session salt from paired host.");
    }

    const keys = await deriveSessionKeys(this.secret, saltBytes);
    const expectedServerProof = await computeHmacProof(keys.hmacKey, `${clientNonce}:${helloResponse.serverNonce}`);
    if (expectedServerProof !== helloResponse.serverProof) {
      throw new PeerSyncSecurityError("Host pairing challenge verification failed. Check pairing code.");
    }

    const clientProof = await computeHmacProof(keys.hmacKey, `${helloResponse.serverNonce}:${clientNonce}`);

    return {
      keys,
      sessionSalt: helloResponse.sessionSalt,
      clientProof
    };
  }

  private async rpc<T>(action: PeerSyncRpcAction, path?: string, payload?: unknown): Promise<T> {
    const session = await this.getSession();
    const rpcReq: PeerSyncRpcRequest = { action, path, payload };
    const encryptedData = await encryptPeerPayload(rpcReq, session.keys.aesKey);

    const response = await requestUrl({
      url: `${this.endpoint}${PEER_SYNC_API_PREFIX}/rpc`,
      method: "POST",
      headers: {
        "X-Session-Auth": session.clientProof,
        "X-Session-Salt": session.sessionSalt,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ encrypted: true, data: encryptedData }),
      throw: false
    });

    if (response.status === 401) this.sessionPromise = null;
    if (response.status === 409) {
      throw new PeerSyncRemoteConflictError(this.errorMessage(response.json));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(this.errorMessage(response.json) || `Peer sync RPC failed (HTTP ${response.status}).`);
    }

    const rawJson = response.json as { encrypted?: boolean; data?: string };
    if (!rawJson || !rawJson.encrypted || typeof rawJson.data !== "string") {
      throw new Error("Invalid RPC response from paired device.");
    }

    return decryptPeerPayload<T>(rawJson.data, session.keys.aesKey);
  }

  async getManifest(): Promise<PeerSyncManifest> {
    const res = await this.rpc<PeerSyncManifest>("manifest");
    const manifest = validatePeerManifest(res);
    if (!manifest) throw new Error("The paired device returned an invalid peer-sync manifest.");
    return manifest;
  }

  async download(path: string): Promise<PeerSyncFilePayload> {
    const value = await this.rpc<Partial<PeerSyncFilePayload>>("get", path);
    if (!value || value.path !== path || typeof value.contentBase64 !== "string" || typeof value.sha256 !== "string") {
      throw new Error("The paired device returned an invalid file payload.");
    }
    return { path, contentBase64: value.contentBase64, sha256: value.sha256.toLowerCase() };
  }

  async upload(payload: PeerSyncWritePayload): Promise<void> {
    await this.rpc("put", payload.path, payload);
  }

  private errorMessage(value: unknown): string {
    return value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
      ? (value as { error: string }).error
      : "";
  }
}
