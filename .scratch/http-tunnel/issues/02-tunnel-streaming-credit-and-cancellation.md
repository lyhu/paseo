# 02 — Bound streaming Tunnel traffic and stop cancelled requests

**What to build:** A caller can upload/download large bodies and receive SSE through Tunnel without body aggregation, while cancellation reaches the target and application credit bounds each direction.

**Blocked by:** 01 — Deliver an encrypted generic HTTP Tunnel path.

**Status:** ready-for-agent

- [ ] At most eight unacknowledged 64 KiB chunks are read in either direction.
- [ ] First SSE event arrives before response completion.
- [ ] Client cancellation closes the matching target request.
