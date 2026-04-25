FROM node:24-alpine

# libpq is required for pg native bindings (pg uses pure JS fallback by default,
# but having libpq avoids runtime warnings and enables native mode if desired).
RUN apk add --no-cache libpq

WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.mjs ./
COPY dashboard.html ./
COPY init.sql ./

ENV PORT=4000
EXPOSE 4000

USER node
CMD ["node", "server.mjs"]
