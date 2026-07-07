#!/usr/bin/env bash
# sgt integration smoke: drive the full metacognitive loop against the BUILT
# CLI with the fixture SGT_BIN (I5: no corpus, no network):
#   route -> advise -> expand -> advise -> judge -> trace (all 4 formats,
#   mermaid byte-compared to a checked-in snapshot) -> analyze --gate exit 0.
# Regenerate the snapshot with: UPDATE_SNAPSHOTS=1 npm run smoke:sgt
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/build/cli.js"
SNAPSHOT="$ROOT/tests/fixtures/sgt-bin/snapshots/smoke-trace-mermaid.txt"
QUERY="deploy kubernetes service"
SLUG="k8s-manifest-generator"
LONG_SLUG="kubernetes-deployment-creator--claude-specific--5eda8a52"
SPARSE="sparse-notes-skill"

if [ ! -f "$CLI" ]; then
  echo "smoke: build/cli.js missing — run \`npm run build\` first" >&2
  exit 1
fi
chmod +x "$ROOT"/tests/fixtures/sgt-bin/*.sh

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export AOT_STATE="$TMP/state.json"
export AOT_BR_AUTO=0
export SGT_BIN="$ROOT/tests/fixtures/sgt-bin/sgt-dispatch.sh"
export SGT_TIMEOUT_MS=5000

aot() { node "$CLI" "$@"; }
step() { echo "smoke: $*"; }
# assert_json <file> <node-expression over parsed payload `p`>
assert_json() {
  node -e '
const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (!eval(process.argv[2])) {
  console.error("smoke assertion failed: " + process.argv[2]);
  console.error(JSON.stringify(p, null, 2).slice(0, 2000));
  process.exit(1);
}' "$1" "$2"
}

step "route"
aot sgt route "$QUERY" --format json > "$TMP/route.json"
assert_json "$TMP/route.json" 'p.status === "success" && p.created === 6 && p.skillCount === 3'

step "advise (expects tier-1 expand)"
aot sgt advise --format json > "$TMP/advise1.json"
assert_json "$TMP/advise1.json" 'p.advice.some(a => a.action === "expand" && a.slug === "'"$SLUG"'")'

step "expand $SLUG"
aot sgt expand "$SLUG" --budget 1200 --format json > "$TMP/expand.json"
assert_json "$TMP/expand.json" 'p.status === "success" && p.excerptCount === 2 && p.evidence.length === 4'

step "advise (expects tier-2 judge)"
aot sgt advise --format json > "$TMP/advise2.json"
assert_json "$TMP/advise2.json" 'p.advice.some(a => a.action === "judge" && a.slug === "'"$SLUG"'")'

step "judge $SLUG --supports"
aot sgt judge "$SLUG" --supports=true --format json > "$TMP/judge.json"
assert_json "$TMP/judge.json" 'p.status === "success" && p.hypothesis.isVerified === true'

step "trace (tree/dot/canvas: tagged output)"
aot sgt trace --graphFormat tree > "$TMP/trace.tree"
grep -qF " [sgt:$SLUG]" "$TMP/trace.tree"
grep -qF " [sgt:$LONG_SLUG]" "$TMP/trace.tree"
aot sgt trace --graphFormat dot > "$TMP/trace.dot"
grep -qF " [sgt:$SLUG]" "$TMP/trace.dot"
aot sgt trace --graphFormat canvas > "$TMP/trace.canvas"
node -e '
const canvas = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const tagged = canvas.nodes.filter(n => /\nsgt:[a-z0-9-]+$/.test(n.text));
if (tagged.length !== 3) { console.error("smoke: expected 3 tagged canvas cards, got " + tagged.length); process.exit(1); }
' "$TMP/trace.canvas"

step "trace (mermaid: byte-compare against snapshot)"
aot sgt trace --graphFormat mermaid > "$TMP/trace.mmd"
if [ "${UPDATE_SNAPSHOTS:-0}" = "1" ]; then
  mkdir -p "$(dirname "$SNAPSHOT")"
  cp "$TMP/trace.mmd" "$SNAPSHOT"
  echo "smoke: snapshot updated at $SNAPSHOT"
fi
if ! cmp -s "$SNAPSHOT" "$TMP/trace.mmd"; then
  echo "smoke: mermaid trace deviates from snapshot $SNAPSHOT" >&2
  diff "$SNAPSHOT" "$TMP/trace.mmd" >&2 || true
  echo "smoke: regenerate intentionally with UPDATE_SNAPSHOTS=1 npm run smoke:sgt" >&2
  exit 1
fi

step "settle remaining hypotheses, then analyze --gate must exit 0"
aot sgt judge "$LONG_SLUG" --supports=true --format json > /dev/null
aot sgt judge "$SPARSE" --supports=true --format json > /dev/null
aot analyze --gate=true --weakThreshold 0.3 --format json > "$TMP/analyze.json"
assert_json "$TMP/analyze.json" 'p.gate.failed === false && p.gate.failOn === "all" && Array.isArray(p.gate.exempt)'

echo "smoke: OK"
