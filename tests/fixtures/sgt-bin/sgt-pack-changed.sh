#!/bin/sh
# Fixture SGT_BIN: the canned context pack with the SECOND excerpt dropped —
# drives the changed-pack re-expand path (updateAtom, never overwrite).
exec node -e '
const fs = require("node:fs");
const path = require("node:path");
const pack = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), "context-pack.json"), "utf8"));
pack.packets[0].excerpts = pack.packets[0].excerpts.slice(0, 1);
process.stdout.write(JSON.stringify(pack));
' "$0"
