import { request as createRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export async function forwardHttpRequest(options: {
  request: IncomingMessage;
  response: ServerResponse;
  origin: string;
}): Promise<void> {
  const origin = new URL(options.origin);
  const connectionHeaders = connectionHeaderNames(options.request.headers.connection);
  const headers = sanitizeHeaders(options.request.headers, connectionHeaders);
  const path = options.request.url ?? "/";
  const upstream = createRequest({
    protocol: origin.protocol,
    hostname: origin.hostname,
    port: origin.port || undefined,
    method: options.request.method,
    path,
    headers,
  });

  upstream.once("response", (upstreamResponse) => {
    if (options.response.destroyed) {
      upstreamResponse.destroy();
      return;
    }
    options.response.writeHead(
      upstreamResponse.statusCode ?? 502,
      sanitizeHeaders(upstreamResponse.headers),
    );
    void pipeline(upstreamResponse, options.response).catch(() => options.response.destroy());
  });
  upstream.once("error", () => {
    if (!options.response.headersSent) options.response.writeHead(502);
    if (!options.response.writableEnded) options.response.end("Tunnel upstream unavailable");
  });
  options.request.once("aborted", () => upstream.destroy());
  options.response.once("close", () => upstream.destroy());
  await pipeline(options.request, upstream);
}

function connectionHeaderNames(value: string | string[] | undefined): Set<string> {
  const names = new Set<string>();
  for (const item of Array.isArray(value) ? value : [value]) {
    for (const name of item?.split(",") ?? []) names.add(name.trim().toLowerCase());
  }
  return names;
}

function sanitizeHeaders(
  headers: IncomingMessage["headers"] | Record<string, string | string[] | number | undefined>,
  connectionHeaders = new Set<string>(),
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined ||
      normalized === "host" ||
      normalized === "x-paseo-access-token" ||
      HOP_BY_HOP_HEADERS.has(normalized) ||
      connectionHeaders.has(normalized)
    ) {
      continue;
    }
    result[name] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return result;
}
