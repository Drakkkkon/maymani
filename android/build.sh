#!/bin/sh
# Сборка APK без Gradle. Нужны: JDK, Android SDK (build-tools 35, platform android-35) и ключ подписи.
# SDK_BT=…/build-tools SDK_JAR=…/android.jar KEYSTORE=…/key.jks KEYPASS=… sh build.sh out.apk
set -e
OUT=$(realpath -m "$1")
cd "$(dirname "$0")"
T=$(mktemp -d)
"$SDK_BT/aapt2" compile --dir res -o "$T/res.zip"
"$SDK_BT/aapt2" link -o "$T/base.apk" -I "$SDK_JAR" --manifest AndroidManifest.xml --java "$T/gen" "$T/res.zip"
mkdir "$T/classes" "$T/dex"
javac -encoding utf-8 --release 11 -classpath "$SDK_JAR" -d "$T/classes" src/kz/drakkkkon/moelenta/*.java "$T/gen/kz/drakkkkon/moelenta/R.java"
"$SDK_BT/d8" --release --min-api 26 --lib "$SDK_JAR" --output "$T/dex" $(find "$T/classes" -name '*.class')
(cd "$T/dex" && zip -q "$T/base.apk" classes.dex)
"$SDK_BT/zipalign" -f -p 4 "$T/base.apk" "$T/aligned.apk"
"$SDK_BT/apksigner" sign --ks "$KEYSTORE" --ks-pass env:KEYPASS --out "$OUT" "$T/aligned.apk"
"$SDK_BT/apksigner" verify "$OUT"
rm -rf "$T" "$OUT.idsig"
