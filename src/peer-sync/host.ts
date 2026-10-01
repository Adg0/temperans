import { Platform } from "obsidian";
import { PeerSyncFiles } from "./files";
import { PeerSyncSessionManager, dispatchPeerSyncRequest } from "./server-protocol";

type NodeHttp = typeof import("http");
type NodeOs = typeof import("os");
type IncomingRequest = import("http").IncomingMessage;
type OutgoingResponse = import("http").ServerResponse;

export interface PeerSyncHostInfo {
  port: number;
  addresses: string[];
}

function desktopRequire<T>(moduleName: string): T {
  const req = typeof require === "function" ? require : undefined;
  if (typeof req === "function") return req(moduleName);
  throw new Error(`Cannot require "${moduleName}" outside desktop environment.`);
}

function writeJson(response: OutgoingResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(new TextEncoder().encode(body).byteLength) });
  response.end(body);
}

async function readBody(request: IncomingRequest): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
    length += bytes.byteLength;
    if (length > 1_500_000) throw new Error("Request body exceeds the peer-sync size limit.");
    chunks.push(bytes);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function localLanAddresses(): string[] {
  const os = desktopRequire<NodeOs>("os");
  const seen = new Set<string>();
  const ifaces = os.networkInterfaces();

  for (const [name, interfaces] of Object.entries(ifaces)) {
    const lower = name.toLowerCase();
    // Exclude virtual adapters (WSL, Hyper-V, vEthernet, Docker, VirtualBox, VMware)
    if (
      lower.includes("wsl") ||
      lower.includes("vethernet") ||
      lower.includes("docker") ||
      lower.includes("virtual") ||
      lower.includes("vmware") ||
      lower.includes("loopback")
    ) {
      continue;
    }

    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        if (address.address.startsWith("169.254.") || address.address.startsWith("192.168.56.")) {
          continue;
        }
        seen.add(address.address);
      }
    }
  }

  // If no interfaces passed the virtual filter, fall back to non-internal IPv4
  if (!seen.size) {
    for (const interfaces of Object.values(ifaces)) {
      for (const address of interfaces ?? []) {
        if (address.family === "IPv4" && !address.internal) seen.add(address.address);
      }
    }
  }

  // Prioritize physical Wi-Fi/LAN (192.168.x.x, then 10.x.x.x) over 172.16-31 virtual subnets
  const sorted = [...seen].sort((a, b) => {
    const isA192 = a.startsWith("192.168.");
    const isB192 = b.startsWith("192.168.");
    if (isA192 && !isB192) return -1;
    if (!isA192 && isB192) return 1;

    const isA10 = a.startsWith("10.");
    const isB10 = b.startsWith("10.");
    if (isA10 && !isB10) return -1;
    if (!isA10 && isB10) return 1;

    const isA172 = /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(a);
    const isB172 = /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(b);
    if (isA172 && !isB172) return 1;
    if (!isA172 && isB172) return -1;

    return a.localeCompare(b);
  });

  return sorted;
}

export class PeerSyncHostServer {
  private server: import("http").Server | null = null;
  private secret = "";
  private sessionManager = new PeerSyncSessionManager();

  constructor(private readonly files: PeerSyncFiles) {}

  get running(): boolean {
    return this.server !== null;
  }

  async start(port: number, secret: string): Promise<PeerSyncHostInfo> {
    if (!Platform.isDesktopApp) throw new Error("A peer-sync host can only run in the desktop app.");
    if (!secret) throw new Error("Generate a pairing code before starting the host.");
    if (this.server) await this.stop();
    this.secret = secret;
    this.sessionManager.bindSecret(secret);
    const http = desktopRequire<NodeHttp>("http");
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Port ${port} is already in use. Stop the other service or choose a different local host port.`));
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.maxConnections = 20;
    this.server = server;
    return { port, addresses: localLanAddresses() };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.sessionManager.clear();
    if (!server) return;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  }

  setSecret(secret: string): void {
    this.secret = secret;
  }

  private async handle(request: IncomingRequest, response: OutgoingResponse): Promise<void> {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const sessionAuthHeader = request.headers["x-session-auth"];
      const sessionAuth = typeof sessionAuthHeader === "string" ? sessionAuthHeader : Array.isArray(sessionAuthHeader) ? sessionAuthHeader[0] : undefined;
      const sessionSaltHeader = request.headers["x-session-salt"];
      const sessionSalt = typeof sessionSaltHeader === "string" ? sessionSaltHeader : Array.isArray(sessionSaltHeader) ? sessionSaltHeader[0] : undefined;
      const cryptoHeader = request.headers["x-peer-sync-crypto"];
      const cryptoVersion = typeof cryptoHeader === "string" ? cryptoHeader : Array.isArray(cryptoHeader) ? cryptoHeader[0] : null;

      const body = request.method === "POST" || request.method === "PUT" ? await readBody(request) : undefined;

      const result = await dispatchPeerSyncRequest(this.files, this.secret, {
        method: request.method,
        pathname: requestUrl.pathname,
        authorization: request.headers.authorization,
        sessionAuth,
        sessionSalt,
        body,
        cryptoVersion
      }, this.sessionManager);
      return writeJson(response, result.status, result.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Peer sync failed.";
      return writeJson(response, 400, { error: message });
    }
  }
}
