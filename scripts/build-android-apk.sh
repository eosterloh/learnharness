#!/usr/bin/env bash
# Build a signed sideload APK. The keystore stays out of git.
# A missing keystore is created on the first run; back up android/.keystore
# and android/keystore.properties or later installs will be a different app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$ROOT/.android-sdk}}"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

if ! command -v java >/dev/null; then
	echo "A JDK 17 or newer is required." >&2
	exit 1
fi

mkdir -p "$SDK/cmdline-tools"
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
	tmp="$(mktemp -d)"
	curl -fsSL -o "$tmp/cmdtools.zip" https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
	unzip -q "$tmp/cmdtools.zip" -d "$tmp"
	rm -rf "$SDK/cmdline-tools/latest"
	mkdir -p "$SDK/cmdline-tools/latest"
	mv "$tmp/cmdline-tools/"* "$SDK/cmdline-tools/latest/"
	rm -rf "$tmp"
fi
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platforms;android-35" "build-tools;35.0.0"
printf 'sdk.dir=%s\n' "$SDK" > "$ANDROID/local.properties"

if [ ! -f "$ANDROID/gradle/wrapper/gradle-wrapper.jar" ]; then
	mkdir -p "$ANDROID/gradle/wrapper"
	curl -fsSL -o "$ANDROID/gradle/wrapper/gradle-wrapper.jar" \
		https://github.com/gradle/gradle/raw/v8.11.1/gradle/wrapper/gradle-wrapper.jar
	curl -fsSL -o "$ANDROID/gradlew" https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradlew
	chmod 755 "$ANDROID/gradlew"
fi

KEY_DIR="$ANDROID/.keystore"
KEY_FILE="$KEY_DIR/learnharness-release.jks"
PROPS="$ANDROID/keystore.properties"
if [ ! -f "$PROPS" ]; then
	mkdir -p "$KEY_DIR"
	if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
		printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KEY_FILE"
	elif [ ! -f "$KEY_FILE" ]; then
		pass="${LH_ANDROID_KEYSTORE_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"
		keytool -genkeypair -keystore "$KEY_FILE" -storetype JKS -alias learnharness \
			-keyalg RSA -keysize 2048 -validity 10000 \
			-storepass "$pass" -keypass "$pass" \
			-dname "CN=LearnHarness, O=LearnHarness, C=US"
		LH_ANDROID_KEYSTORE_PASSWORD="$pass"
		echo "Created $KEY_FILE — back this file up. A new key cannot update an installed app."
	fi
	pass="${LH_ANDROID_KEYSTORE_PASSWORD:?Set LH_ANDROID_KEYSTORE_PASSWORD to the existing keystore password.}"
	cat > "$PROPS" <<EOF
storeFile=.keystore/learnharness-release.jks
storePassword=$pass
keyAlias=${LH_ANDROID_KEY_ALIAS:-learnharness}
keyPassword=${LH_ANDROID_KEY_PASSWORD:-$pass}
EOF
	chmod 600 "$PROPS" "$KEY_FILE"
fi

cd "$ANDROID"
chmod 755 ./gradlew
./gradlew --no-daemon :app:assembleRelease
APK="$ANDROID/app/build/outputs/apk/release/app-release.apk"
mkdir -p "$ROOT/dist"
cp "$APK" "$ROOT/dist/LearnHarness.apk"
echo "APK: $ROOT/dist/LearnHarness.apk"
