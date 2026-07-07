#!/bin/sh
# Fixture SGT_BIN: emits the canned v1 route plan (I5: no corpus in repo).
cat "$(dirname "$0")/route-plan.json"
