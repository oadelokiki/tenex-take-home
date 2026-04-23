# Build from repository root: docker build -f infra/nginx/Dockerfile .
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /workspace
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN yarn install --immutable
COPY apps/web apps/web
RUN yarn workspace @tenex/web build

FROM nginx:1.27-alpine
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
