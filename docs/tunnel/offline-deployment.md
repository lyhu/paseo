# Offline Deployment Package

## Problem

The remote Ingress daemon runs inside Docker, which isolates it from the host's `$PATH`. Code agents (Claude Code, Codex, OpenCode) installed on the host are invisible to the daemon because `findExecutable("claude")` searches the container's `$PATH`, not the host's. The same problem applies to file system access and agent credentials.

## Solution: Unified Offline CLI Package

Ship a single self-contained tarball containing the modified daemon + CLI + web UI. Install it directly on the host (no Docker) on both the remote server (Ingress) and the local workstation (Egress). The mobile app continues to use the official release.

### Architecture

```
Remote Server (Ingress) / Local Workstation (Egress)
  ┌──────────────────────────────────────────────────────┐
  │  paseo daemon start --web-ui --relay --port 6768     │
  │                                                      │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ Offline CLI Package (same tarball everywhere)   │  │
  │  │  - @getpaseo/server (modified)                 │  │
  │  │  - @getpaseo/cli                              │  │
  │  │  - web UI static assets (embedded)              │  │
  │  │  - No speech/voice dependencies                │  │
  │  │  - Default port: 6768                        │  │
  │  │  - PASEO_HOME: ~/.paseo-tunnel (auto)      │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                      │
  │  Agent discovery: host $PATH (claude, codex, etc.)   │
  │  File system: direct access to host directories         │
  │  Credentials: reads ~/.claude/, ~/.codex/ directly   │
  └──────────────────────┬───────────────────────────────┘
                         │ relay
  ┌──────────────────────▼───────────────────────────────┐
  │ Mobile App (official release)                         │
  │  - Connects via relay to remote daemon               │
  │  - Remote coding, vibe coding                        │
  │  - Stays on official version, auto-updates           │
  └──────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Single package, no variants.** Ingress and Egress use the identical tarball. No separate "server edition" or "desktop edition".

2. **Default port 6768.** Avoids conflict with the official daemon (6767). Both can run on the same machine.

3. **No speech/voice.** Strips `sherpa-onnx-node` and all speech-related code. Reduces package size significantly.

4. **Protocol compatibility.** The modified daemon does not touch `packages/protocol/`, `packages/relay/`, or `packages/client/`. The mobile app communicates via standard WebSocket RPC and relay wire contract — it cannot distinguish the modified daemon from the official one.

5. **Upstream merge strategy.** Only `packages/server/` and `packages/cli/` are modified. Protocol, relay, and client packages stay untouched, keeping merge conflicts minimal when pulling upstream releases.

### Usage

```bash
# Install (requires Node.js 18+)
npm install -g ./paseo-server-0.4.0-linux-x64.tar.gz

# Start daemon (remote server, with relay)
paseo daemon start --web-ui --relay --port 6768 --foreground

# Start daemon (local workstation, web UI only)
paseo daemon start --web-ui --port 6768 --foreground

# Open browser
open http://127.0.0.1:6768
```

### systemd Service (Remote Server)

```ini
# /etc/systemd/system/paseo-daemon.service
[Unit]
Description=Paseo Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/paseo daemon start --foreground --web-ui --relay --port 6768
Restart=always
User=paseo
Environment=PASEO_HOME=/var/lib/paseo

[Install]
WantedBy=multi-user.target
```

### Upgrade Flow

```
Upstream releases new version
  │
  ▼
Merge into modified branch (server/ + cli/ only)
  │
  ▼
Rebuild offline package
  │
  ▼
Remote server: npm install -g ./new-package.tar.gz && restart daemon
Local workstation: npm install -g ./new-package.tar.gz && restart daemon
Mobile: auto-updates via App Store (official version, no action needed)
```

### Package Contents

```
paseo-server-<version>-<platform>-<arch>.tar.gz (~130 MB compressed)
  ├── package/
  │   ├── package.json              # Wrapper package.json for npm install -g
  │   ├── package-lock.json
  │   ├── bin/paseo               # CLI entry point
  │   ├── dist/                   # Compiled server code + web UI
  │   │   ├── server/
  │   │   │   ├── server/         # Daemon code
  │   │   │   └── web-ui/        # Web UI static assets
  │   │   └── scripts/           # Supervisor entrypoint
  │   ├── cli-dist/              # Compiled CLI code
  │   ├── local-packages/        # Bundled workspace packages
  │   │   ├── protocol/
  │   │   ├── client/
  │   │   ├── highlight/
  │   │   ├── relay/
  │   │   └── plugin/
  │   └── node_modules/         # Pruned production dependencies
```

### Build Script

The offline package is built by `scripts/build-offline-package.sh`:

```bash
# Build the offline package
./scripts/build-offline-package.sh

# Output: dist-offline/paseo-server-<version>-<platform>-<arch>.tar.gz
```

The build script:
1. Builds all workspace dependencies (protocol, client, highlight, plugin, relay)
2. Builds the server (TypeScript compilation)
3. Builds the CLI
4. Builds the web UI (Expo export)
5. Strips speech/voice code and source maps
6. Bundles local workspace packages as `file:` dependencies
7. Installs production `node_modules`
8. Creates the final tarball

### What's Stripped vs Official

| Component | Official | Offline Package |
|-----------|----------|----------------|
| Default port | 6767 | 6768 |
| Speech/voice | sherpa-onnx-node, speech config | Removed |
| Web UI | Bundled | Bundled (same) |
| Agent providers | All | All (same) |
| Relay | Supported | Supported (same) |
| Protocol | Standard | Standard (compatible) |
| Docker | Supported | Not required |

### Security

- Set `PASEO_PASSWORD` when listening on `0.0.0.0` to prevent unauthorized access.
- The daemon respects the same auth model as the official release.
- Relay connections are E2E encrypted (same as official).
