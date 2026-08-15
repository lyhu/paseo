# 01 — Deliver an encrypted generic HTTP Tunnel path

**What to build:** A caller can send one HTTP/1.1 request to an Egress and receive the fixed Ingress origin response through relay v2 and E2EE, without being able to pick the origin.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] One Egress-to-Ingress request uses a new relay data connection and E2EE channel.
- [ ] Method, path, query, repeated end-to-end headers, JSON and binary bodies are preserved.
- [ ] CONNECT and Upgrade are rejected and hop-by-hop/Tunnel credential headers are not forwarded.
