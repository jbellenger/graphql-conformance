FROM node:24-slim

WORKDIR /app
COPY package.json /app/package.json
COPY server.js /app/server.js
RUN npm install --no-audit --no-fund
RUN node -p "require('./node_modules/graphql/package.json').version" > /impl-version

EXPOSE 8080
CMD ["node", "server.js"]
