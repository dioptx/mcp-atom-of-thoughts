#!/usr/bin/env bash
# assets/record.sh — record the Atom of Thoughts TUI demo via asciinema + agg.
# Produces:
#   assets/demo.cast — canonical asciicast (small JSON, embeddable on asciinema.org)
#   assets/demo.gif  — rendered via agg (much smaller than vhs output)
#
# Usage: bash assets/record.sh
# Requires: asciinema, agg, expect (brew install asciinema agg expect)

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CAST="$REPO/assets/demo.cast"
GIF="$REPO/assets/demo.gif"
COLS=128
ROWS=36

[[ -f "$REPO/build/index.js" ]] || { echo "Build first: npm run build"; exit 1; }

# Drive the TUI demo via expect — gives asciinema a real PTY so it captures
# every redraw, not just the initial paint.
expect <<EOF
set timeout 60
spawn -noecho asciinema rec --overwrite --cols $COLS --rows $ROWS \\
  -c "node $REPO/build/index.js tui --demo" "$CAST"

# Atoms stream in — let P1, P2, P3 land
sleep 2.4

# Navigate up and accept P1 as critical context
send "k"; sleep 0.25
send "k"; sleep 0.25
send "k"; sleep 0.6
send "a"; sleep 0.8
send "*"; sleep 0.7

# More atoms appear (R1, H1, V1)
sleep 1.4

# Show the settings overlay — proves it's a real surface
send "t"; sleep 1.1
send "j"; sleep 0.25
send "j"; sleep 0.25
send " "; sleep 0.6
send "j"; sleep 0.25
send "j"; sleep 0.25
send "j"; sleep 0.25
send "l"; sleep 0.7
send "\033"; sleep 0.7

# Help overlay
send "?"; sleep 1.5
send "\033"; sleep 0.5

# Reject H1 with a note — feedback flows back to the LLM via check_approval
send "j"; sleep 0.2
send "j"; sleep 0.2
send "r"; sleep 0.6
send "use Prisma include instead of raw .map"; sleep 0.7
send "\r"; sleep 0.8

# C1 lands, gets verified, termination message appears
sleep 2.2

# Accept the conclusion and submit the verdict
send "j"; sleep 0.2
send "j"; sleep 0.2
send "j"; sleep 0.2
send "j"; sleep 0.2
send "a"; sleep 0.7
send "s"; sleep 2.5

# Quit cleanly
send "q"
expect eof
EOF

# asciinema 3.x writes term cols/rows as 0 when launched without a TTY
# (which is true when driven by `expect`). Patch the header so agg accepts it.
python3 -c "
import json, sys
p = '$CAST'
with open(p) as f: lines = f.readlines()
h = json.loads(lines[0])
h['term']['cols'] = $COLS
h['term']['rows'] = $ROWS
lines[0] = json.dumps(h) + '\n'
with open(p, 'w') as f: f.writelines(lines)
"

# Render .cast → .gif
agg --cols "$COLS" --rows "$ROWS" --fps-cap 30 --idle-time-limit 2 \
    --theme monokai --font-size 14 --speed 1.2 "$CAST" "$GIF"

echo
echo "✓ recorded $CAST ($(du -h "$CAST" | cut -f1))"
echo "✓ rendered $GIF  ($(du -h "$GIF"  | cut -f1))"
