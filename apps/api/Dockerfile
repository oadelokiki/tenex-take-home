# Build from repository root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN yarn install --immutable
COPY apps/api apps/api
RUN yarn workspace @tenex/api build

FROM node:22-alpine AS runner
WORKDIR /workspace
ENV NODE_ENV=production
RUN addgroup -g 1001 -S tenex && adduser -S tenex -u 1001 -G tenex
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN yarn workspaces focus @tenex/api --production && yarn cache clean --all
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
USER tenex
WORKDIR /workspace/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
