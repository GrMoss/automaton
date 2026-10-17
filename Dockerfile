# Runs the web console and the agent together in one isolated container.
# Build:  docker build -t automaton .
# Run:    scripts/automaton-docker.sh up      (recommended; see that script)

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.28.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile
COPY . .
# CI=true: pnpm otherwise asks for a TTY to confirm removing dev dependencies.
RUN pnpm build \
 && CI=true pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    AUTOMATON_CONSOLE_HOST=0.0.0.0 \
    HOME=/home/node
WORKDIR /app
# The agent's self-modification sandbox is its working directory, so /app must
# belong to the unprivileged user.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /home/node/.automaton && chown node:node /home/node/.automaton
USER node
VOLUME /home/node/.automaton
EXPOSE 7777
CMD ["node", "dist/web/server.js", "--port", "7777"]
