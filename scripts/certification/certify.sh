#!/usr/bin/env bash
# VAARG V1 P00 — local certification runner.
# Runs the reproducible local gates that do not require external providers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EVIDENCE_DIR="docs/production/missions/P00/evidence"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="$EVIDENCE_DIR/p00-local-$STAMP.log"

log() { printf '%s\n' "$*" | tee -a "$EVIDENCE"; }

log "=== VAARG V1 P00 local certification ==="
log "Started: $STAMP"
log "Node: $(node -v)"
log "pnpm: $(pnpm -v)"
log "Git HEAD: $(git rev-parse HEAD)"
log ""

run_step() {
  local name="$1"; shift
  log "--- $name ---"
  if "$@"; then
    log "PASS: $name"
  else
    log "FAIL: $name"
    return 1
  fi
  log ""
}

run_step "frozen install" pnpm install --frozen-lockfile
run_step "lint" pnpm lint
run_step "typecheck" pnpm typecheck
run_step "unit tests" pnpm test
run_step "build" pnpm build

log "=== certification summary ==="
log "Evidence: $EVIDENCE"
log "Docker/live provider gates are executed by the external harness (Codex)."
log "Status: PASS_LOCAL_SOURCE"
