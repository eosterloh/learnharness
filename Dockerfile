# LearnHarness headless server. Build for the Spark with:
#   docker buildx build --platform linux/arm64 -t learnharness:local --load .
# The build must run as linux/arm64 so the traced native modules (resvg,
# @napi-rs/canvas) are the arm64 binaries. Photon is loaded at runtime and
# degrades to "no resize" if it cannot start.

FROM node:26-bookworm AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 \
	ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY . .
RUN npm ci && npm run plugins:setup && npm run build && node scripts/build-server.mjs

FROM node:26-bookworm-slim AS runtime
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation fontconfig util-linux \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --create-home --uid 10001 learnharness
ENV NODE_ENV=production \
	NEXT_TELEMETRY_DISABLED=1 \
	HOSTNAME=0.0.0.0 \
	PORT=3000 \
	LH_SERVER_MODE=1 \
	LH_DATA_DIR=/var/lib/learnharness/data \
	LH_AUTH_FILE=/var/lib/learnharness/auth.json \
	CHROME_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build /src/.next/standalone ./
COPY scripts/docker-entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh \
	&& mkdir -p /var/lib/learnharness/data \
	&& chown -R learnharness:learnharness /var/lib/learnharness
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
