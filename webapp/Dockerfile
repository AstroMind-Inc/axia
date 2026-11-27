# Multi-stage build: install -> build -> runtime
#
# Dependencies come from the committed package-lock.json via `npm ci`, so every
# build installs exactly the reviewed versions. A bare `npm install` resolved
# fresh versions inside the semver ranges on each build, meaning a compromised
# or broken release of any transitive package could ship without a commit.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://service:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# Run as the image's unprivileged `node` user, so a compromise of the web
# process is not root inside the container. It owns only .next, which Next
# writes to at runtime (image optimisation cache).
COPY --from=builder --chown=root:root /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=root:root /app/public ./public
COPY --from=builder --chown=root:root /app/package.json ./package.json
COPY --from=builder --chown=root:root /app/next.config.js ./next.config.js
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
