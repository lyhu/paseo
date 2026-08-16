import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";

interface TunnelRelayUrlOptions {
  endpoint: string;
  useTls: boolean;
  serverId: string;
  role: "client" | "server";
  connectionId?: string;
}

export function buildTunnelRelayUrl(options: TunnelRelayUrlOptions): string {
  if (!options.endpoint.includes("://")) {
    return buildRelayWebSocketUrl({
      endpoint: options.endpoint,
      useTls: options.useTls,
      serverId: options.serverId,
      role: options.role,
      connectionId: options.connectionId,
      version: 2,
    });
  }

  const url = new URL(options.endpoint);
  url.protocol = options.useTls ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  url.searchParams.set("serverId", options.serverId);
  url.searchParams.set("role", options.role);
  url.searchParams.set("v", "2");
  if (options.connectionId) url.searchParams.set("connectionId", options.connectionId);
  return url.toString();
}
