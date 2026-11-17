# Triplo for Android

A WebView wrapper around the web app in [`../frontend`](../frontend). The web
deployment is unchanged. The wrapper builds the same sources with
`VITE_TRIPLO_NATIVE=android` and `--base=/`, bundles the result into the APK
and serves it at `https://appassets.androidplatform.net/`.

Native-only features in the web code are guarded by `IS_NATIVE`
(`frontend/src/native/native.ts`). Web builds never set the variable.

## Requirements

- Android Studio (includes the Android SDK and a JDK 17+ runtime)
- Node.js 24 and Python 3 (used by the web build)

## Build

Open `android/` in Android Studio and run the `app` configuration, or from this
directory:

```sh
./gradlew assembleDebug
```

The `buildWeb` task runs `npm ci` (only if `frontend/node_modules` is missing)
and `npm run build` in `frontend/`. Pass `-PskipWeb` to reuse the last web build.

## Native bridge

`window.TriploNative` (origin-restricted web message listener) answers:

| Method | Purpose |
| --- | --- |
| `googleAuthorize` | Google Drive access token (scope `drive.file`) through Play services |
| `saveFile` | Saves a text export (GPX) through the system file picker |
| `galleryPermission` | Asks for photo access and the permission that keeps GPS in EXIF |

The page also reads photos from `/native/` (`GalleryHandler`): `query/<from>/<to>`
lists geotagged photos taken in the period, `thumb/<id>/<size>` and `full/<id>`
serve images. The Back button is offered to the page first
(`registerNativeBackHandler`).

## Images along the route

With a trip selected, the map's style menu has **Show images along route**
(native build only, needs a trip start and end date). The page asks for the
photos in the trip period, keeps those within 500 m of a visible segment (100 km
for flights, see `frontend/src/native/routeFilter.ts`), pins thumbnails on the
map, and shows them oldest first in a bottom panel. Tap a pin to select it, tap
the panel image or long-press a pin for the full-screen zoomable view.

Opening `https://csanadtelbisz.github.io/triplo/share/<token>` launches the app
at its own `/share/<token>` route.

## Releases and updates

[android.yml](../.github/workflows/android.yml) builds a signed APK on every
push to the default branch that touches the app or its web sources. It
publishes a GitHub release tagged `android-v<run number>` with the APK and a
`.sha256` file. The run number is the app's `versionCode`.

The app checks the latest release on start (at most every 6 hours), asks before
downloading, verifies the checksum and installs it with `PackageInstaller`.
Android applies self-updates without a confirmation screen (Android 12+). The
first update needs the "install unknown apps" permission for Triplo. Debug
builds never check for updates.

Create the release key once and keep a backup. An app signed with another key
cannot be updated and has to be uninstalled first:

```
keytool -genkeypair -v -keystore triplo-release.jks -alias triplo -keyalg RSA -keysize 4096 -validity 36500
```

Repository secrets used by the workflow:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("triplo-release.jks"))` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `triplo` |
| `ANDROID_KEY_PASSWORD` | Key password |
| `VITE_GOOGLE_DRIVE_API_KEY` | Optional, as for the web deploy |

For a local signed build, set `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, then run `./gradlew assembleRelease`.

## Google Cloud setup

The Android OAuth client is matched by package name
(`io.github.csanadtelbisz.triplo`) and the SHA-1 of the signing certificate.
Create one Android client per signing key. The release key is the one that
matters for installed apps. Add the debug key only to run from your machine.

```
keytool -list -v -keystore triplo-release.jks -alias triplo
keytool -list -v -keystore $env:USERPROFILE\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
```
