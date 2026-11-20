# TestingBot MCP server (stdio). Used by the Docker MCP Catalog and other
# directories that run servers in containers.
#
#   docker build -t testingbot-mcp .
#   docker run -i --rm -e TESTINGBOT_KEY=... -e TESTINGBOT_SECRET=... testingbot-mcp

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
