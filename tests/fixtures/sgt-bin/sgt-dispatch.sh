#!/bin/sh
# Fixture SGT_BIN: dispatches on the sgt subcommand pair (I5: no corpus).
# 'route plan' -> canned v1 route plan; 'context pack' -> canned context pack.
case "$1 $2" in
  "route plan") cat "$(dirname "$0")/route-plan.json" ;;
  "context pack") cat "$(dirname "$0")/context-pack.json" ;;
  *) echo "sgt-dispatch: unsupported command: $1 $2" >&2; exit 2 ;;
esac
