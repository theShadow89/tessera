# Web app image: build the static bundle, serve it with nginx.
# The geometry engine runs in a WASM Web Worker that needs cross-origin
# isolation, so nginx sends COOP/COEP headers (see docker/nginx.conf).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Artifact-only stage: build the static bundle in this deterministic Linux
# image and export it to the host with
#   docker build --target export --output type=local,dest=dist .
# (Makefile: `make docker-dist`). Sidesteps host toolchain differences
# (GNU vs BSD, Node version) — only Docker is required. Kept BEFORE `runtime`
# so a plain `docker build .` still produces the nginx image.
FROM scratch AS export
COPY --from=build /app/dist /

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine already runs `nginx -g 'daemon off;'` as its CMD.
