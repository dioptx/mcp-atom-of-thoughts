#!/bin/sh
# Fixture SGT_BIN: canned route plan whose skills carry matchedTokens /
# missingTokens (sgt's semantic/query-dag shape) — drives advise tier 4 and
# the skillRefEquals token-diff pins.
cat "$(dirname "$0")/route-plan-tokens.json"
