#!/bin/sh
# Fixture SGT_BIN: emits the canned v2 route plan (re-route/supersede driver).
cat "$(dirname "$0")/route-plan-v2.json"
