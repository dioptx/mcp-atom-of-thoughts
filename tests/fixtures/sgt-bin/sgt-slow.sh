#!/bin/sh
# Fixture SGT_BIN: sleeps well past SGT_TIMEOUT_MS=200.
sleep 5
cat "$(dirname "$0")/route-plan.json"
