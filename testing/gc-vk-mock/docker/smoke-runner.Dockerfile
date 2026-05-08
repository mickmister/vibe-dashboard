FROM golang:1.25-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY vibe-kanban-vscode-web/ /workspace/vd/
