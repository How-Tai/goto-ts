#!/bin/sh
set -eu
case "${OTOG_WORKER_ID:-}" in 7|8) ;; *) exit 64;; esac
mount --make-rprivate /
mount -t tmpfs -o rw,exec,nosuid,size=256m,nr_inodes=4096 tmpfs /var/local/lib/isolate
work="/usr/src/app/compiler-work/$OTOG_WORKER_ID"
mkdir -p "$work" "/usr/src/app/Logging/slot$OTOG_WORKER_ID"
cd "$work"
if [ -f /usr/src/app/command.yaml ] && [ ! -e command.yaml ]; then
    ln -s /usr/src/app/command.yaml command.yaml
fi
if [ ! -e Logging ]; then ln -s "/usr/src/app/Logging/slot$OTOG_WORKER_ID" Logging; fi
exec nice -n 10 python3 -u /usr/src/app/src/mainWorkers.py
