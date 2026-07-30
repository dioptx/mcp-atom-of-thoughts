#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  *"--version"*)
    printf '%s\n' 'linear-cli 0.3.25'
    ;;
  *"search issues"*)
    printf '%s\n' '[{"identifier":"CLA-8","title":"Requirement"}]'
    ;;
  *"issues get CLA-8"*)
    printf '%s\n' '{"identifier":"CLA-8","description":"AoT external ref: aot:linear-dedupe:A"}'
    ;;
  *"issues create"*)
    printf '%s\n' 'unexpected duplicate create' >&2
    exit 99
    ;;
  *)
    printf '%s\n' "unexpected arguments: $*" >&2
    exit 98
    ;;
esac
