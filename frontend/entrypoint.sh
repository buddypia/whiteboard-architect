#!/bin/sh
set -e

# Replace build-time placeholders with runtime environment variables.
# Next.js inlines NEXT_PUBLIC_* at build time, so we use placeholder strings
# during the Docker build and sed-replace them at container start.
if [ -n "$BACKEND_URL" ]; then
  WS_URL="$(echo "$BACKEND_URL" | sed 's|^https://|wss://|;s|^http://|ws://|')/ws"
  find /app/.next -name '*.js' -type f -exec \
    sed -i "s|__RUNTIME_BACKEND_URL__|${BACKEND_URL}|g;s|__RUNTIME_WS_URL__|${WS_URL}|g" {} +
fi

exec node server.js
