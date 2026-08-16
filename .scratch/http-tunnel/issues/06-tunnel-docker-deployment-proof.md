# 06 — Prove Tunnel in the official Docker image path

**What to build:** The locally built official-style Paseo image exposes the same daemon Tunnel behavior and passes a container deployment smoke test.

**Blocked by:** 05 — Validate generic and OpenAI-compatible services through Tunnel.

**Status:** complete

- [x] The official Dockerfile builds with Tunnel code included.
- [x] A containerized daemon is configured and receives an HTTP request through Tunnel fixtures.
- [x] Build/run commands and observed output are recorded.
