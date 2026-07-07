#!/bin/sh
# Fixture SGT_BIN: schema-valid context pack that resolves NOTHING — the
# requested slug ($3 of `context pack <slug> ...`) comes back unresolved.
exec node -e 'process.stdout.write(JSON.stringify({budget:{requestedTokens:1200},packets:[],unresolvedSlugs:[process.argv[1]],omittedDueToBudget:[]}))' "$3"
