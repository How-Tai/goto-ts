#!/bin/sh
set -eu
mkdir -p /opt/otog-worker-bin /usr/src/app/compiler-work
cat >/opt/otog-worker-bin/isolate <<'EOF'
#!/bin/sh
exec /usr/local/bin/isolate --box-id="$OTOG_WORKER_ID" "$@"
EOF
chmod 755 /opt/otog-worker-bin/isolate
export PATH="/opt/otog-worker-bin:$PATH"
export PYTHONPATH=/usr/src/app/src
exec python3 -u /usr/src/app/src/compiler_service.py
