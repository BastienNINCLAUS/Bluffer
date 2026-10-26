FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY server ./server
COPY game ./game
COPY shared ./shared
COPY public ./public

# Compteur de questions jouées : à monter sur un volume pour survivre aux reconstructions de l'image.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data

# Port interne fixe ; le port publié sur le PC se règle avec HOST_PORT (docker-compose.yml).
ENV PORT=3000
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
