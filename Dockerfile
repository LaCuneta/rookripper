FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:22-alpine

# libstdc++ is needed by better-sqlite3's native bindings
RUN apk add --no-cache libstdc++

WORKDIR /app
COPY --from=builder /app/build       ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# ORIGIN must be set at runtime — see docker-compose.yml
CMD ["node", "build"]
