#!/bin/sh

set -e

mkdir -p /app/.zerux/log
mkdir -p /var/log/cron

HEALTH_CHECK_SCRIPT="/usr/local/bin/check-app.sh"
AUTH_CLEANUP_SCRIPT="/usr/local/bin/proworkspace-auth-cleanup.sh"
ZERUX_BIN="/app/packages/zeruxjs/dist/bin/zerux.js"

cat <<'EOF' > "$HEALTH_CHECK_SCRIPT"
#!/bin/sh

SERVER_FILE="/app/.zerux/server.json"
LOG_FILE="/app/.zerux/log/cron-start.log"

if [ ! -f "$SERVER_FILE" ]; then
    echo "$(date) - server.json missing, starting app..." >> "$LOG_FILE"
    cd /app && node /app/packages/zeruxjs/dist/bin/zerux.js dev >> "$LOG_FILE" 2>&1 &
    exit 0
fi

APP_URL=$(grep -A2 '"type": "app"' "$SERVER_FILE" | grep '127.0.0.1' | head -n1 | cut -d'"' -f4)

if [ -z "$APP_URL" ]; then
    echo "$(date) - app URL not found, starting app..." >> "$LOG_FILE"
    cd /app && node /app/packages/zeruxjs/dist/bin/zerux.js dev >> "$LOG_FILE" 2>&1 &
    exit 0
fi

if ! curl -fs "$APP_URL" >/dev/null 2>&1; then
    echo "$(date) - app down, restarting..." >> "$LOG_FILE"

    pkill -f "node" || true

    cd /app && node /app/packages/zeruxjs/dist/bin/zerux.js dev >> "$LOG_FILE" 2>&1 &
else
    echo "$(date) - app healthy" >> "$LOG_FILE"
fi
EOF

chmod +x "$HEALTH_CHECK_SCRIPT"

cat <<'EOF' > "$AUTH_CLEANUP_SCRIPT"
#!/bin/sh

SERVER_FILE="/app/.zerux/server.json"
LOG_FILE="/app/.zerux/log/auth-cleanup.log"
LOCK_FILE="/app/.zerux/log/auth-cleanup-last-run"
MIN_GAP_SECONDS="${AUTH_SIGNUP_CLEANUP_GAP_SECONDS:-300}"

if [ -f "$LOCK_FILE" ]; then
    LAST_RUN="$(cat "$LOCK_FILE" 2>/dev/null || echo 0)"
    NOW="$(date +%s)"
    if [ "$((NOW - LAST_RUN))" -lt "$MIN_GAP_SECONDS" ]; then
        echo "$(date) - skipped auth cleanup, minimum gap not reached" >> "$LOG_FILE"
        exit 0
    fi
fi

if [ ! -f "$SERVER_FILE" ]; then
    echo "$(date) - server.json missing, auth cleanup skipped" >> "$LOG_FILE"
    exit 0
fi

APP_URL=$(grep -A2 '"type": "app"' "$SERVER_FILE" | grep '127.0.0.1' | head -n1 | cut -d'"' -f4)

if [ -z "$APP_URL" ]; then
    echo "$(date) - app URL not found, auth cleanup skipped" >> "$LOG_FILE"
    exit 0
fi

HEADER_ARGS=""
if [ -n "$AUTH_CRON_SECRET" ]; then
    HEADER_ARGS="-H x-proworkspace-cron-secret:$AUTH_CRON_SECRET"
fi

if curl -fs -X POST $HEADER_ARGS "$APP_URL/api/auth/cleanup-signups" >/dev/null 2>&1; then
    date +%s > "$LOCK_FILE"
    echo "$(date) - expired signup attempts cleaned" >> "$LOG_FILE"
else
    echo "$(date) - auth cleanup request failed" >> "$LOG_FILE"
fi
EOF

chmod +x "$AUTH_CLEANUP_SCRIPT"

cat <<EOF > /etc/crontabs/root
*/5 * * * * $HEALTH_CHECK_SCRIPT
*/${AUTH_SIGNUP_CLEANUP_INTERVAL_MINUTES:-5} * * * * $AUTH_CLEANUP_SCRIPT
EOF

crond

exec sh -c "
: > /app/.zerux/log/current.log && \
node "$ZERUX_BIN" dev 2>&1 | tee /app/.zerux/log/current.log
"
