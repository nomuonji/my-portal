#!/usr/bin/env bash
set -o pipefail
npm run build 2>&1 | tee /tmp/my-portal-build.log
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  mkdir -p build
  cp /tmp/my-portal-build.log build/build-error.txt
  clean_log="/tmp/my-portal-build-clean.log"
  sed -r 's/\\x1B\\[[0-9;]*[mK]//g' /tmp/my-portal-build.log > "$clean_log"
  awk 'NF' "$clean_log" | tail -n 10 > /tmp/my-portal-build-tail.log
  index=0
  while IFS= read -r line; do
    index=$((index + 1))
    slug="$(printf '%s' "$line" | sed 's/[^A-Za-z0-9._-]/_/g' | cut -c1-150)"
    if [ -z "$slug" ]; then slug="line"; fi
    printf '<!doctype html><meta charset="utf-8"><pre>%s</pre>' "$line" > "build/E${index}_${slug}.html"
  done < /tmp/my-portal-build-tail.log
  exit 0
fi
