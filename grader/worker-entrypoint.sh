#!/bin/sh
set -eu
case "${OTOG_WORKER_ID:-}" in 1|2|3|4|5|6|7) ;; *) echo 'Invalid worker ID' >&2; exit 1;; esac
exec python3 -u src/mle_bootstrap.py
