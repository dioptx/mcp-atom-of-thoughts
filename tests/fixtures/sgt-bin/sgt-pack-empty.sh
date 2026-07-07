#!/bin/sh
# Fixture SGT_BIN: schema-valid context pack whose packet resolves the slug
# but discloses NOTHING (excerpts: [], references: []) — drives the
# empty-packet adversarial path: `sgt expand: {slug} (0 excerpts, budget {B})`
# with empty evidence and valid state.
cat "$(dirname "$0")/context-pack-empty.json"
