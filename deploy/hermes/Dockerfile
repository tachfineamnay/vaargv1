# syntax=docker/dockerfile:1
# VAARG V1 Confined Hermes Runtime Image
# Pinned upstream: NousResearch/hermes-agent v0.23.4 (8fc0374447313e276f6b9a2764bfc750190c966a)
# Private server-side runtime ONLY — never publish ports publicly, never mount Docker socket or host FS.

FROM python:3.12-slim-bookworm

ARG HERMES_VERSION=v0.23.4
ARG HERMES_COMMIT=8fc0374447313e276f6b9a2764bfc750190c966a

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 hermes \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin hermes

WORKDIR /opt/hermes
RUN curl -fsSL "https://codeload.github.com/NousResearch/hermes-agent/tar.gz/${HERMES_COMMIT}" \
      | tar -xz --strip-components=1 -C /opt/hermes \
    && pip install --no-cache-dir -e /opt/hermes

ENV HERMES_HOME=/opt/data \
    API_SERVER_ENABLED=true \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_PORT=8642 \
    PYTHONUNBUFFERED=1

RUN mkdir -p /opt/data/plugins/vaarg-confinement \
    && chown -R hermes:hermes /opt/data /opt/hermes

COPY --chown=hermes:hermes deploy/hermes/config.yaml /opt/data/config.yaml
COPY --chown=hermes:hermes deploy/hermes/plugins/vaarg-confinement/plugin.yaml /opt/data/plugins/vaarg-confinement/plugin.yaml
COPY --chown=hermes:hermes deploy/hermes/plugins/vaarg-confinement/__init__.py /opt/data/plugins/vaarg-confinement/__init__.py

USER hermes
EXPOSE 8642
CMD ["hermes", "gateway", "run"]
