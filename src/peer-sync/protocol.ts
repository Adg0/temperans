export const PEER_SYNC_API_PREFIX = "/temperans-sync/v1";
export const PEER_SYNC_MAX_FILE_BYTES = 1_000_000;

export type PeerSyncPath = "Settings.md" | `${number}-${string}.md`;
export type PeerSyncStatus = "same" | "local-only" | "remote-only" | "different";
export type PeerSyncAction = "skip" | "upload" | "download";

export interface PeerSyncFileDescriptor {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PeerSyncManifest {
  version: 1;
  files: PeerSyncFileDescriptor[];
}

export interface PeerSyncFilePayload {
  path: string;
  contentBase64: string;
  sha256: string;
}

export interface PeerSyncWritePayload extends PeerSyncFilePayload {
  expectedDestinationSha256: string | null;
}

export interface PeerSyncPlanItem {
  path: string;
  status: PeerSyncStatus;
  local?: PeerSyncFileDescriptor;
  remote?: PeerSyncFileDescriptor;
  defaultAction: PeerSyncAction;
}

export function isPeerSyncPath(path: string): boolean {
  return path === "Settings.md" || /^(?:\d{4}\/\d{2}\/)?\d{4}-\d{2}-\d{2}\.md$/.test(path);
}

export function normalizePeerUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" || !url.hostname || url.pathname !== "/" && url.pathname !== "") return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function logicalSyncKey(path: string): string {
  if (path === "Settings.md") return "Settings.md";
  const match = path.match(/(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? match[1] : path;
}

export function comparePeerManifests(local: PeerSyncManifest, remote: PeerSyncManifest): PeerSyncPlanItem[] {
  const localByKey = new Map<string, PeerSyncFileDescriptor>();
  for (const file of local.files) {
    if (isPeerSyncPath(file.path)) {
      localByKey.set(logicalSyncKey(file.path), file);
    }
  }

  const remoteByKey = new Map<string, PeerSyncFileDescriptor>();
  for (const file of remote.files) {
    if (isPeerSyncPath(file.path)) {
      remoteByKey.set(logicalSyncKey(file.path), file);
    }
  }

  const allKeys = [...new Set([...localByKey.keys(), ...remoteByKey.keys()])].sort();

  return allKeys.map((key) => {
    const localFile = localByKey.get(key);
    const remoteFile = remoteByKey.get(key);
    const path = key === "Settings.md" ? key : `${key}.md`;

    if (localFile && remoteFile) {
      const same = localFile.sha256 === remoteFile.sha256;
      return { path, status: same ? "same" : "different", local: localFile, remote: remoteFile, defaultAction: "skip" };
    }
    if (localFile) return { path, status: "local-only", local: localFile, defaultAction: "upload" };
    return { path, status: "remote-only", remote: remoteFile, defaultAction: "download" };
  });
}

export function validatePeerManifest(value: unknown): PeerSyncManifest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; files?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.files)) return null;
  const files: PeerSyncFileDescriptor[] = [];
  const paths = new Set<string>();
  for (const item of raw.files) {
    if (!item || typeof item !== "object") return null;
    const file = item as { path?: unknown; bytes?: unknown; sha256?: unknown };
    if (typeof file.path !== "string" || !isPeerSyncPath(file.path) || paths.has(file.path)) return null;
    if (typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > PEER_SYNC_MAX_FILE_BYTES) return null;
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256)) return null;
    paths.add(file.path);
    files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256.toLowerCase() });
  }
  return { version: 1, files };
}

export function validatePeerWritePayload(value: unknown): PeerSyncWritePayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PeerSyncWritePayload>;
  if (typeof raw.path !== "string" || !isPeerSyncPath(raw.path)) return null;
  if (typeof raw.contentBase64 !== "string" || raw.contentBase64.length > Math.ceil(PEER_SYNC_MAX_FILE_BYTES * 1.5) + 16) return null;
  if (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sha256)) return null;
  if (raw.expectedDestinationSha256 !== null && (typeof raw.expectedDestinationSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.expectedDestinationSha256))) return null;
  return {
    path: raw.path,
    contentBase64: raw.contentBase64,
    sha256: raw.sha256.toLowerCase(),
    expectedDestinationSha256: raw.expectedDestinationSha256?.toLowerCase() ?? null
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export async function sha256ForBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Decode inbound content and verify that its declared digest describes the exact bytes. */
export async function decodeVerifiedPeerContent(contentBase64: string, sha256: string): Promise<Uint8Array> {
  const bytes = base64ToBytes(contentBase64);
  if (!bytes) throw new Error("The incoming file payload is not valid base64.");
  if (bytes.byteLength > PEER_SYNC_MAX_FILE_BYTES) throw new Error("The incoming file exceeds the peer-sync size limit.");
  const actualSha256 = await sha256ForBytes(bytes);
  if (actualSha256 !== sha256.toLowerCase()) throw new Error("The incoming file checksum does not match its payload.");
  return bytes;
}

export async function descriptorForContent(path: string, content: string): Promise<PeerSyncFileDescriptor> {
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > PEER_SYNC_MAX_FILE_BYTES) throw new Error(`${path} is too large for peer sync.`);
  return { path, bytes: bytes.byteLength, sha256: await sha256ForBytes(bytes) };
}

export interface PeerSyncHelloRequest {
  clientNonce: string;
}

export interface PeerSyncHelloResponse {
  serverNonce: string;
  sessionSalt: string;
  serverProof: string;
}

export type PeerSyncRpcAction = "manifest" | "get" | "put";

export interface PeerSyncRpcRequest {
  action: PeerSyncRpcAction;
  path?: string;
  payload?: unknown;
}

export function createPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return bytesToBase64(bytes).replace(/[+/=]/g, "").slice(0, 24);
}
