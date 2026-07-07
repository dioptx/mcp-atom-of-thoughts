#!/bin/sh
# Fixture SGT_BIN: round-trips argv inside a schema-valid context pack (the
# extra "argv" field survives passthrough), proving exact argv construction
# with no shell interpolation.
exec node -e 'process.stdout.write(JSON.stringify({budget:{requestedTokens:0},packets:[],unresolvedSlugs:[],omittedDueToBudget:[],argv:process.argv.slice(1)}))' "$@"
