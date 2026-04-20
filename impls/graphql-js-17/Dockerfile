FROM node:22-slim AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG GRAPHQL_JS_REF=17.x.x
WORKDIR /build
RUN git clone --depth 1 --branch ${GRAPHQL_JS_REF} https://github.com/graphql/graphql-js graphql-js
WORKDIR /build/graphql-js
RUN npm install --no-audit --no-fund \
 && npm run build:npm

FROM node:22-slim

WORKDIR /app
COPY --from=builder /build/graphql-js/npmDist /app/graphql-dist
COPY driver-package.json /app/package.json
COPY server.js /app/server.js
RUN npm install --no-audit --no-fund --install-links /app/graphql-dist

EXPOSE 8080
CMD ["node", "server.js"]
