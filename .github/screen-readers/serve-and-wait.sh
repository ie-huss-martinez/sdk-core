#!/usr/bin/env bash
# Serves a built site in the background and waits until it answers.
# Usage: ./serve-and-wait.sh <dir> <port>
set -euo pipefail
dir=$1
port=$2
if [ ! -f "$dir/index.html" ] && [ ! -f "$dir/iframe.html" ]; then
  echo "::error::$dir has no built site."
  exit 1
fi
nohup node serve.mjs "$dir" "$port" > "serve-$port.log" 2>&1 &
for _ in $(seq 1 30); do
  if curl --silent --fail --output /dev/null "http://127.0.0.1:$port/"; then
    echo "Serving $dir on port $port."
    exit 0
  fi
  sleep 1
done
echo "::error::Nothing answered on port $port."
cat "serve-$port.log"
exit 1
