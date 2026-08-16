# HTTP Tunnel implementation validation

## Local relay

Run the production Ingress and Egress runtimes through the relay at port 8481:

```bash
PASEO_TUNNEL_RELAY_URL=http://127.0.0.1:8481 \
  npm run validate:tunnel-local-relay --workspace=@getpaseo/server
```

Observed on 2026-08-16:

| Check                             |                                              Result |
| --------------------------------- | --------------------------------------------------: |
| JSON request/response             |                                              passed |
| Binary body                       |                              2 MiB, SHA-256 matched |
| SSE first event                   |                                            47.31 ms |
| 32 MiB upload                     |                caller 2957.88 ms; target 2925.53 ms |
| 32 MiB download                   |                caller 1461.88 ms; target 1291.58 ms |
| Caller cancellation               | propagated in 40.35 ms; target observed in 27.92 ms |
| OpenAI-compatible JSON            |                                              passed |
| OpenAI-compatible SSE first event |                                             9.02 ms |
| OpenAI-compatible `[DONE]`        |                                              passed |

Re-run after the production review fixes on 2026-08-16:

| Check                             |                                              Result |
| --------------------------------- | --------------------------------------------------: |
| JSON request/response             |                                              passed |
| Binary body                       |                              2 MiB, SHA-256 matched |
| SSE first event                   |                                            52.36 ms |
| 32 MiB upload                     |                caller 2974.02 ms; target 2925.77 ms |
| 32 MiB download                   |                caller 1450.26 ms; target 1274.41 ms |
| Caller cancellation               | propagated in 38.35 ms; target observed in 28.82 ms |
| OpenAI-compatible JSON            |                                              passed |
| OpenAI-compatible SSE first event |                                             7.84 ms |
| OpenAI-compatible `[DONE]`        |                                              passed |

Final post-review run on 2026-08-16 against the local relay on port 8481:

| Check                             |                                              Result |
| --------------------------------- | --------------------------------------------------: |
| JSON request/response             |                                              passed |
| Binary body                       |                              2 MiB, SHA-256 matched |
| SSE first event                   |                                            46.65 ms |
| 32 MiB upload                     |                caller 2900.48 ms; target 2875.91 ms |
| 32 MiB download                   |                caller 1441.64 ms; target 1261.00 ms |
| Caller cancellation               | propagated in 33.99 ms; target observed in 24.73 ms |
| OpenAI-compatible JSON            |                                              passed |
| OpenAI-compatible SSE first event |                                             4.79 ms |
| OpenAI-compatible `[DONE]`        |                                              passed |

The command starts separate Ingress and Egress subsystems, a generic HTTP
fixture, and an OpenAI-compatible chat-completions fixture. The request and
response runtimes use real relay v2 WebSockets and E2EE channels. The timing
values are validation observations, not relay capacity benchmarks.

## Focused regression suite

```bash
npx vitest run \
  packages/server/src/server/tunnel/relay-url.test.ts \
  packages/server/src/server/tunnel/ingress-runtime.test.ts \
  packages/server/src/server/tunnel/egress-runtime.test.ts \
  packages/server/src/server/tunnel/subsystem.test.ts \
  packages/server/src/server/tunnel/tunnel-e2e.test.ts \
  packages/server/src/server/daemon-config-store.test.ts \
  --bail=1
```

Final result: 9 files and 82 tests passed. This covers relay endpoint formats,
control reconnect, E2EE-ready timeout, JSON, binary bodies, SSE, headers,
authentication, cancellation, fixed errors, persisted recovery, entry fault
isolation, invalid frame ordering, wrong ACK rejection, peer-close error races, and preservation of
Tunnel mutations when an adjacent daemon configuration patch rolls back.

The focused App/Client run passed 3 files and 121 tests. A targeted Playwright
test also passed against an isolated real daemon and browser. It holds one real
mutation request to observe the pending state, forces a real listener bind
failure, retries from the preserved form, and verifies the one-time token and
clipboard feedback:

```bash
npm run test:e2e --workspace=@getpaseo/app -- tunnel-settings.spec.ts
```

Final localized-UI result: 1 test passed in 12.7 seconds.

## Architecture conclusion

Keep one relay WebSocket and one E2EE channel per HTTP request for v1. The
production path preserves streaming semantics and cancellation and bounds each
body direction to eight unacknowledged 64 KiB chunks. A fixed E2EE-ready
deadline prevents an offline Ingress from hanging callers. The Ingress control
connection reconnects independently, so relay interruption does not require a
daemon restart.

## Docker

The official base Dockerfile needs enough memory for the bundled Expo web app.
The build failed with Node heap exhaustion at 1.0-1.4 GiB and with a kernel OOM
under a 2 GiB Colima VM. Set Colima to 4 GiB before building:

```bash
colima stop
colima start --memory 4 --cpu 2
docker start paseo-relay-local hexa-fold-postgres
```

Build with the host proxy reachable from Colima:

```bash
docker build --progress=plain \
  --add-host host.lima.internal:192.168.5.2 \
  --build-arg HTTP_PROXY=http://host.lima.internal:7890 \
  --build-arg HTTPS_PROXY=http://host.lima.internal:7890 \
  --build-arg ALL_PROXY=socks5://host.lima.internal:7890 \
  -f docker/base/Dockerfile \
  -t paseo:http-tunnel-local .
```

Final localized-UI build passed. The image ID was
`sha256:e9743c93b8d3ed7b0acd32c90d53a40971136b39aed9c18ac5ee49671e74add9`
and its unpacked Docker size was 289,786,760 bytes.

Start a target fixture and the built Paseo image on an isolated network. The
checked-in scratch config points both Ingress and Egress at the local relay
through `host.lima.internal:8481`.

```bash
docker network create paseo-tunnel-validation

docker run -d --name tunnel-target \
  --network paseo-tunnel-validation \
  -v "$PWD/.scratch/http-tunnel/docker-target.mjs:/fixture.mjs:ro" \
  node:22-bookworm-slim node /fixture.mjs

docker run -d --name paseo-tunnel-validation \
  --network paseo-tunnel-validation \
  --add-host host.lima.internal:192.168.5.2 \
  -p 8687:6767 -p 8787:8787 \
  -e PASEO_PASSWORD=validation-password \
  -v "$PWD/.scratch/http-tunnel/docker-config.json:/home/paseo/.paseo/config.json:ro" \
  paseo:http-tunnel-local

curl --fail http://127.0.0.1:8687/api/health
curl --fail -H 'content-type: application/json' \
  --data '{"hello":"docker"}' \
  http://127.0.0.1:8787/json
head -c 2097152 /dev/zero | curl --fail \
  -H 'content-type: application/octet-stream' \
  --data-binary @- http://127.0.0.1:8787/binary
curl --fail -N http://127.0.0.1:8787/sse
curl --fail -H 'content-type: application/json' \
  --data '{"model":"fixture","messages":[{"role":"user","content":"ping"}]}' \
  http://127.0.0.1:8787/v1/chat/completions
curl --fail -N -H 'content-type: application/json' \
  --data '{"model":"fixture","stream":true,"messages":[{"role":"user","content":"ping"}]}' \
  http://127.0.0.1:8787/v1/chat/completions
```

Observed on 2026-08-16:

| Check                  | Result                                              |
| ---------------------- | --------------------------------------------------- |
| Image daemon health    | `{"status":"ok"}`; Docker health `healthy`          |
| Generic JSON           | `{"method":"POST","body":{"hello":"docker"}}`       |
| Binary                 | 2 MiB; SHA-256 `5647f05e...e9b31eee` matched input  |
| Generic SSE            | first and done events streamed                      |
| OpenAI-compatible JSON | `chat.completion` with `pong` passed                |
| OpenAI-compatible SSE  | `chat.completion.chunk` followed by `[DONE]` passed |

Remove only the validation resources when finished:

```bash
docker rm -f paseo-tunnel-validation tunnel-target
docker network rm paseo-tunnel-validation
```
