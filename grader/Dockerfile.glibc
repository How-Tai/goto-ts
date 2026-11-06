FROM python:3.12.15-slim-trixie
WORKDIR /usr/src/app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    gcc g++ make pkg-config git bash ca-certificates libcap-dev libseccomp-dev libsystemd-dev libpq-dev \
    libbz2-1.0 libexpat1 libffi8 liblzma5 libsqlite3-0 libreadline8t64 libncursesw6 \
    && rm -rf /var/lib/apt/lists/*
# Isolate 2.7 plus the exact memory-only accounting / descriptor-bounded cleanup patch.
COPY deployment/isolate-2.7-hardened.patch /tmp/isolate-hardened.patch
RUN git clone https://github.com/ioi/isolate.git /tmp/isolate \
    && git -C /tmp/isolate checkout 8f185bb37f3f23e29b33b0c7727c91c13429abe3 \
    && git -C /tmp/isolate apply --check /tmp/isolate-hardened.patch \
    && git -C /tmp/isolate apply /tmp/isolate-hardened.patch \
    && make -C /tmp/isolate -j1 isolate \
    && install -m0755 /tmp/isolate/isolate /usr/local/bin/isolate \
    && rm -rf /tmp/isolate /tmp/isolate-hardened.patch
COPY deployment/isolate.cfg /usr/local/etc/isolate
COPY requirements.txt ./requirements.txt
RUN python3 -m venv /usr/src/app/venv \
    && /usr/src/app/venv/bin/pip install --no-cache-dir --upgrade pip==26.2.2 setuptools==84.2.1 wheel==0.48.0 \
    && /usr/src/app/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY src ./src
COPY worker-entrypoint.sh ./worker-entrypoint.sh
RUN mkdir -p env source shared-source Logging /opt/otog-empty /opt/otog-worker-bin \
    && chmod 555 /opt/otog-empty && chmod 755 worker-entrypoint.sh \
    && ln -sf /usr/local/bin/python3.12 /usr/bin/python3
ENV PATH="/usr/src/app/venv/bin:$PATH"
CMD ["/bin/sh", "/usr/src/app/worker-entrypoint.sh"]
