# syntax=docker/dockerfile:1

FROM oven/bun:1-debian

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173

# The default command runs the web UI. To run the TUI from the same image:
#   docker run --rm -it vault-assistant bun run tui
COPY . .

RUN if [ -f bun.lock ] || [ -f bun.lockb ]; then \
      bun install --frozen-lockfile; \
    else \
      bun install; \
    fi \
    && mkdir -p logs .attachments \
    && chown -R bun:bun /app

USER bun

EXPOSE 5173

CMD ["bun", "run", "start"]
