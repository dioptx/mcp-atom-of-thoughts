#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  *"--version"*)
    printf '%s\n' 'linear-cli 0.3.25'
    ;;
  *"search issues aot:linear-prefix:A --all --archived"*)
    printf '%s\n' '[{"identifier":"CLA-81","title":"Requirement"}]'
    ;;
  *"search issues aot:linear-dedupe:A --all --archived"*)
    printf '%s\n' '[{"identifier":"CLA-8","title":"Requirement"}]'
    ;;
  *"issues get CLA-81"*)
    printf '%s\n' '{"identifier":"CLA-81","description":"AoT external ref: aot:linear-prefix:A1"}'
    ;;
  *"issues get CLA-8"*)
    printf '%s\n' '{"identifier":"CLA-8","description":"AoT external ref: aot:linear-dedupe:A"}'
    ;;
  *"issues create"*)
    printf '%s\n' '{"identifier":"CLA-9","title":"Requirement"}'
    ;;
  *"relations list CLA-A"*)
    printf '%s\n' '{"issue":{"identifier":"CLA-A"},"relations":[{"id":"rel-1","type":"blocks","relatedIssue":{"identifier":"CLA-C"}},{"id":"rel-2","type":"related","relatedIssue":{"identifier":"CLA-B"}}],"inverseRelations":[]}'
    ;;
  *"relations add --relation blocks CLA-A CLA-B"*)
    printf '%s\n' '{"id":"rel-new","type":"blocks"}'
    ;;
  *)
    printf '%s\n' "unexpected arguments: $*" >&2
    exit 98
    ;;
esac
