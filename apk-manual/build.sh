#!/bin/bash
set -e

export ANDROID_HOME=/opt/android-sdk
export BT=$ANDROID_HOME/build-tools/34.0.0
export PLATFORM=$ANDROID_HOME/platforms/android-34
export PROJECT=$(cd "$(dirname "$0")" && pwd)

echo "=== Building StormVision APK ==="
rm -rf $PROJECT/build/*
mkdir -p $PROJECT/build/classes $PROJECT/build/stage/assets/_expo/static/js/web

# 1. Compile Java
echo ">>> Compiling Java..."
javac -source 8 -target 8 -bootclasspath $PLATFORM/android.jar \
    -d $PROJECT/build/classes $PROJECT/src/java/com/stormvision/app/*.java 2>&1

# 2. Convert to DEX using dx (works on ARM64 via QEMU)
echo ">>> Converting to DEX..."
$ANDROID_HOME/build-tools/30.0.3/dx --dex --output=$PROJECT/build/classes.dex \
    --min-sdk-version=24 $PROJECT/build/classes 2>&1
echo "    DEX: $(wc -c < $PROJECT/build/classes.dex) bytes"

# 3. Compile resources
echo ">>> Compiling resources..."
$BT/aapt2 compile --dir $PROJECT/res -o $PROJECT/build/resources.zip 2>&1

# 4. Link APK
echo ">>> Linking APK..."
$BT/aapt2 link \
    --manifest $PROJECT/AndroidManifest.xml \
    --target-sdk-version 34 --min-sdk-version 24 \
    --version-code 1 --version-name "1.0.0" \
    -I $PLATFORM/android.jar \
    -o $PROJECT/build/unsigned.apk $PROJECT/build/resources.zip \
    --java $PROJECT/build/gen 2>&1

# 5. Stage and add files
cp $PROJECT/build/classes.dex $PROJECT/build/stage/classes.dex
cp $PROJECT/assets/index.html $PROJECT/build/stage/assets/index.html
cp $PROJECT/assets/favicon.ico $PROJECT/build/stage/assets/favicon.ico
for f in $PROJECT/assets/_expo/static/js/web/*.js; do
    [ -f "$f" ] && cp "$f" $PROJECT/build/stage/assets/_expo/static/js/web/
done

cd $PROJECT/build/stage
$BT/aapt add $PROJECT/build/unsigned.apk classes.dex 2>&1
$BT/aapt add $PROJECT/build/unsigned.apk assets/index.html 2>&1
$BT/aapt add $PROJECT/build/unsigned.apk assets/favicon.ico 2>&1
for f in assets/_expo/static/js/web/*.js; do
    [ -f "$f" ] && $BT/aapt add $PROJECT/build/unsigned.apk "$f" 2>&1
done
cd $PROJECT

# 6. Align
$BT/zipalign -f -p 4 $PROJECT/build/unsigned.apk $PROJECT/build/aligned.apk

# 7. Sign
if [ ! -f ~/.android/debug.keystore ]; then
    mkdir -p ~/.android
    keytool -genkey -v -keystore ~/.android/debug.keystore \
        -storepass android -alias androiddebugkey -keypass android \
        -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null
fi
$BT/apksigner sign \
    --ks ~/.android/debug.keystore \
    --ks-pass pass:android \
    --ks-key-alias androiddebugkey \
    --key-pass pass:android \
    --out $PROJECT/build/StormVision.apk $PROJECT/build/aligned.apk

# 8. Verify
echo ""
echo "=== VERIFICATION ==="
$BT/aapt2 dump badging $PROJECT/build/StormVision.apk 2>&1 | grep -E "package:|version|icon|label|launchable|sdkVersion|targetSdkVersion"
$BT/apksigner verify --verbose $PROJECT/build/StormVision.apk 2>&1 | head -4
echo ""
echo "=== FILES IN APK ==="
python3 -c "
import zipfile
z = zipfile.ZipFile('$PROJECT/build/StormVision.apk')
for e in z.infolist():
    print(f'  {e.filename}')
z.close()
"

# Copy
cp $PROJECT/build/StormVision.apk $PROJECT/../StormVision.apk

echo ""
echo "=== BUILD SUCCESSFUL ==="
ls -lh $PROJECT/build/StormVision.apk
