#!/bin/sh
# Fixture SGT_BIN: round-trips the query argv ($3 of `route plan <query> ...`)
# back inside a valid route plan, proving argv passes through verbatim with
# no shell interpolation. Uses node for safe JSON escaping.
exec node -e 'process.stdout.write(JSON.stringify({query: process.argv[1], decisionTree: [], skills: [{slug: "echo-skill", score: 50}]}))' "$3"
