#!/bin/sh
# Fixture SGT_BIN: the canned v1 route plan with `missingTokens: []` added to
# k8s-manifest-generator — drives the pinned []-vs-undefined skillRefEquals
# distinction: a re-route that starts reporting an EMPTY token list updates
# the atom exactly once, then identical re-routes are byte-quiet.
exec node -e '
const fs = require("node:fs");
const path = require("node:path");
const plan = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), "route-plan.json"), "utf8"));
plan.skills = plan.skills.map(s => s.slug === "k8s-manifest-generator" ? { ...s, missingTokens: [] } : s);
process.stdout.write(JSON.stringify(plan));
' "$0"
