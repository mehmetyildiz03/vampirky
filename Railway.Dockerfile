# Dedicated production backend image for Railway.
# Railway discovers this file through RAILWAY_DOCKERFILE_PATH=Railway.Dockerfile.
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
CMD ["npm", "run", "server:start"]
