import {
  createClientChannel,
  exportPublicKey,
  generateKeyPair,
  type EncryptedChannel,
  type Transport,
} from "@getpaseo/relay/e2ee";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { WebSocket, type RawData } from "ws";
import { afterEach, describe, expect, test } from "vitest";
import { IngressRuntime, type IngressRuntimeStatus } from "./ingress-runtime.js";
import { createInProcessRelay, type RelayHarness } from "./test-relay-harness.js";
import { decodeTunnelFrame, encodeTunnelFrame, type TunnelFrame } from "./tunnel-wire.js";
import { buildTunnelRelayUrl } from "./relay-url.js";

describe("IngressRuntime", () => {
  let relay: RelayHarness | null = null;
  let runtime: IngressRuntime | null = null;
  let target: Server | null = null;

  afterEach(async () => {
    await runtime?.stop();
    await closeServer(target);
    await relay?.stop();
  });

  test("reconnects its control connection after the relay disconnects", async () => {
    relay = await createInProcessRelay();
    const statuses: IngressRuntimeStatus[] = [];
    runtime = new IngressRuntime({
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
      tunnelServerId: "reconnect-ingress",
      tunnelKeyPair: generateKeyPair(),
      routes: [],
      reconnectDelayMs: 10,
      readyTimeoutMs: 250,
      onStatus: (status) => statuses.push(status),
    });

    await runtime.start();
    expect(runtime.getStatus()).toBe("ready");

    relay.dropControlConnections();
    await waitForStatus(runtime, "connecting");
    await waitForStatus(runtime, "ready");

    expect(statuses).toEqual(["connecting", "ready", "connecting", "ready"]);
  });

  test("returns INVALID_REQUEST and closes when request.end arrives before request.head", async () => {
    relay = await createInProcessRelay();
    const keyPair = generateKeyPair();
    runtime = new IngressRuntime({
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
      tunnelServerId: "invalid-order-ingress",
      tunnelKeyPair: keyPair,
      routes: [],
    });
    await runtime.start();
    const peer = await connectTunnelClient({
      relayEndpoint: relay.httpBaseUrl,
      serverId: "invalid-order-ingress",
      publicKeyB64: exportPublicKey(keyPair.publicKey),
    });

    await peer.channel.send(encodeTunnelFrame({ v: 1, type: "request.end" }));

    expect(await peer.nextControlFrame).toEqual({
      v: 1,
      type: "error",
      code: "INVALID_REQUEST",
    });
    await waitForNoDataConnections(runtime);
    peer.close();
  });

  test("returns INVALID_REQUEST instead of deadlocking on a wrong response acknowledgement", async () => {
    relay = await createInProcessRelay();
    target = createServer((_request, response) => response.end(Buffer.alloc(100, 7)));
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Invalid target address");

    const keyPair = generateKeyPair();
    runtime = new IngressRuntime({
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
      tunnelServerId: "invalid-ack-ingress",
      tunnelKeyPair: keyPair,
      routes: [
        {
          routeId: "route_1",
          routeSecret: "secret_1",
          targetOrigin: `http://127.0.0.1:${address.port}`,
        },
      ],
    });
    await runtime.start();
    let peer: Awaited<ReturnType<typeof connectTunnelClient>>;
    peer = await connectTunnelClient({
      relayEndpoint: relay.httpBaseUrl,
      serverId: "invalid-ack-ingress",
      publicKeyB64: exportPublicKey(keyPair.publicKey),
      onBinary: (bytes) => {
        void peer.channel.send(encodeTunnelFrame({ v: 1, type: "response.ack", bytes: bytes - 1 }));
      },
    });
    await peer.channel.send(
      encodeTunnelFrame({
        v: 1,
        type: "request.head",
        method: "GET",
        path: "/",
        headers: [],
        routeId: "route_1",
        routeSecret: "secret_1",
        client: { address: "127.0.0.1", host: "caller.test", protocol: "http" },
      }),
    );
    await peer.channel.send(encodeTunnelFrame({ v: 1, type: "request.end" }));

    expect(await peer.nextErrorFrame).toEqual({
      v: 1,
      type: "error",
      code: "INVALID_REQUEST",
    });
    await waitForNoDataConnections(runtime);
    peer.close();
  });

  test("settles an invalid-request failure when the peer closes before the error frame", async () => {
    relay = await createInProcessRelay();
    const keyPair = generateKeyPair();
    runtime = new IngressRuntime({
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
      tunnelServerId: "closing-peer-ingress",
      tunnelKeyPair: keyPair,
      routes: [],
    });
    await runtime.start();
    const peer = await connectTunnelClient({
      relayEndpoint: relay.httpBaseUrl,
      serverId: "closing-peer-ingress",
      publicKeyB64: exportPublicKey(keyPair.publicKey),
    });

    await peer.sendAndTerminate(encodeTunnelFrame({ v: 1, type: "request.end" }));

    await waitForNoDataConnections(runtime);
  });
});

async function connectTunnelClient(input: {
  relayEndpoint: string;
  serverId: string;
  publicKeyB64: string;
  onBinary?: (bytes: number) => void;
}): Promise<{
  channel: EncryptedChannel;
  nextControlFrame: Promise<TunnelFrame>;
  nextErrorFrame: Promise<TunnelFrame>;
  sendAndTerminate(frame: string): Promise<void>;
  close(): void;
}> {
  const ws = new WebSocket(
    buildTunnelRelayUrl({
      endpoint: input.relayEndpoint,
      useTls: false,
      serverId: input.serverId,
      role: "client",
      connectionId: `malicious-${input.serverId}`,
    }),
    { perMessageDeflate: false },
  );
  await once(ws, "open");
  const transport = websocketTransport(ws);
  let resolveOpen!: () => void;
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  let resolveControl!: (frame: TunnelFrame) => void;
  const nextControlFrame = new Promise<TunnelFrame>((resolve) => {
    resolveControl = resolve;
  });
  let resolveError!: (frame: TunnelFrame) => void;
  const nextErrorFrame = new Promise<TunnelFrame>((resolve) => {
    resolveError = resolve;
  });
  const channel = await createClientChannel(transport, input.publicKeyB64, {
    onopen: resolveOpen,
    onmessage: (data) => {
      if (typeof data !== "string") {
        input.onBinary?.(data.byteLength);
        return;
      }
      const frame = decodeTunnelFrame(data);
      resolveControl(frame);
      if (frame.type === "error") resolveError(frame);
    },
  });
  await opened;
  return {
    channel,
    nextControlFrame,
    nextErrorFrame,
    async sendAndTerminate(frame) {
      await channel.send(frame);
      ws.terminate();
    },
    close: () => ws.close(),
  };
}

function websocketTransport(ws: WebSocket): Transport {
  const transport: Transport = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.on("message", (raw: RawData, isBinary) => {
    const buffer = Buffer.from(raw as Buffer);
    transport.onmessage?.({
      data: isBinary
        ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        : buffer.toString("utf8"),
      isBinary,
    });
  });
  ws.on("close", (code, reason) => transport.onclose?.(code, reason.toString()));
  ws.on("error", (error) => transport.onerror?.(error));
  return transport;
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitForNoDataConnections(runtime: IngressRuntime): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (runtime.getMetrics().activeDataConnections !== 0) {
    if (Date.now() >= deadline) throw new Error("Tunnel data connection did not close");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForStatus(
  runtime: IngressRuntime,
  expected: IngressRuntimeStatus,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (runtime.getStatus() !== expected) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Ingress status ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
