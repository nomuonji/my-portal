#!/usr/bin/env bash
set -o pipefail
npm run build 2>&1 | tee /tmp/my-portal-build.log
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  mkdir -p build
  cp /tmp/my-portal-build.log build/build-error.txt
  cat > build/index.html <<'EOF'
<!doctype html>
<meta charset="utf-8">
<title>Build diagnostic</title>
<pre>See /build-error.txt</pre>
EOF
  exit 0
fi
