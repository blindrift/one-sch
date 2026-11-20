# syntax=docker/dockerfile:1.7
# 대상: 시놀로지 NAS(linux/amd64). 개발 PC 에서는 scripts/build-amd64.sh 로 빌드한다.
# node:22-alpine linux/amd64 매니페스트 다이제스트(2026-11-12)
FROM node:22-alpine@sha256:12f54cafa58d0e96554ae05871e29663ff7241836377dc9a7916449b8adb062c AS base
RUN apk add --no-cache openssl
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build

# 일회성: 마이그레이션 적용 + (사용자 0명일 때만) admin 시드. onesch_owner 로 실행한다.
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY src/server/auth/password.ts ./src/server/auth/password.ts
COPY src/lib/validation/limits.ts ./src/lib/validation/limits.ts
USER node
ENV HOME=/tmp
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/tsx prisma/seed.ts"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS=--max-old-space-size=384
# 앱 파일은 root 소유(읽기 전용), 실행은 node 사용자
COPY --from=build --chown=root:root /app/.next/standalone ./
COPY --from=build --chown=root:root /app/.next/static ./.next/static
COPY --from=build --chown=root:root /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
