# Standalone NOVA Relay image for containerized Home Assistant (no Supervisor required)
FROM node:20-alpine

WORKDIR /app

# Copy package manifests and tsconfig
COPY nova/package.json nova/package-lock.json nova/tsconfig.json ./
# Copy sources
COPY nova/src ./src

# Install deps and build
RUN npm ci \
  && npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

# Defaults (can be overridden at runtime)
ENV LOG_LEVEL=info \
    RELAY_PORT=8791 \
    RELAY_VERSION=dev

EXPOSE 8791

# Start the relay (expects RELAY_AUTH_TOKEN and HA_LLAT env vars)
CMD ["node", "/app/dist/src/runtime/main.js"]
