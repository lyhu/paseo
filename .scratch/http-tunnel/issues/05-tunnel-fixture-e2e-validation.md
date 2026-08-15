# 05 — Validate generic and OpenAI-compatible services through Tunnel

**What to build:** Operators can reproduce end-to-end generic HTTP and OpenAI-compatible streaming tests through a real relay path.

**Blocked by:** 02 — Bound streaming Tunnel traffic and stop cancelled requests; 03 — Persist and safely administer Tunnel routes.

**Status:** ready-for-agent

- [ ] Generic fixture validates JSON, binary data, duplicate headers, SSE, backpressure and cancellation.
- [ ] OpenAI-compatible fixture validates chat-completions JSON and streamed SSE through Egress.
- [ ] External relay reproduction records commands and result data without claiming capacity conclusions.
