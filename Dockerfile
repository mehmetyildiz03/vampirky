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

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8787}/health" >/dev/null || exit 1

CMD ["npm", "run", "server:start"]
