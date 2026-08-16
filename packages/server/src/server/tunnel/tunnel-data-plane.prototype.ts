/**
 * THROWAWAY PROTOTYPE — do not use as the production Tunnel implementation.
 *
 * Question: Is one relay WebSocket + E2EE channel per HTTP request viable for
 * JSON/binary bodies, SSE, bounded streaming, and prompt cancellation cleanup?
 *
 * Run from the repository root:
 *   npm run prototype:tunnel-data-plane --workspace=@getpaseo/server
 *
 * Use an existing relay:
 *   PASEO_TUNNEL_PROTOTYPE_RELAY_URL=https://relay.example.test npm run prototype:tunnel-data-plane --workspace=@getpaseo/server
 */

/* eslint-disable max-nested-callbacks -- throwaway harness keeps the complete flow in one file */

import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { performance } from "node:perf_hooks";
import {
  createClientChannel,
  createDaemonChannel,
  exportPublicKey,
  generateKeyPair,
  type EncryptedChannel,
  type KeyPair,
  type Transport,
} from "@getpaseo/relay/e2ee";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const FRAME_BYTES = 64 * 1024;
const RECEIVE_HIGH_WATER_BYTES = 512 * 1024;
const RECEIVE_LOW_WATER_BYTES = 128 * 1024;
const SEND_HIGH_WATER_BYTES = 512 * 1024;
const FLOW_WINDOW_CHUNKS = 8;
const HANDSHAKE_SAMPLES = 12;
const SLOW_UPLOAD_BYTES = 32 * 1024 * 1024;
const SLOW_TARGET_DELAY_MS = 5;
const TIMEOUT_MS = 20_000;
const debugEnabled = process.env.PASEO_TUNNEL_PROTOTYPE_DEBUG === "1";

interface RequestHead {
  type: "request.head";
  method: string;
  path: string;
  headers: Array<[string, string]>;
}

interface ResponseHead {
  type: "response.head";
  statusCode: number;
  headers: Array<[string, string]>;
}

interface RequestAck {
  type: "request.ack";
  bytes: number;
}

interface ResponseAck {
  type: "response.ack";
  bytes: number;
}

type FlowControlMode = "controlled" | "uncontrolled";

interface BackpressureResult {
  callerWriteMs: number;
  callerDrainEvents: number;
  egressForwardMs: number;
  targetConsumeMs: number;
  receiveQueuePeakBytes: number;
  sendBufferedPeakBytes: number;
}

interface ResponseBackpressureResult {
  callerConsumeMs: number;
  ingressForwardMs: number;
  targetProduceMs: number;
  receiveQueuePeakBytes: number;
  sendBufferedPeakBytes: number;
}

interface PrototypeMetrics {
  handshakesMs: number[];
  dataConnectionsOpened: number;
  dataConnectionsClosed: number;
  activeDataConnections: number;
  peakDataConnections: number;
  receiveQueuePeakBytes: number;
  sendBufferedPeakBytes: number;
  slowForwardMs: Record<FlowControlMode, number>;
  slowForwardBytes: Record<FlowControlMode, number>;
  slowResponseForwardMs: Record<FlowControlMode, number>;
  slowResponseForwardBytes: Record<FlowControlMode, number>;
  targetCancelObservedMs: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface ManagedServer {
  port: number;
  close: () => Promise<void>;
}

interface RelayHarness {
  websocketBaseUrl: string;
  description: string;
  stop: () => Promise<void>;
}

interface TargetState {
  slowConsumeMs: Record<FlowControlMode, number>;
  slowProduceMs: Record<FlowControlMode, number>;
  cancelObserved: Deferred<number>;
}

interface ScenarioResult {
  json: { bytes: number; sha256: string };
  binary: { bytes: number; sha256: string };
  sse: { firstEventMs: number; endMs: number };
  backpressure: {
    request: {
      bytes: number;
      withoutFlowControl: BackpressureResult;
      withFlowControl: BackpressureResult;
    };
    response: {
      bytes: number;
      withoutFlowControl: ResponseBackpressureResult;
      withFlowControl: ResponseBackpressureResult;
    };
  };
  cancellation: { targetObservedMs: number; activeConnectionsAfter: number };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function debug(message: string): void {
  if (debugEnabled) console.error(`[tunnel prototype] ${message}`);
}

function flowControlMode(path: string | undefined): FlowControlMode | null {
  if (path?.endsWith("-controlled")) return "controlled";
  if (path?.endsWith("-uncontrolled")) return "uncontrolled";
  return null;
}

function relayWebSocketUrl(
  websocketBaseUrl: string,
  serverId: string,
  role: "client" | "server",
  connectionId?: string,
): string {
  const url = new URL("/ws", websocketBaseUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  url.searchParams.set("serverId", serverId);
  url.searchParams.set("role", role);
  url.searchParams.set("v", "2");
  if (connectionId) url.searchParams.set("connectionId", connectionId);
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function withTimeout<T>(promise: Promise<T>, label: string, ms = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function toBuffer(data: string | ArrayBuffer): Buffer {
  return typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
}

function rawToArrayBuffer(data: RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (Array.isArray(data)) return toArrayBuffer(Buffer.concat(data));
  return toArrayBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

function rawToText(data: RawData): string {
  return typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
}

function frameByteLength(data: string | ArrayBuffer): number {
  return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}

function headersToTuples(headers: IncomingMessage["headers"]): Array<[string, string]> {
  const tuples: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) tuples.push([name, item]);
    } else {
      tuples.push([name, value]);
    }
  }
  return tuples;
}

function tuplesToHeaders(tuples: Array<[string, string]>): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of tuples) {
    const current = headers[name];
    if (current === undefined) headers[name] = value;
    else if (Array.isArray(current)) current.push(value);
    else headers[name] = [current, value];
  }
  return headers;
}

async function waitForBufferedAmount(ws: WebSocket, metrics: PrototypeMetrics): Promise<void> {
  metrics.sendBufferedPeakBytes = Math.max(metrics.sendBufferedPeakBytes, ws.bufferedAmount);
  while (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > SEND_HIGH_WATER_BYTES) {
    await sleep(1);
    metrics.sendBufferedPeakBytes = Math.max(metrics.sendBufferedPeakBytes, ws.bufferedAmount);
  }
  if (ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket closed while waiting to send");
}

function createTransport(ws: WebSocket, metrics: PrototypeMetrics): Transport {
  const transport: Transport = {
    send: async (data) => {
      await waitForBufferedAmount(ws, metrics);
      await new Promise<void>((resolveSend, reject) => {
        ws.send(data, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolveSend();
        });
      });
      metrics.sendBufferedPeakBytes = Math.max(metrics.sendBufferedPeakBytes, ws.bufferedAmount);
    },
    close: (code, reason) => ws.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.on("message", (data, isBinary) => {
    transport.onmessage?.({
      data: isBinary ? rawToArrayBuffer(data) : rawToText(data),
      isBinary,
    });
  });
  ws.on("close", (code, reason) => transport.onclose?.(code, reason.toString()));
  ws.on("error", (error) => transport.onerror?.(error));
  return transport;
}

function createBoundedPlaintextQueue(
  ws: WebSocket,
  metrics: PrototypeMetrics,
  handle: (data: string | ArrayBuffer) => Promise<void>,
): (data: string | ArrayBuffer) => void {
  let queuedBytes = 0;
  let queue = Promise.resolve();
  return (data) => {
    const bytes = frameByteLength(data);
    queuedBytes += bytes;
    metrics.receiveQueuePeakBytes = Math.max(metrics.receiveQueuePeakBytes, queuedBytes);
    if (queuedBytes >= RECEIVE_HIGH_WATER_BYTES) ws.pause();
    queue = queue
      .then(() => handle(data))
      .catch((error) => {
        ws.close(1011, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        queuedBytes -= bytes;
        if (queuedBytes <= RECEIVE_LOW_WATER_BYTES) ws.resume();
      });
  };
}

async function listen(server: ReturnType<typeof createServer>): Promise<ManagedServer> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string", "Server did not expose a TCP port");
  return {
    port: address.port,
    close: async () => {
      if ("closeAllConnections" in server) server.closeAllConnections();
      await Promise.race([
        new Promise<void>((resolveClose) => server.close(() => resolveClose())),
        sleep(1_000),
      ]);
    },
  };
}

async function startRelay(): Promise<RelayHarness> {
  interface RelayPeer {
    role: "client" | "server";
    serverId: string;
    connectionId: string;
  }
  interface RelaySession {
    control: WebSocket | null;
    clients: Map<string, Set<WebSocket>>;
    servers: Map<string, WebSocket>;
    pending: Map<string, Array<{ data: Buffer | string; isBinary: boolean }>>;
  }

  const sessions = new Map<string, RelaySession>();
  const peers = new WeakMap<WebSocket, RelayPeer>();
  const httpServer = createServer();
  const webSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const managed = await listen(httpServer);
  const getSession = (serverId: string): RelaySession => {
    const existing = sessions.get(serverId);
    if (existing) return existing;
    const created: RelaySession = {
      control: null,
      clients: new Map(),
      servers: new Map(),
      pending: new Map(),
    };
    sessions.set(serverId, created);
    return created;
  };
  const send = (ws: WebSocket, data: Buffer | string, isBinary: boolean): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (
      url.pathname !== "/ws" ||
      url.searchParams.get("v") !== "2" ||
      !url.searchParams.get("serverId")
    ) {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      const serverId = url.searchParams.get("serverId")!;
      const role = url.searchParams.get("role") === "client" ? "client" : "server";
      const connectionId = url.searchParams.get("connectionId") ?? "";
      const session = getSession(serverId);
      peers.set(ws, { role, serverId, connectionId });

      if (role === "server" && !connectionId) {
        session.control?.close(1001, "replaced");
        session.control = ws;
        send(
          ws,
          JSON.stringify({ type: "sync", connectionIds: [...session.clients.keys()] }),
          false,
        );
      } else if (role === "client") {
        const clients = session.clients.get(connectionId) ?? new Set<WebSocket>();
        clients.add(ws);
        session.clients.set(connectionId, clients);
        if (session.control) {
          send(session.control, JSON.stringify({ type: "connected", connectionId }), false);
        }
      } else {
        session.servers.get(connectionId)?.close(1001, "replaced");
        session.servers.set(connectionId, ws);
        for (const frame of session.pending.get(connectionId) ?? []) {
          send(ws, frame.data, frame.isBinary);
        }
        session.pending.delete(connectionId);
      }

      ws.on("message", (raw, isBinary) => {
        const peer = peers.get(ws);
        if (!peer || !peer.connectionId) return;
        const frame = isBinary ? Buffer.from(rawToArrayBuffer(raw)) : rawToText(raw);
        if (peer.role === "client") {
          const target = session.servers.get(peer.connectionId);
          if (target) send(target, frame, isBinary);
          else {
            const pending = session.pending.get(peer.connectionId) ?? [];
            pending.push({ data: frame, isBinary });
            session.pending.set(peer.connectionId, pending);
          }
          return;
        }
        for (const target of session.clients.get(peer.connectionId) ?? []) {
          send(target, frame, isBinary);
        }
      });

      ws.once("close", () => {
        const peer = peers.get(ws);
        if (!peer) return;
        if (peer.role === "server" && !peer.connectionId) {
          if (session.control === ws) session.control = null;
          return;
        }
        if (peer.role === "server") {
          if (session.servers.get(peer.connectionId) === ws) {
            session.servers.delete(peer.connectionId);
          }
          return;
        }
        const clients = session.clients.get(peer.connectionId);
        clients?.delete(ws);
        if (clients?.size) return;
        session.clients.delete(peer.connectionId);
        session.pending.delete(peer.connectionId);
        session.servers.get(peer.connectionId)?.close(1001, "client disconnected");
        if (session.control) {
          send(
            session.control,
            JSON.stringify({ type: "disconnected", connectionId: peer.connectionId }),
            false,
          );
        }
      });
    });
  });

  return {
    websocketBaseUrl: `ws://127.0.0.1:${managed.port}`,
    description: "in-process real WebSocket implementation of the existing relay v2 contract",
    stop: async () => {
      for (const ws of webSocketServer.clients) ws.terminate();
      webSocketServer.close();
      await managed.close();
    },
  };
}

async function resolveRelayHarness(): Promise<RelayHarness> {
  const configured = process.env.PASEO_TUNNEL_PROTOTYPE_RELAY_URL?.trim();
  if (!configured) return startRelay();
  const url = new URL(configured);
  assert(
    ["http:", "https:", "ws:", "wss:"].includes(url.protocol),
    "PASEO_TUNNEL_PROTOTYPE_RELAY_URL must use http(s) or ws(s)",
  );
  return {
    websocketBaseUrl: url.toString(),
    description: `external relay ${url.origin}`,
    stop: async () => undefined,
  };
}

async function startTarget(state: TargetState): Promise<ManagedServer> {
  const server = createServer(async (request, response) => {
    if (request.url === "/sse") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.flushHeaders();
      await sleep(40);
      response.write("data: first\n\n");
      await sleep(250);
      response.end("data: second\n\n");
      return;
    }
    if (request.url === "/cancel") {
      debug("target cancel request started");
      const startedAt = performance.now();
      response.writeHead(200, { "content-type": "text/event-stream" });
      let loggedTick = false;
      const interval = setInterval(() => {
        if (!loggedTick) {
          loggedTick = true;
          debug("target cancel first tick");
        }
        response.write("data: tick\n\n");
      }, 20);
      response.once("close", () => {
        clearInterval(interval);
        state.cancelObserved.resolve(performance.now() - startedAt);
      });
      return;
    }
    if (request.url?.startsWith("/slow-download-")) {
      const mode = flowControlMode(request.url);
      assert(mode, "Slow download did not declare a flow-control mode");
      const startedAt = performance.now();
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": SLOW_UPLOAD_BYTES,
      });
      const frame = Buffer.alloc(FRAME_BYTES, 0x6b);
      for (let sent = 0; sent < SLOW_UPLOAD_BYTES; sent += frame.byteLength) {
        if (!response.write(frame)) await once(response, "drain");
      }
      state.slowProduceMs[mode] = performance.now() - startedAt;
      response.end();
      return;
    }

    const startedAt = performance.now();
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.byteLength;
      if (flowControlMode(request.url)) await sleep(SLOW_TARGET_DELAY_MS);
    }
    const mode = flowControlMode(request.url);
    if (mode) state.slowConsumeMs[mode] = performance.now() - startedAt;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ bytes, sha256: hash.digest("hex") }));
  });
  return listen(server);
}

async function sendSocket(
  socket: { send: (data: string | Uint8Array) => void | Promise<void> },
  data: string | Uint8Array,
): Promise<void> {
  const result = socket.send(data);
  if (result) await result;
}

function startIngressControl(
  relayBaseUrl: string,
  targetPort: number,
  serverId: string,
  keyPair: KeyPair,
  metrics: PrototypeMetrics,
): { ready: Promise<void>; stop: () => Promise<void> } {
  const control = new WebSocket(relayWebSocketUrl(relayBaseUrl, serverId, "server"), {
    perMessageDeflate: false,
  });
  const ready = deferred<void>();
  const sockets = new Set<WebSocket>();
  const connectionIds = new Set<string>();

  control.on("message", (raw) => {
    let message: { type?: string; connectionId?: string; connectionIds?: string[] };
    try {
      message = JSON.parse(rawToText(raw));
    } catch {
      return;
    }
    debug(`control ${message.type ?? "unknown"}`);
    if (message.type === "sync") ready.resolve();
    let ids: string[] = [];
    if (message.type === "connected" && message.connectionId) {
      ids = [message.connectionId];
    } else if (message.type === "sync") {
      ids = message.connectionIds ?? [];
    }
    for (const connectionId of ids) {
      if (connectionIds.has(connectionId)) continue;
      connectionIds.add(connectionId);
      const ws = new WebSocket(relayWebSocketUrl(relayBaseUrl, serverId, "server", connectionId), {
        perMessageDeflate: false,
      });
      sockets.add(ws);
      metrics.dataConnectionsOpened += 1;
      metrics.activeDataConnections += 1;
      metrics.peakDataConnections = Math.max(
        metrics.peakDataConnections,
        metrics.activeDataConnections,
      );
      ws.once("close", () => {
        sockets.delete(ws);
        connectionIds.delete(connectionId);
        metrics.dataConnectionsClosed += 1;
        metrics.activeDataConnections -= 1;
        debug(`ingress data closed ${connectionId}`);
      });
      ws.once("error", (error) => {
        debug(`ingress data error ${connectionId}: ${error.message}`);
      });
      ws.once("open", () => {
        debug(`ingress data open ${connectionId}`);
        let upstream: ReturnType<typeof httpRequest> | null = null;
        let upstreamResponse: IncomingMessage | null = null;
        let useRequestFlowControl = true;
        const pendingResponseAcks: Array<Deferred<number>> = [];
        const cleanup = () => {
          upstream?.destroy();
          upstreamResponse?.destroy();
        };
        ws.once("close", cleanup);
        ws.once("error", cleanup);
        const channelPromise = createDaemonChannel(createTransport(ws, metrics), keyPair, {
          onmessage: createBoundedPlaintextQueue(ws, metrics, async (data) => {
            if (typeof data === "string") {
              const frame = JSON.parse(data) as RequestHead | ResponseAck | { type: "request.end" };
              if (frame.type === "response.ack") {
                pendingResponseAcks.shift()?.resolve(frame.bytes);
                return;
              }
              if (frame.type === "request.head") {
                debug(`ingress request.head ${frame.path}`);
                useRequestFlowControl = flowControlMode(frame.path) !== "uncontrolled";
                upstream = httpRequest(
                  {
                    hostname: "127.0.0.1",
                    port: targetPort,
                    path: frame.path,
                    method: frame.method,
                    headers: tuplesToHeaders(frame.headers),
                  },
                  (response) => {
                    debug(`ingress response.head ${frame.path}`);
                    upstreamResponse = response;
                    void (async () => {
                      const responseForwardStartedAt = performance.now();
                      let responseBytes = 0;
                      await sendSocket(
                        wsSocket(channelPromise),
                        JSON.stringify({
                          type: "response.head",
                          statusCode: response.statusCode ?? 502,
                          headers: headersToTuples(response.headers),
                        } satisfies ResponseHead),
                      );
                      let responseFramesInBatch = 0;
                      let lastResponseAck: Deferred<number> | null = null;
                      let lastResponseFrameBytes = 0;
                      for await (const chunk of response) {
                        if (frame.path === "/cancel") debug("ingress cancel response chunk");
                        const buffer = Buffer.from(chunk);
                        if (flowControlMode(frame.path) === "uncontrolled") {
                          await sendSocket(wsSocket(channelPromise), buffer);
                        } else {
                          const ack = deferred<number>();
                          pendingResponseAcks.push(ack);
                          await sendSocket(wsSocket(channelPromise), buffer);
                          responseFramesInBatch += 1;
                          lastResponseAck = ack;
                          lastResponseFrameBytes = buffer.byteLength;
                          if (responseFramesInBatch >= FLOW_WINDOW_CHUNKS) {
                            const acknowledgedBytes = await withTimeout(
                              ack.promise,
                              "response chunk acknowledgement",
                            );
                            assert(
                              acknowledgedBytes === buffer.byteLength,
                              "Egress acknowledged the wrong response chunk size",
                            );
                            responseFramesInBatch = 0;
                            lastResponseAck = null;
                          }
                        }
                        responseBytes += buffer.byteLength;
                      }
                      if (lastResponseAck) {
                        const acknowledgedBytes = await withTimeout(
                          lastResponseAck.promise,
                          "final response chunk acknowledgement",
                        );
                        assert(
                          acknowledgedBytes === lastResponseFrameBytes,
                          "Egress acknowledged the wrong final response chunk size",
                        );
                      }
                      const mode = flowControlMode(frame.path);
                      if (frame.path.startsWith("/slow-download-") && mode) {
                        metrics.slowResponseForwardMs[mode] =
                          performance.now() - responseForwardStartedAt;
                        metrics.slowResponseForwardBytes[mode] = responseBytes;
                      }
                      await sendSocket(
                        wsSocket(channelPromise),
                        JSON.stringify({ type: "response.end" }),
                      );
                    })().catch(() => ws.close(1011, "upstream response failed"));
                  },
                );
                upstream.on("error", () => ws.close(1011, "upstream request failed"));
                return;
              }
              if (frame.type === "request.end") upstream?.end();
              return;
            }
            assert(upstream, "Received request body before request.head");
            if (!upstream.write(toBuffer(data))) await once(upstream, "drain");
            if (useRequestFlowControl) {
              await sendSocket(
                wsSocket(channelPromise),
                JSON.stringify({
                  type: "request.ack",
                  bytes: data.byteLength,
                } satisfies RequestAck),
              );
            }
          }),
          onerror: () => cleanup(),
        });
        void channelPromise.then(() => debug(`ingress E2EE open ${connectionId}`));
      });
    }
  });
  control.once("error", (error) => ready.reject(error));

  return {
    ready: withTimeout(ready.promise, "Ingress control connection"),
    stop: async () => {
      for (const ws of sockets) ws.terminate();
      control.close();
      await sleep(20);
    },
  };
}

function wsSocket(channelPromise: Promise<EncryptedChannel>): {
  send: (data: string | Uint8Array) => Promise<void>;
} {
  return {
    send: async (data) => {
      const channel = await channelPromise;
      await channel.send(typeof data === "string" ? data : toArrayBuffer(Buffer.from(data)));
    },
  };
}

async function startEgress(
  relayBaseUrl: string,
  serverId: string,
  daemonPublicKey: string,
  metrics: PrototypeMetrics,
): Promise<ManagedServer> {
  const server = createServer((request, response) => {
    request.pause();
    const receivedAt = performance.now();
    const connectionId = `prototype-${randomUUID()}`;
    const ws = new WebSocket(relayWebSocketUrl(relayBaseUrl, serverId, "client", connectionId), {
      perMessageDeflate: false,
    });
    let finished = false;
    let currentChannel: EncryptedChannel | null = null;
    const pendingRequestAcks: Array<Deferred<number>> = [];
    const channelReady = deferred<EncryptedChannel>();
    const opened = deferred<void>();
    const completed = deferred<void>();
    const cancel = () => {
      if (finished) return;
      currentChannel?.close(1000, "caller cancelled");
      ws.terminate();
      completed.resolve();
    };
    request.once("aborted", cancel);
    response.once("close", cancel);
    ws.once("error", (error) => {
      opened.reject(error);
      completed.reject(error);
    });
    ws.once("open", () => {
      debug(`egress data open ${connectionId}`);
      const handleResponse = createBoundedPlaintextQueue(ws, metrics, async (data) => {
        if (typeof data === "string") {
          const frame = JSON.parse(data) as RequestAck | ResponseHead | { type: "response.end" };
          if (frame.type === "request.ack") {
            pendingRequestAcks.shift()?.resolve(frame.bytes);
            return;
          }
          if (frame.type === "response.head") {
            debug(`egress response.head ${request.url}`);
            response.writeHead(frame.statusCode, tuplesToHeaders(frame.headers));
            return;
          }
          if (frame.type === "response.end") {
            finished = true;
            response.end();
            completed.resolve();
          }
          return;
        }
        if (!response.write(toBuffer(data))) await once(response, "drain");
        if (flowControlMode(request.url) !== "uncontrolled") {
          await sendSocket(
            wsSocket(channelReady.promise),
            JSON.stringify({ type: "response.ack", bytes: data.byteLength } satisfies ResponseAck),
          );
        }
        if (request.url === "/cancel") debug("egress cancel response chunk");
      });
      void createClientChannel(createTransport(ws, metrics), daemonPublicKey, {
        onopen: () => {
          debug(`egress E2EE open ${connectionId}`);
          opened.resolve();
        },
        onmessage: handleResponse,
        onclose: () => {
          if (!finished) completed.resolve();
        },
        onerror: (error) => completed.reject(error),
      }).then((created) => {
        currentChannel = created;
        channelReady.resolve(created);
        return undefined;
      });
    });

    void (async () => {
      await withTimeout(opened.promise, "E2EE handshake");
      metrics.handshakesMs.push(performance.now() - receivedAt);
      const openChannel = await channelReady.promise;
      await openChannel.send(
        JSON.stringify({
          type: "request.head",
          method: request.method ?? "GET",
          path: request.url ?? "/",
          headers: headersToTuples(request.headers).filter(([name]) => name !== "host"),
        } satisfies RequestHead),
      );
      request.resume();
      let forwardedBytes = 0;
      const forwardStartedAt = performance.now();
      let requestFramesInBatch = 0;
      let lastRequestAck: Deferred<number> | null = null;
      let lastRequestFrameBytes = 0;
      for await (const rawChunk of request) {
        const chunk = Buffer.from(rawChunk);
        for (let offset = 0; offset < chunk.byteLength; offset += FRAME_BYTES) {
          const frame = chunk.subarray(offset, Math.min(offset + FRAME_BYTES, chunk.byteLength));
          if (flowControlMode(request.url) === "uncontrolled") {
            await openChannel.send(toArrayBuffer(frame));
          } else {
            const ack = deferred<number>();
            pendingRequestAcks.push(ack);
            await openChannel.send(toArrayBuffer(frame));
            requestFramesInBatch += 1;
            lastRequestAck = ack;
            lastRequestFrameBytes = frame.byteLength;
            if (requestFramesInBatch >= FLOW_WINDOW_CHUNKS) {
              const acknowledgedBytes = await withTimeout(
                ack.promise,
                "request chunk acknowledgement",
              );
              assert(
                acknowledgedBytes === frame.byteLength,
                "Ingress acknowledged the wrong chunk size",
              );
              requestFramesInBatch = 0;
              lastRequestAck = null;
            }
          }
          forwardedBytes += frame.byteLength;
        }
      }
      if (lastRequestAck) {
        const acknowledgedBytes = await withTimeout(
          lastRequestAck.promise,
          "final request chunk acknowledgement",
        );
        assert(
          acknowledgedBytes === lastRequestFrameBytes,
          "Ingress acknowledged the wrong final request chunk size",
        );
      }
      const mode = flowControlMode(request.url);
      if (mode) {
        metrics.slowForwardMs[mode] = performance.now() - forwardStartedAt;
        metrics.slowForwardBytes[mode] = forwardedBytes;
      }
      await openChannel.send(JSON.stringify({ type: "request.end" }));
      await withTimeout(completed.promise, `HTTP ${request.url}`);
      if (finished) openChannel.close();
    })().catch((error) => {
      ws.terminate();
      if (!response.headersSent) response.writeHead(502);
      if (!response.writableEnded) response.end("prototype tunnel failure");
      completed.reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
  return listen(server);
}

async function requestJson(
  port: number,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<{ bytes: number; sha256: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: toArrayBuffer(body),
  });
  assert(response.ok, `${path} returned ${response.status}`);
  return (await response.json()) as { bytes: number; sha256: string };
}

async function measureSse(port: number): Promise<{ firstEventMs: number; endMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/sse`);
  assert(response.body, "SSE response had no body");
  const reader = response.body.getReader();
  let firstEventMs = 0;
  while (true) {
    const { done } = await reader.read();
    if (done) break;
    if (firstEventMs === 0) firstEventMs = performance.now() - startedAt;
  }
  return { firstEventMs, endMs: performance.now() - startedAt };
}

async function measureSlowUpload(
  port: number,
  mode: FlowControlMode,
): Promise<{
  callerWriteMs: number;
  drainEvents: number;
  result: { bytes: number; sha256: string };
}> {
  return withTimeout(
    new Promise((resolveUpload, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: `/slow-upload-${mode}`,
          method: "POST",
          headers: { "content-length": SLOW_UPLOAD_BYTES },
        },
        async (response) => {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of response) chunks.push(Buffer.from(chunk));
            resolveUpload({
              callerWriteMs,
              drainEvents,
              result: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error) {
            reject(error);
          }
        },
      );
      request.once("error", reject);
      const frame = Buffer.alloc(FRAME_BYTES, 0x5a);
      const startedAt = performance.now();
      let callerWriteMs = 0;
      let drainEvents = 0;
      void (async () => {
        for (let sent = 0; sent < SLOW_UPLOAD_BYTES; sent += frame.byteLength) {
          if (!request.write(frame)) {
            drainEvents += 1;
            await once(request, "drain");
          }
        }
        callerWriteMs = performance.now() - startedAt;
        request.end();
      })().catch(reject);
    }),
    "slow upload",
    60_000,
  );
}

async function measureSlowDownload(
  port: number,
  mode: FlowControlMode,
): Promise<{ bytes: number; callerConsumeMs: number }> {
  return withTimeout(
    new Promise((resolveDownload, reject) => {
      const startedAt = performance.now();
      const request = httpRequest(
        `http://127.0.0.1:${port}/slow-download-${mode}`,
        async (response) => {
          try {
            let bytes = 0;
            for await (const chunk of response) {
              bytes += Buffer.byteLength(chunk);
              await sleep(SLOW_TARGET_DELAY_MS);
            }
            resolveDownload({ bytes, callerConsumeMs: performance.now() - startedAt });
          } catch (error) {
            reject(error);
          }
        },
      );
      request.once("error", reject);
      request.end();
    }),
    "slow download",
    60_000,
  );
}

async function measureCancellation(port: number, targetState: TargetState): Promise<number> {
  const startedAt = performance.now();
  await withTimeout(
    new Promise<void>((resolveCancel, reject) => {
      const request = httpRequest(`http://127.0.0.1:${port}/cancel`, (response) => {
        debug("caller cancel response.head");
        response.once("data", () => {
          debug("caller cancel response chunk");
          request.destroy();
          resolveCancel();
        });
      });
      request.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
      });
      request.end();
    }),
    "caller cancellation",
  );
  await withTimeout(targetState.cancelObserved.promise, "target cancellation cleanup", 2_000);
  return performance.now() - startedAt;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function runScenarios(
  egressPort: number,
  metrics: PrototypeMetrics,
  targetState: TargetState,
): Promise<ScenarioResult> {
  for (let index = 0; index < HANDSHAKE_SAMPLES; index += 1) {
    const response = await fetch(`http://127.0.0.1:${egressPort}/echo`);
    assert(response.ok, `Handshake sample ${index + 1} failed`);
    await response.arrayBuffer();
  }

  const jsonBody = Buffer.from(JSON.stringify({ tunnel: "prototype", unicode: "流式" }));
  const json = await requestJson(egressPort, "/echo", jsonBody, "application/json");
  assert(json.bytes === jsonBody.byteLength, "JSON byte count changed");
  assert(json.sha256 === createHash("sha256").update(jsonBody).digest("hex"), "JSON body changed");

  const binaryBody = Buffer.alloc(2 * 1024 * 1024);
  for (let index = 0; index < binaryBody.byteLength; index += 1) binaryBody[index] = index % 251;
  const binary = await requestJson(egressPort, "/echo", binaryBody, "application/octet-stream");
  assert(binary.bytes === binaryBody.byteLength, "Binary byte count changed");
  assert(
    binary.sha256 === createHash("sha256").update(binaryBody).digest("hex"),
    "Binary body changed",
  );

  const sse = await measureSse(egressPort);
  assert(sse.firstEventMs > 0 && sse.firstEventMs < sse.endMs - 150, "SSE was buffered until end");

  const runRequestBackpressure = async (mode: FlowControlMode): Promise<BackpressureResult> => {
    metrics.receiveQueuePeakBytes = 0;
    metrics.sendBufferedPeakBytes = 0;
    const slow = await measureSlowUpload(egressPort, mode);
    assert(slow.result.bytes === SLOW_UPLOAD_BYTES, `${mode} slow upload lost bytes`);
    assert(
      metrics.slowForwardBytes[mode] === SLOW_UPLOAD_BYTES,
      `${mode} Egress did not forward every slow byte`,
    );
    assert(
      metrics.receiveQueuePeakBytes <= RECEIVE_HIGH_WATER_BYTES + FRAME_BYTES * 2,
      `${mode} receive queue was unbounded`,
    );
    return {
      callerWriteMs: slow.callerWriteMs,
      callerDrainEvents: slow.drainEvents,
      egressForwardMs: metrics.slowForwardMs[mode],
      targetConsumeMs: targetState.slowConsumeMs[mode],
      receiveQueuePeakBytes: metrics.receiveQueuePeakBytes,
      sendBufferedPeakBytes: metrics.sendBufferedPeakBytes,
    };
  };
  const requestWithoutFlowControl = await runRequestBackpressure("uncontrolled");
  const requestWithFlowControl = await runRequestBackpressure("controlled");
  assert(
    requestWithFlowControl.egressForwardMs >= requestWithFlowControl.targetConsumeMs * 0.7,
    "Chunk acknowledgements did not carry target backpressure to Egress",
  );

  const runResponseBackpressure = async (
    mode: FlowControlMode,
  ): Promise<ResponseBackpressureResult> => {
    metrics.receiveQueuePeakBytes = 0;
    metrics.sendBufferedPeakBytes = 0;
    const slow = await measureSlowDownload(egressPort, mode);
    assert(slow.bytes === SLOW_UPLOAD_BYTES, `${mode} slow download lost bytes`);
    assert(
      metrics.slowResponseForwardBytes[mode] === SLOW_UPLOAD_BYTES,
      `${mode} Ingress did not forward every slow response byte`,
    );
    return {
      callerConsumeMs: slow.callerConsumeMs,
      ingressForwardMs: metrics.slowResponseForwardMs[mode],
      targetProduceMs: targetState.slowProduceMs[mode],
      receiveQueuePeakBytes: metrics.receiveQueuePeakBytes,
      sendBufferedPeakBytes: metrics.sendBufferedPeakBytes,
    };
  };
  const responseWithoutFlowControl = await runResponseBackpressure("uncontrolled");
  const responseWithFlowControl = await runResponseBackpressure("controlled");
  assert(
    responseWithFlowControl.ingressForwardMs >= responseWithFlowControl.callerConsumeMs * 0.7,
    "Response acknowledgements did not carry caller backpressure to Ingress",
  );

  const targetObservedMs = await measureCancellation(egressPort, targetState);
  const cleanupDeadline = Date.now() + 2_000;
  while (metrics.activeDataConnections !== 0 && Date.now() < cleanupDeadline) await sleep(10);
  assert(metrics.activeDataConnections === 0, "Cancelled data connection did not close");

  return {
    json,
    binary,
    sse,
    backpressure: {
      request: {
        bytes: SLOW_UPLOAD_BYTES,
        withoutFlowControl: requestWithoutFlowControl,
        withFlowControl: requestWithFlowControl,
      },
      response: {
        bytes: SLOW_UPLOAD_BYTES,
        withoutFlowControl: responseWithoutFlowControl,
        withFlowControl: responseWithFlowControl,
      },
    },
    cancellation: {
      targetObservedMs,
      activeConnectionsAfter: metrics.activeDataConnections,
    },
  };
}

async function main(): Promise<void> {
  const metrics: PrototypeMetrics = {
    handshakesMs: [],
    dataConnectionsOpened: 0,
    dataConnectionsClosed: 0,
    activeDataConnections: 0,
    peakDataConnections: 0,
    receiveQueuePeakBytes: 0,
    sendBufferedPeakBytes: 0,
    slowForwardMs: { controlled: 0, uncontrolled: 0 },
    slowForwardBytes: { controlled: 0, uncontrolled: 0 },
    slowResponseForwardMs: { controlled: 0, uncontrolled: 0 },
    slowResponseForwardBytes: { controlled: 0, uncontrolled: 0 },
    targetCancelObservedMs: 0,
  };
  const targetState: TargetState = {
    slowConsumeMs: { controlled: 0, uncontrolled: 0 },
    slowProduceMs: { controlled: 0, uncontrolled: 0 },
    cancelObserved: deferred<number>(),
  };
  const relay = await resolveRelayHarness();
  const target = await startTarget(targetState);
  const keyPair = generateKeyPair();
  const serverId = `tunnel-prototype-${randomUUID()}`;
  const ingress = startIngressControl(
    relay.websocketBaseUrl,
    target.port,
    serverId,
    keyPair,
    metrics,
  );
  let egress: ManagedServer | null = null;
  try {
    await ingress.ready;
    egress = await startEgress(
      relay.websocketBaseUrl,
      serverId,
      exportPublicKey(keyPair.publicKey),
      metrics,
    );
    const scenarios = await runScenarios(egress.port, metrics, targetState);
    const result = {
      verdict: "FEASIBLE_WITH_PROTOCOL_FLOW_CONTROL",
      question: "One relay WebSocket + E2EE channel per HTTP request",
      environment: {
        node: process.version,
        relay: relay.description,
        frameBytes: FRAME_BYTES,
        flowWindowChunks: FLOW_WINDOW_CHUNKS,
        handshakeSamples: metrics.handshakesMs.length,
      },
      handshakeMs: {
        min: Math.min(...metrics.handshakesMs),
        p50: percentile(metrics.handshakesMs, 0.5),
        p95: percentile(metrics.handshakesMs, 0.95),
        max: Math.max(...metrics.handshakesMs),
      },
      connections: {
        opened: metrics.dataConnectionsOpened,
        closed: metrics.dataConnectionsClosed,
        peakConcurrent: metrics.peakDataConnections,
        activeAfter: metrics.activeDataConnections,
      },
      ...scenarios,
      architectureConstraint:
        "Awaiting WebSocket/EncryptedChannel send does not carry target backpressure through the relay. Production needs bounded plaintext queues plus an application-level credit/ack window in both streaming directions.",
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (egress) await egress.close();
    await ingress.stop();
    await target.close();
    await relay.stop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
