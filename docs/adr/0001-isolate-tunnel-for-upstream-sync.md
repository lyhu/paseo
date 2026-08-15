# Isolate Tunnel for upstream sync

Paseo Tunnel is an in-tree capability, but its implementation and tests live in new Tunnel-specific files with only additive integration hooks in existing modules. This accepts limited duplication of HTTP forwarding helpers instead of refactoring shared Service Proxy code, because this fork will continue merging `getpaseo/paseo` and reducing conflict surface is more valuable than maximizing local deduplication.
