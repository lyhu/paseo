# HTTP Tunnel implementation spec

The canonical published spec is pending a transient GitHub API EOF. This local
copy preserves the same ready-for-agent contract until publication succeeds.

## Problem Statement

Paseo users need to expose a fixed internal HTTP or HTTPS origin from one Host
through an Egress Host without exposing the daemon control plane or allowing
callers to choose an arbitrary internal target. Generic HTTP and
OpenAI-compatible APIs must retain streaming, binary bodies, SSE, cancellation,
and bounded memory across an untrusted relay.

## Solution

Implement the Host-scoped Tunnel in the design document. An Ingress maps a
route capability to one fixed origin; an Egress exposes one HTTP listener and
forwards all accepted requests through relay v2 and E2EE. The data plane keeps
one relay WebSocket plus one E2EE channel per request, with `request.ack` and
`response.ack`: at most eight unacknowledged 64 KiB chunks per direction.

## Implementation Decisions

- Relay deployment and wire contract remain unchanged; Tunnel owns its encrypted
  application protocol in new Tunnel modules.
- The HTTP caller-to-fixed-target path is the primary behavior seam. Tunnel wire
  and config seams cover public protocol and lifecycle contracts.
- Request and response bodies stream without aggregation. Preserve method,
  path, query, end-to-end and repeated headers; remove hop-by-hop headers and
  Tunnel credentials. Reject CONNECT and Upgrade.
- An Egress never accepts an origin from a caller. The relay sees ciphertext,
  never Route Offer secrets, HTTP headers, or HTTP body.
- Persisted configuration, sanitized state, Route Offer handling, access-token
  one-time disclosure, daemon reload/shutdown, capability-gated RPC, and Host
  settings follow the design document after the data-plane slice.
- Test fixtures comprise a generic HTTP service and an OpenAI-compatible
  chat-completions service with SSE streaming. Build and run the official-style
  Docker image as a final deployment proof.

## Testing Decisions

- Focused real E2E tests use actual HTTP servers, WebSockets, E2EE and the
  existing relay v2 contract; no mocked streams.
- Prove JSON, repeated headers, binary data, large streamed request/response
  credit behavior, first SSE event before completion, cancellation, and OpenAI
  streaming behavior.
- Run targeted tests, then build/typecheck/lint/format. Do not run the full
  suite locally.

## Out of Scope

Persistent/multiplexed channels, target selection, WebSocket Upgrade, HTTP/2,
gRPC, TLS termination, load balancing, caching, retries, policy controls,
access logs, and a tunnel CLI.

## Further Notes

The 2026-08-15 external relay prototype at `https://pa-relay.xf-yun.com`
measured 88.5–88.8 ms E2EE handshake p50, 102–107 ms p95, 144–163 ms SSE first
event, and 135–153 ms cancellation propagation. JSON and 2 MiB binary integrity
passed; all 20/20 data connections closed. See the prototype result for
reproduction commands and limitations.
