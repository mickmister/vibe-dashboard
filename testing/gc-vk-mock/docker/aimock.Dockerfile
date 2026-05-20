FROM ghcr.io/copilotkit/aimock:latest

COPY vibe-kanban-vscode-web/testing/gc-vk-mock/fixtures/ /fixtures/

CMD ["--fixtures", "/fixtures/llm", "--port", "4010", "--strict", "--validate-on-load"]
