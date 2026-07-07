#!/bin/sh
# Fixture SGT_BIN: valid JSON on stdout but non-zero exit — exit status wins.
cat "$(dirname "$0")/route-plan.json"
echo 'sgt: ontology bundle missing' >&2
exit 3
