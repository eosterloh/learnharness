# Self-hosting

One LearnHarness server on the Spark holds the conversations, the knowledge graph, and the settings. The Mac app and the Android app are windows onto that server. There is no sync engine. Do not run a second server against the same directory.

This tree is AGPL-3.0-only and tracks [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness). The server you run is this source.

The Spark is reached only over your tailnet. The server still requires a password. Tailscale is the network. The password is the login.

## What you need

- The Spark, Linux arm64, with Tailscale already joined.
- HTTPS certificates enabled for the tailnet. `tailscale serve` opens the consent page if they are not.
- A checkout of this repository on the Spark.
- Node is inside the Docker image. The systemd path needs Node 26 on the host.

Provider keys stay in `auth.json`. The server password is separate. It is stored as a scrypt hash in `owner-password.json` next to `auth.json`, mode `0600`.

## Docker

On the Spark:

```sh
git clone https://github.com/eosterloh/learnharness.git
cd learnharness
printf '%s\n' \
  'LH_ALLOWED_HOSTS=your-spark.your-tailnet.ts.net' \
  'LH_OWNER_PASSWORD=choose-a-long-password' > .env
chmod 600 .env
docker compose build
docker compose up -d
```

`LH_ALLOWED_HOSTS` is the MagicDNS hostname only: no `https://`, no port. `LH_OWNER_PASSWORD` is optional and must be 8 to 200 characters. Leave that line out to choose the password in the browser the first time you open the server. After the hash file exists you can delete the line and restart. While the variable is set, it replaces the stored hash.

The compose file publishes `127.0.0.1:3000` only. The process inside the container listens on `0.0.0.0` so Docker can reach it. The Spark's LAN does not.

```sh
sudo tailscale serve --bg 3000
tailscale serve status
```

Serve prints `https://your-spark.your-tailnet.ts.net/`. Open that URL. If you did not set `LH_OWNER_PASSWORD`, the page asks you to choose one. Otherwise sign in.

`docker compose logs -f learnharness` is the server log. `docker compose restart learnharness` picks up a changed `.env`.

Image features on arm64: `@resvg/resvg-js` and `@napi-rs/canvas` install their linux-arm64 builds, so SVG and PDF rasterizing stay native. Chromium in the image (`CHROME_PATH=/usr/bin/chromium`) is the demo checker, with the sandbox flags the app already passes. Photon is loaded at runtime; if it cannot start, image resize is skipped and the request continues.

Build the image on the Spark, or with Buildx from another machine:

```sh
docker buildx build --platform linux/arm64 -t learnharness:local --load .
```

The build has to run as `linux/arm64`. A build on another architecture traces that architecture's native modules.

## Without Docker

Install Node 26 and Chromium, then stage the standalone server:

```sh
curl -fsSL https://nodejs.org/dist/v26.13.1/node-v26.13.1-linux-arm64.tar.xz \
  | sudo tar -xJ -C /usr/local --strip-components=1
sudo apt-get update
sudo apt-get install -y chromium fonts-liberation
cd learnharness
npm ci
npm run plugins:setup
npm run build
node scripts/build-server.mjs
sudo mkdir -p /opt/learnharness /var/lib/learnharness/data
sudo cp -a .next/standalone/. /opt/learnharness/
sudo useradd --system --home-dir /var/lib/learnharness --shell /usr/sbin/nologin learnharness || true
sudo chown -R learnharness:learnharness /var/lib/learnharness
echo '{}' | sudo tee /var/lib/learnharness/auth.json >/dev/null
sudo chown learnharness:learnharness /var/lib/learnharness/auth.json
sudo chmod 600 /var/lib/learnharness/auth.json
sudo cp deploy/learnharness.service /etc/systemd/system/learnharness.service
sudo cp deploy/learnharness.env.example /etc/learnharness.env
sudo chmod 600 /etc/learnharness.env
# Edit /etc/learnharness.env: set LH_ALLOWED_HOSTS, and LH_OWNER_PASSWORD if you want one.
sudo systemctl enable --now learnharness
sudo tailscale serve --bg 3000
```

`HOSTNAME=127.0.0.1` in the unit is the listen address. systemd would otherwise pass the machine's hostname through, and Next treats `HOSTNAME` as the bind address.

## Move an existing Mac profile

Quit LearnHarness on the Mac first so it is not writing the files.

On the Mac:

```sh
ssh spark 'mkdir -p /tmp/lh-import'
rsync -a \
  "$HOME/Library/Application Support/LearnHarness/data" \
  "$HOME/Library/Application Support/LearnHarness/auth.json" \
  spark:/tmp/lh-import/
rsync -a \
  "$HOME/Library/Application Support/LearnHarness/"*-credentials.json \
  spark:/tmp/lh-import/ || true
```

On the Spark, from this checkout, after `docker compose up -d` has created the volume:

```sh
bash scripts/migrate-macos-userdata.sh --from /tmp/lh-import --volume learnharness
rm -rf /tmp/lh-import
docker compose restart learnharness
```

For the systemd layout, use `--to /var/lib/learnharness` instead of `--volume`, with the service stopped. The script copies `data/` and `auth.json`, plus the subscription credential files when they are next to `auth.json`, and sets those files to mode `600`. It does not copy Electron caches or this Mac's sidebar state.

The server password is not in that folder. Set it with `LH_OWNER_PASSWORD` or the first-run page.

## Mac app

This version of the desktop app can use the server. Quit the copy you have now, then either build `npm run desktop:dist` on the Mac or, from a checkout, launch the shell directly:

```sh
LH_SERVER_URL='https://your-spark.your-tailnet.ts.net' \
  npx electron .
```

The window loads the server. Sign in once. The cookie stays in the app.

To save the address inside the app: Settings → General, paste the `https://` origin, **Save and restart**. **Use this Mac** clears it and the next launch is the local server again. `LH_SERVER_URL` overrides the saved address. `LH_DEV_URL` still means the local development server and wins over both.

A remote window does not attach files from the Mac. Paths the teacher reads are paths on the Spark. Paste one, or keep using local mode when the files are on the Mac.

Dictation still needs `DEEPGRAM_API_KEY` in the server's `auth.json` (Settings → Providers on the server).

## Android app

The app is a WebView. It is not on the Play Store.

Build a signed APK from this checkout:

```sh
npm run android:apk
```

The first run creates `android/.keystore/learnharness-release.jks` and `android/keystore.properties`. Back both up. A new keystore cannot update an app that was installed with the old one. The password is not printed. Both files are gitignored.

The APK is `dist/LearnHarness.apk`. Install it:

```sh
adb install -r dist/LearnHarness.apk
```

GitHub Actions workflow **Android APK** uploads the same file as the artifact `LearnHarness-apk`. A stable signature across those builds needs the repository secrets `ANDROID_KEYSTORE_BASE64`, `LH_ANDROID_KEYSTORE_PASSWORD`, `LH_ANDROID_KEY_ALIAS`, and `LH_ANDROID_KEY_PASSWORD`. Without them the workflow still signs an APK, with a key that exists only for that run.

On the phone, over Tailscale, enter `https://your-spark.your-tailnet.ts.net` and connect. Sign in on the page. The cookie stays in the WebView. The microphone permission is requested when you dictate. Back walks the page history, then leaves the app in the background. Settings → General → **Change phone server** opens the address screen again. Changing the host clears cookies.

## Checks

Unauthenticated calls to `/api/*`, including the event and chat streams, are rejected. Page loads redirect to `/login` before a conversation is rendered. The packaged Electron child still uses its desktop secret and does not ask for this password.
