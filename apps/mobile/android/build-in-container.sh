#!/usr/bin/env bash
set -euo pipefail
# Isolated SDK/Gradle build. Mount this project read-only at /source and an artifact directory at /output.
apt-get update -qq
apt-get install -y -qq unzip curl >/dev/null
export ANDROID_HOME=/tmp/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
mkdir -p "$ANDROID_HOME/cmdline-tools" /tmp/gradle /work
curl --fail --location --retry 3 --silent --show-error https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/android-tools.zip
unzip -q /tmp/android-tools.zip -d "$ANDROID_HOME/cmdline-tools"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
curl --fail --location --retry 3 --silent --show-error https://services.gradle.org/distributions/gradle-8.11.1-bin.zip -o /tmp/gradle.zip
curl --fail --location --retry 3 --silent --show-error https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256 -o /tmp/gradle.sha256
printf '%s  /tmp/gradle.zip\n' "$(cat /tmp/gradle.sha256)" | sha256sum --check
unzip -q /tmp/gradle.zip -d /tmp/gradle
set +o pipefail
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null
set -o pipefail
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'platforms;android-35' 'build-tools;35.0.0' >/dev/null
cp -a /source/. /work/
cd /work
/tmp/gradle/gradle-8.11.1/bin/gradle --no-daemon --max-workers=2 :app:assembleDebug :app:lintDebug
cp app/build/outputs/apk/debug/app-debug.apk /output/jarvis-companion-debug.apk
cp app/build/reports/lint-results-debug.html /output/android-lint.html
cp app/build/reports/lint-results-debug.xml /output/android-lint.xml
