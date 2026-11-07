# Doodle Drift's server, with the web app embedded: built in three stages, so
# the image holds just the binary. See DEPLOY.md.

# The web app. VITE_POCKETBASE_URL=/ points it at whatever address serves it.
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN VITE_POCKETBASE_URL=/ npm run build

# The server, embedding the build (web/embed.go) and the avatar faces.
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web/embed.go ./web/embed.go
COPY web/src/assets/avatars ./web/src/assets/avatars
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /doodledrift ./cmd/doodledrift

FROM alpine:3.22
# The server runs as doodledrift, not root: docker-entrypoint.sh gives it the
# data directory and drops to it with su-exec.
RUN apk add --no-cache ca-certificates tzdata su-exec \
	&& adduser -D -H -s /sbin/nologin doodledrift
COPY --from=server /doodledrift /usr/local/bin/doodledrift
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Public mode unless told otherwise, so the image run anywhere refuses to
# start without the admin secrets rather than offering the setup link to the
# first visitor (README: Public mode).
ENV PUBLIC_MODE=1
# The games live on a volume mounted here (fly.toml).
VOLUME /pb_data
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["doodledrift", "serve", "--http=0.0.0.0:8080", "--dir=/pb_data"]
