#!/usr/bin/env bash
set -euo pipefail

# Build an offline Paseo daemon package (default port 6768, PASEO_HOME=~/.paseo-tunnel).
# Usage: ./scripts/build-offline-package.sh [--output-dir <dir>]
#
# Produces: paseo-server-<version>-<platform>-<arch>.tar.gz
#
# The tarball contains everything needed to run the daemon:
#   - Compiled server code
#   - Compiled CLI code
#   - Web UI static assets
#   - All production dependencies (including local workspace packages)
#   - A wrapper package.json for npm install -g

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Config ──────────────────────────────────────────────────────────────────
OUTPUT_DIR="${OUTPUT_DIR:-dist-offline}"
VERSION="$(node -p "require('./package.json').version")"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
PACKAGE_NAME="paseo-server-${VERSION}-${PLATFORM}-${ARCH}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Building offline package: ${PACKAGE_NAME}"

# ── Step 1: Build dependencies ────────────────────────────────────────────
echo "==> [1/6] Building server dependencies (protocol, client, highlight, plugin, relay)..."
npm run build:server-deps

# ── Step 2: Build server ──────────────────────────────────────────────────
echo "==> [2/6] Building server..."
npm run build --workspace=@getpaseo/server

# ── Step 3: Build CLI ────────────────────────────────────────────────────
echo "==> [3/6] Building CLI..."
npm run build --workspace=@getpaseo/cli

# ── Step 4: Build web UI ────────────────────────────────────────────────
echo "==> [4/6] Building web UI..."
node scripts/build-daemon-web-ui.mjs

# ── Step 5: Assemble package ────────────────────────────────────────────
echo "==> [5/6] Assembling package..."

PKG_DIR="$WORK_DIR/package"
mkdir -p "$PKG_DIR"

# Copy server dist
cp -r packages/server/dist "$PKG_DIR/dist"

# Copy CLI dist + bin
cp -r packages/cli/dist "$PKG_DIR/cli-dist"
cp -r packages/cli/bin/. "$PKG_DIR/bin/"
# Remove the old "paseo" bin (we use "paseo-tunnel" to avoid conflict)
rm -f "$PKG_DIR/bin/paseo"

# Speech/voice support is included in the offline package.
# The sherpa runtime env import and speech dist files are kept as-is.
# (No patching or removal needed.)

# Remove source maps to reduce size
find "$PKG_DIR/dist" -name '*.map' -delete 2>/dev/null || true
find "$PKG_DIR/cli-dist" -name '*.map' -delete 2>/dev/null || true

# Remove type declaration files (not needed at runtime)
find "$PKG_DIR/dist" -name '*.d.ts' -delete 2>/dev/null || true
find "$PKG_DIR/cli-dist" -name '*.d.ts' -delete 2>/dev/null || true
find "$PKG_DIR/dist" -name '*.d.ts.map' -delete 2>/dev/null || true
find "$PKG_DIR/cli-dist" -name '*.d.ts.map' -delete 2>/dev/null || true

# Remove test files from dist
find "$PKG_DIR/dist" -name '*.test.*' -delete 2>/dev/null || true
find "$PKG_DIR/dist" -name '*.spec.*' -delete 2>/dev/null || true
find "$PKG_DIR/dist" -name '*.e2e.*' -delete 2>/dev/null || true

# Remove daemon-e2e directory
rm -rf "$PKG_DIR/dist/server/server/daemon-e2e" 2>/dev/null || true

# Copy local workspace packages that the server depends on
# These are private packages not published to npm
mkdir -p "$PKG_DIR/local-packages"
for pkg in protocol client highlight relay plugin; do
  echo "  -> Bundling @getpaseo/${pkg}..."
  mkdir -p "$PKG_DIR/local-packages/${pkg}"
  cp -r "packages/${pkg}/dist" "$PKG_DIR/local-packages/${pkg}/dist" 2>/dev/null || true
  cp "packages/${pkg}/package.json" "$PKG_DIR/local-packages/${pkg}/package.json"
done

# Also bundle @getpaseo/server for CLI's open command
echo "  -> Bundling @getpaseo/server..."
mkdir -p "$PKG_DIR/local-packages/server"
cat > "$PKG_DIR/local-packages/server/package.json" << 'SERVERPKG'
{
  "name": "@getpaseo/server",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./dist/server/server/exports.js"
    },
    "./agent-hooks": {
      "default": "./dist/server/terminal/agent-hooks/provider-registry.js"
    },
    "./utils/tool-call-parsers": {
      "default": "./dist/server/utils/tool-call-parsers.js"
    }
  }
}
SERVERPKG
mkdir -p "$PKG_DIR/local-packages/server/dist"
cp -r "$PKG_DIR/dist/server" "$PKG_DIR/local-packages/server/dist/server"
cp -r "$PKG_DIR/dist/scripts" "$PKG_DIR/local-packages/server/dist/scripts"
cp -r "$PKG_DIR/dist/src" "$PKG_DIR/local-packages/server/dist/src"

# Create a wrapper bin script that sets PASEO_HOME before running the real CLI
# NOTE: The bin is named "paseo-tunnel" to avoid conflict with the official paseo CLI.
cat > "$PKG_DIR/bin/paseo-tunnel" << 'BINEOF'
#!/usr/bin/env bash
# Paseo-tunnel offline package wrapper
# Automatically sets PASEO_HOME to ~/.paseo-tunnel to avoid conflict with official daemon
LINK=$(readlink "$0" || echo "$0")
SCRIPT_DIR="$(cd "$(dirname "$0")" && cd "$(dirname "$LINK")" && pwd)"
export PASEO_HOME="${PASEO_HOME:-$HOME/.paseo-tunnel}"
exec node --disable-warning=DEP0040 "$SCRIPT_DIR/../cli-dist/index.js" "$@"
BINEOF
chmod +x "$PKG_DIR/bin/paseo-tunnel"

# Create the wrapper package.json with auto-merged dependencies from server + CLI
echo "==> Generating package.json with merged dependencies..."
node -e "
const srv = require('./packages/server/package.json');
const cli = require('./packages/cli/package.json');
const merged = { ...srv.dependencies, ...cli.dependencies };
// Remove workspace-local packages (they are bundled separately)
for (const k of Object.keys(merged)) {
  if (merged[k].startsWith('workspace:') || merged[k].startsWith('file:') || k.startsWith('@getpaseo/') || k.startsWith('@paseo/')) delete merged[k];
}
const pkg = {
  name: '@getpaseo/offline-server',
  version: '0.4.0',
  private: true,
  type: 'module',
  description: 'Paseo daemon offline package (default port 6768, PASEO_HOME=~/.paseo-tunnel, CLI renamed to paseo-tunnel)',
  bin: { 'paseo-tunnel': './bin/paseo-tunnel' },
  scripts: { start: 'node dist/scripts/supervisor-entrypoint.js' },
  dependencies: {
    '@getpaseo/client': 'file:./local-packages/client',
    '@getpaseo/highlight': 'file:./local-packages/highlight',
    '@getpaseo/protocol': 'file:./local-packages/protocol',
    '@getpaseo/relay': 'file:./local-packages/relay',
    '@getpaseo/server': 'file:./local-packages/server',
    '@paseo/plugin': 'file:./local-packages/plugin',
    ...merged,
  },
};
require('fs').writeFileSync('$PKG_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# ── Step 6: Install production dependencies ──────────────────────────────
echo "==> [6/6] Installing production dependencies..."
cd "$PKG_DIR"
npm install --production --no-audit --no-fund 2>&1 | tail -10
cd "$REPO_ROOT"

# ── Create tarball ────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"
TARBALL="$OUTPUT_DIR/${PACKAGE_NAME}.tar.gz"

cd "$WORK_DIR"
tar czf "$REPO_ROOT/$TARBALL" package/
cd "$REPO_ROOT"

# ── Report ────────────────────────────────────────────────────────────────
SIZE_MB="$(du -sh "$TARBALL" | cut -f1)"
echo ""
echo "==> Done: ${TARBALL} (${SIZE_MB})"
echo ""
echo "Install on target machine:"
echo "  tar xzf ${TARBALL}"
echo "  cd package && npm install -g ."
echo ""
echo "Start daemon:"
echo "  paseo-tunnel daemon start --web-ui --port 6768 --foreground"
echo ""
echo "With relay (remote server):"
echo "  paseo-tunnel daemon start --web-ui --relay --port 6768 --foreground"
