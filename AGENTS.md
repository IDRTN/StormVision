# StormVision

## Build

### Manual APK build (works on ARM64 without NDK)
```bash
cd apk-manual && ./build.sh
```
Output: `StormVision.apk` in project root.

### Expo cloud build (EAS)
```bash
eas build --platform android
```

## APK Structure
- `MainActivity.java` - Java WebView with native sensor bridge (compass, pressure, mic, vibrate)
- `assets/index.html` - Main app: phone camera, 360° PiP overlay, cloud detection, compass, pressure
- Signed with v2+v3, 4-byte aligned

## Features
- Phone camera (getUserMedia) with cloud detection overlay
- Insta360 360° camera simulation with touch pan/tilt/zoom controls
- Picture-in-picture overlay for 360 camera
- Compass (native sensor)
- Barometric pressure (native sensor)
- Audio recording (native MediaRecorder)
- Storm detection & classification
- Motion tracking & wind direction estimation
