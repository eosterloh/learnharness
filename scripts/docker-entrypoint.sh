#!/bin/sh
# Prepare the persistent data directory, then drop to the learnharness user.
set -eu
mkdir -p "$LH_DATA_DIR" "$(dirname "$LH_AUTH_FILE")"
if [ ! -f "$LH_AUTH_FILE" ]; then
	printf '%s\n' '{}' > "$LH_AUTH_FILE"
fi
chmod 600 "$LH_AUTH_FILE"
if [ "$(id -u)" = "0" ]; then
	chown -R learnharness:learnharness "$(dirname "$LH_AUTH_FILE")" "$LH_DATA_DIR"
	exec runuser -u learnharness -- node /app/server.js
fi
exec node /app/server.js
