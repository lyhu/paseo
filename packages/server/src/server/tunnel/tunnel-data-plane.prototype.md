# Tunnel data-plane prototype

## Question

Can one relay WebSocket and E2EE channel per HTTP request preserve bodies and SSE, bound memory under slow peers, and clean up promptly after caller cancellation?

## Run

Local in-process relay contract:

```bash
npm run prototype:tunnel-data-plane --workspace=@getpaseo/server
```

An existing relay deployment:

```bash
PASEO_TUNNEL_PROTOTYPE_RELAY_URL=https://pa-relay.xf-yun.com \
  npm run prototype:tunnel-data-plane --workspace=@getpaseo/server
```

The command starts real Node HTTP servers and WebSockets, uses the existing `EncryptedChannel`, creates one data connection per request, verifies content hashes, and prints JSON measurements. It does not read or write daemon configuration.

## Result

**Verdict: feasible for v1 with protocol-level flow control.** Keep the per-request connection model. Add a bounded credit/ack window in both body directions before production implementation.

Two runs through `https://pa-relay.xf-yun.com` on 2026-08-15 produced:

| Measurement                            | Observed range |
| -------------------------------------- | -------------: |
| E2EE ready, p50                        |   88.5–88.8 ms |
| E2EE ready, p95                        | 102.3–107.0 ms |
| SSE first event                        | 144.4–162.8 ms |
| SSE stream end                         | 413.9–435.0 ms |
| Caller cancellation observed by target | 135.0–152.5 ms |
| Completed data connections             |  20/20 per run |
| Active connections after completion    |              0 |

The target intentionally waits 40 ms before its first SSE event and 250 ms before ending. The relay runs therefore add about 104–123 ms before the first event. JSON and 2 MiB binary bodies arrived with the expected byte counts and SHA-256 hashes in every run.

### Backpressure finding

Awaiting `WebSocket.send`, awaiting `EncryptedChannel.send`, and watching `bufferedAmount` do not carry downstream backpressure across a relay. The in-process stress case made the failure visible:

| 32 MiB direction                      | No protocol flow control | 8 × 64 KiB credit window |                  Slow endpoint |
| ------------------------------------- | -----------------------: | -----------------------: | -----------------------------: |
| Request: Egress finished forwarding   |                   0.35 s |                   2.70 s | target consumed in 2.88–3.09 s |
| Response: Ingress finished forwarding |                   0.31 s |                   2.76 s | caller consumed in 2.94–3.07 s |

Without credit, the sender can finish while the endpoint is still slow because the relay, kernel, or WebSocket implementation owns the queued bytes. Pausing the receiver keeps its application queue bounded but does not bound those upstream queues.

The prototype adds `request.ack` and `response.ack` and permits eight unacknowledged 64 KiB chunks per direction. The sender stops reading its HTTP stream when the window is full. On the external relay, controlled request forwarding tracked target consumption and controlled response forwarding tracked caller consumption. Observed plaintext queues stayed between 64 and 192 KiB, below the 512 KiB credit ceiling.

## Architecture decision

- Keep one data WebSocket and E2EE channel per HTTP request for v1.
- Add symmetric request/response chunk acknowledgements with a fixed eight-chunk initial window.
- Do not claim backpressure from `send` completion or `bufferedAmount` alone.
- Keep 64 KiB as the maximum plaintext chunk.
- Revisit persistent connections or multiplexing only if production latency or concurrency requirements reject the measured per-request setup cost. This prototype did not benchmark high concurrency.

The external numbers include network and relay latency and are not a relay capacity benchmark. The in-process relay implements the existing v2 routing contract with real WebSockets; it is not the deployed relay implementation.
