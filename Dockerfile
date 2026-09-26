FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG BUILD_COMMIT
ARG BUILD_BRANCH
ARG BUILD_DIRTY
RUN test -n "$BUILD_COMMIT" && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PUBLIC_TRY_ENABLED=true OFFICIAL_EVENTS_ENABLED=true OFFICIAL_EVENT_ADMISSIONS=enabled PUBLIC_DIAGNOSTICS_ENABLED=true
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/event-session.js ./src/event-session.js
COPY package.json ./package.json
CMD ["node", "server/index.js"]
