#!/usr/bin/env bash
# Copy a macOS LearnHarness userData directory onto the server volume.
# The source is the Application Support folder (or a staging copy of it):
#   data/     conversations, graph, settings
#   auth.json provider keys, mode 0600
# Credential files beside auth.json are copied when they are present.
# Logs, caches, and Electron local storage are not.
set -euo pipefail

FROM=""
TO=""
VOLUME=""
while [ $# -gt 0 ]; do
	case "$1" in
		--from) FROM="${2:-}"; shift 2 ;;
		--to) TO="${2:-}"; shift 2 ;;
		--volume) VOLUME="${2:-}"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 2 ;;
	esac
done

if [ -z "$FROM" ] || { [ -z "$TO" ] && [ -z "$VOLUME" ]; } || { [ -n "$TO" ] && [ -n "$VOLUME" ]; }; then
	echo "Usage: migrate-macos-userdata.sh --from <userData> (--to <dir> | --volume <docker-volume>)" >&2
	exit 2
fi
if [ ! -d "$FROM/data" ] || [ ! -f "$FROM/auth.json" ]; then
	echo "Source must contain data/ and auth.json: $FROM" >&2
	exit 1
fi

copy_tree() {
	dest="$1"
	mkdir -p "$dest"
	rm -rf "$dest/data"
	cp -a "$FROM/data" "$dest/data"
	cp -a "$FROM/auth.json" "$dest/auth.json"
	chmod 600 "$dest/auth.json"
	for name in chatgpt-credentials.json github-copilot-credentials.json xai-credentials.json; do
		if [ -f "$FROM/$name" ]; then
			cp -a "$FROM/$name" "$dest/$name"
			chmod 600 "$dest/$name"
		fi
	done
	mode="$(stat -c '%a' "$dest/auth.json")"
	if [ "$mode" != "600" ]; then
		echo "auth.json mode is $mode, expected 600" >&2
		exit 1
	fi
	echo "Copied data/ and auth.json to $dest (auth.json mode 600)."
}

if [ -n "$VOLUME" ]; then
	docker run --rm \
		-v "$FROM":/from:ro \
		-v "$VOLUME":/to \
		alpine:3.20 \
		sh -c 'set -eu
			mkdir -p /to
			rm -rf /to/data
			cp -a /from/data /to/data
			cp -a /from/auth.json /to/auth.json
			chmod 600 /to/auth.json
			for name in chatgpt-credentials.json github-copilot-credentials.json xai-credentials.json; do
				if [ -f "/from/$name" ]; then cp -a "/from/$name" "/to/$name"; chmod 600 "/to/$name"; fi
			done
			mode=$(stat -c %a /to/auth.json)
			[ "$mode" = 600 ]
			echo "Copied into volume (auth.json mode $mode)."'
	exit 0
fi

copy_tree "$TO"
