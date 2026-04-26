#!/usr/bin/env bash
# assets/record.sh — record three focused TUI demos via asciinema + agg.
# Produces:
#   assets/demo-watch.{cast,gif}      — atoms streaming in, no user input
#   assets/demo-feedback.{cast,gif}   — accept / reject / submit feedback loop
#   assets/demo-customize.{cast,gif}  — settings overlay + help overlay
#
# Each gif is ~10–15s of focused content, played at 0.8× speed for readability.
#
# Usage: bash assets/record.sh [watch|feedback|customize|all]
# Requires: asciinema, agg, expect (brew install asciinema agg expect)

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
COLS=128
ROWS=36
SPEED=0.8
# Use a throwaway feedback dir so the recording's submit (s) keypress never
# pollutes ~/Downloads — the e2e test polls there and would pick up our file.
FEEDBACK_DIR="$(mktemp -d -t aot-recording-XXXXXX)"
trap 'rm -rf "$FEEDBACK_DIR"' EXIT

[[ -f "$REPO/build/index.js" ]] || { echo "Build first: npm run build"; exit 1; }

PHASE="${1:-all}"

patch_cast_dims() {
  local cast="$1"
  python3 -c "
import json
p = '$cast'
with open(p) as f: lines = f.readlines()
h = json.loads(lines[0])
h['term']['cols'] = $COLS
h['term']['rows'] = $ROWS
lines[0] = json.dumps(h) + '\n'
with open(p, 'w') as f: f.writelines(lines)
"
}

render() {
  local cast="$1" gif="$2"
  patch_cast_dims "$cast"
  agg --cols "$COLS" --rows "$ROWS" --fps-cap 30 --idle-time-limit 2 \
      --theme monokai --font-size 14 --speed "$SPEED" "$cast" "$gif"
}

# -----------------------------------------------------------------------------
# 1. WATCH — atoms stream in, no user keypresses. Pure observation.
#    Highlights: tree, types, confidence bars, dependencies, sparkline.
# -----------------------------------------------------------------------------
record_watch() {
  local cast="$REPO/assets/demo-watch.cast"
  local gif="$REPO/assets/demo-watch.gif"

  expect <<EOF
set timeout 60
spawn -noecho asciinema rec --overwrite --cols $COLS --rows $ROWS \\
  -c "node $REPO/build/index.js tui --demo --feedback-dir $FEEDBACK_DIR" "$cast"

# Atoms arrive at ~700ms each — wait for the full chain plus termination
sleep 9.5

# Quit cleanly
send "q"
expect eof
EOF

  render "$cast" "$gif"
  echo "✓ watch     $cast ($(du -h "$cast" | cut -f1)) → $gif ($(du -h "$gif" | cut -f1))"
}

# -----------------------------------------------------------------------------
# 2. FEEDBACK — atoms pre-populated; user navigates, accepts, rejects, submits.
#    Highlights: selection cursor, feedback markers (✓ ✗ ★), note input,
#    submit-flash hint to the LLM.
# -----------------------------------------------------------------------------
record_feedback() {
  local cast="$REPO/assets/demo-feedback.cast"
  local gif="$REPO/assets/demo-feedback.gif"

  expect <<EOF
set timeout 60
spawn -noecho asciinema rec --overwrite --cols $COLS --rows $ROWS \\
  -c "node $REPO/build/index.js tui --demo-instant --feedback-dir $FEEDBACK_DIR" "$cast"

# Tree is already populated — selection sits on the last atom (C1)
sleep 1.4

# Walk back to P1 — show navigation feels responsive
send "k"; sleep 0.45
send "k"; sleep 0.45
send "k"; sleep 0.45
send "k"; sleep 0.45
send "k"; sleep 0.45
send "k"; sleep 0.7

# Accept the premise
send "a"; sleep 1.2

# Star it as critical context
send "*"; sleep 1.2

# Move down to the hypothesis and reject it with a real reason
send "j"; sleep 0.45
send "j"; sleep 0.45
send "j"; sleep 0.45
send "j"; sleep 0.7
send "r"; sleep 0.9

# Type the rejection reason — let viewers read it
send "use Prisma"; sleep 0.4
send " include"; sleep 0.4
send " instead of raw .map"; sleep 0.9
send "\r"; sleep 1.4

# Move to the conclusion and accept it
send "j"; sleep 0.45
send "j"; sleep 0.7
send "a"; sleep 1.2

# Submit the verdict — the flash bar tells the user to call check_approval
send "s"; sleep 3.2

# Quit
send "q"
expect eof
EOF

  render "$cast" "$gif"
  echo "✓ feedback  $cast ($(du -h "$cast" | cut -f1)) → $gif ($(du -h "$gif" | cut -f1))"
}

# -----------------------------------------------------------------------------
# 3. CUSTOMIZE — settings overlay + help overlay. Surface the configurability.
# -----------------------------------------------------------------------------
record_customize() {
  local cast="$REPO/assets/demo-customize.cast"
  local gif="$REPO/assets/demo-customize.gif"

  expect <<EOF
set timeout 60
spawn -noecho asciinema rec --overwrite --cols $COLS --rows $ROWS \\
  -c "node $REPO/build/index.js tui --demo-instant --feedback-dir $FEEDBACK_DIR" "$cast"

sleep 1.4

# Open settings
send "t"; sleep 1.6

# Scroll through the rows so each one gets a moment in the spotlight
send "j"; sleep 0.6
send "j"; sleep 0.6
send "j"; sleep 0.6

# Toggle "show dependency arrows" off then on (visible change in the tree
# behind the overlay)
send " "; sleep 1.0
send " "; sleep 1.0

# Cycle the theme — soft, mono, vibrant
send "j"; sleep 0.5
send "j"; sleep 0.5
send "l"; sleep 1.2
send "l"; sleep 1.2
send "l"; sleep 1.2

# Bump the confidence threshold up and back down
send "k"; sleep 0.4
send "k"; sleep 0.4
send "k"; sleep 0.4
send "k"; sleep 0.4
send "k"; sleep 0.4
send "k"; sleep 0.4
send "l"; sleep 0.6
send "l"; sleep 0.6
send "l"; sleep 0.6
send "h"; sleep 0.6
send "h"; sleep 0.6
send "h"; sleep 0.6

# Close settings, open help
send "\033"; sleep 0.9
send "?"; sleep 3.0
send "\033"; sleep 0.6

# Quit
send "q"
expect eof
EOF

  render "$cast" "$gif"
  echo "✓ customize $cast ($(du -h "$cast" | cut -f1)) → $gif ($(du -h "$gif" | cut -f1))"
}

case "$PHASE" in
  watch)     record_watch ;;
  feedback)  record_feedback ;;
  customize) record_customize ;;
  all)
    record_watch
    record_feedback
    record_customize
    ;;
  *)
    echo "usage: $0 [watch|feedback|customize|all]" >&2
    exit 1
    ;;
esac
