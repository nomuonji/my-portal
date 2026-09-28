#!/usr/bin/env bash
set -o pipefail
npm run build 2>&1 | tee /tmp/my-portal-build.log
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  mkdir -p build
  cp /tmp/my-portal-build.log build/build-error.txt
  clean_log="/tmp/my-portal-build-clean.log"
sed -r 's/\\x1B\\[[0-9;]*[mK]//g' /tmp/my-portal-build.log > "$clean_log"
summary="$(grep -E 'ERROR in|Module not found|Attempted import error|not exported|SyntaxError|Cannot find module|Failed to compile' "$clean_log" | tail -n 1)"
if [ -z "$summary" ]; then summary="$(awk 'NF{line=$0} END{print line}' "$clean_log")"; fi
  slug="$(printf '%s' "$summary" | sed 's/[^A-Za-z0-9._-]/_/g' | cut -c1-160)"
  if [ -z "$slug" ]; then slug="unknown_build_error"; fi
  printf '<!doctype html><meta charset="utf-8"><pre>%s</pre>' "$summary" > "build/ERROR_${slug}.html"
  exit 0
fi
