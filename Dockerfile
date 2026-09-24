FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    VAMPIRKY_STATE_FILE=/data/vampirky-state.json

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY src/game ./src/game
COPY src/multiplayer ./src/multiplayer

RUN apk add --no-cache su-exec \
 && mkdir -p /data \
 && chown -R node:node /app /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8787}/health" >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "server:start"]
