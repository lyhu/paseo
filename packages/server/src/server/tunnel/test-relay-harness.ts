/**
 * In-process relay v2 harness for tunnel testing.
 *
 * Implements the existing Paseo relay v2 contract without modifications.
 */

import { createServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { once } from "node:events";

export interface RelayHarness {
  httpBaseUrl: string;
  dropControlConnections: () => void;
  stop: () => Promise<void>;
}

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

export async function createInProcessRelay(): Promise<RelayHarness> {
  const sessions = new Map<string, RelaySession>();
  const peers = new WeakMap<WebSocket, RelayPeer>();
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

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

    wss.handleUpgrade(request, socket, head, (ws) => {
      const serverId = url.searchParams.get("serverId")!;
      const role = url.searchParams.get("role") === "client" ? "client" : "server";
      const connectionId = url.searchParams.get("connectionId") ?? "";
      const session = getSession(serverId);
      peers.set(ws, { role, serverId, connectionId });

      if (role === "server" && !connectionId) {
        // Control connection
        session.control?.close(1001, "replaced");
        session.control = ws;
        send(
          ws,
          JSON.stringify({ type: "sync", connectionIds: [...session.clients.keys()] }),
          false,
        );
      } else if (role === "client") {
        // Client data connection
        const clients = session.clients.get(connectionId) ?? new Set<WebSocket>();
        clients.add(ws);
        session.clients.set(connectionId, clients);
        if (session.control) {
          send(session.control, JSON.stringify({ type: "connected", connectionId }), false);
        }
      } else {
        // Server data connection
        session.servers.get(connectionId)?.close(1001, "replaced");
        session.servers.set(connectionId, ws);
        // Flush pending messages
        for (const frame of session.pending.get(connectionId) ?? []) {
          send(ws, frame.data, frame.isBinary);
        }
        session.pending.delete(connectionId);
      }

      ws.on("message", (raw: RawData, isBinary: boolean) => {
        const peer = peers.get(ws);
        if (!peer || !peer.connectionId) return;

        let frame: Buffer | string;
        if (isBinary) {
          frame = Buffer.from(raw as Buffer);
        } else if (typeof raw === "string") {
          frame = raw;
        } else {
          frame = Buffer.from(raw as Buffer).toString("utf8");
        }

        if (peer.role === "client") {
          // Forward to server
          const target = session.servers.get(peer.connectionId);
          if (target) {
            send(target, frame, isBinary);
          } else {
            // Buffer until server connects
            const pending = session.pending.get(peer.connectionId) ?? [];
            pending.push({ data: frame, isBinary });
            session.pending.set(peer.connectionId, pending);
          }
        } else {
          // Forward to all clients
          for (const target of session.clients.get(peer.connectionId) ?? []) {
            send(target, frame, isBinary);
          }
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

        // Client closed
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

  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const addr = httpServer.address();
  if (!addr || typeof addr === "string") throw new Error("Invalid relay address");

  return {
    httpBaseUrl: `http://127.0.0.1:${addr.port}`,
    dropControlConnections: () => {
      for (const session of sessions.values()) {
        session.control?.close(1012, "test relay restart");
      }
    },
    stop: async () => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
