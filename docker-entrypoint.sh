#!/bin/sh
# The image's entrypoint (Dockerfile): starts the server as an unprivileged
# user. Fly mounts the volume owned by root, and games saved by an older image
# that ran as root are root's too, so the data directory is handed over first.
# Started as another user already (docker run --user), it just runs.
set -e
if [ "$(id -u)" = 0 ]; then
	chown -R doodledrift:doodledrift /pb_data
	exec su-exec doodledrift "$@"
fi
exec "$@"
