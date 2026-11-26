# Stage 1: the editors' static web builds, from the ArtCraft GitHub releases (checksummed).
FROM alpine:3.22 AS craft
RUN apk add --no-cache curl unzip
ARG WORDCRAFT_TAG=latest
ARG GRIDCRAFT_TAG=latest
ARG PDFCRAFT_TAG=latest
COPY scripts/fetch-craft.sh /fetch-craft.sh
RUN --mount=type=secret,id=github_token,required=false \
	GITHUB_TOKEN=$(cat /run/secrets/github_token 2>/dev/null || true) \
	sh /fetch-craft.sh /craft wordcraft=$WORDCRAFT_TAG gridcraft=$GRIDCRAFT_TAG pdfcraft=$PDFCRAFT_TAG

# Stage 2: a small Node server for the manifest and the files. No API, no storage.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src src
COPY ui ui
COPY --from=craft /craft ui/craft
USER node
ENV NODE_NO_WARNINGS=1 PORT=8080
EXPOSE 8080
CMD ["node", "src/server.mjs"]
