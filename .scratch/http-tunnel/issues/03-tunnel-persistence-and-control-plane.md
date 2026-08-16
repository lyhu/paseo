# 03 — Persist and safely administer Tunnel routes

**What to build:** Administrators can persist Ingress/Egress configuration, import/export route authorization, change routes, and recover enabled routes after daemon restart or reload.

**Blocked by:** 01 — Deliver an encrypted generic HTTP Tunnel path.

**Status:** complete

- [x] Strict persisted configuration uses serialized ID-scoped mutation and sanitized snapshots.
- [x] Route Offers and access tokens are separate secrets; plaintext token disclosure is one-time.
- [x] Runtime lifecycle starts/stops/reloads from the complete snapshot and safe failures return 502.
