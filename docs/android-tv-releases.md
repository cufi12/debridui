# Android TV releases

The Android TV wrapper loads the hosted DebridUI web app. The existing `tv-latest` APK is a preview/debug build; it is not the stable release channel.

## Create the signing key

Create a long-lived Android upload/release keystore locally and store it securely. Keep a separate offline backup. Do not commit the keystore or send it in chat.

Add these repository Actions secrets under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: Base64-encoded keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing key alias.
- `ANDROID_KEY_PASSWORD`: signing key password.

On macOS/Linux, encode the keystore without printing or committing the binary:

```sh
base64 < debridui-release.keystore | tr -d '\n'
```

Paste the output directly into the GitHub secret value. Never add it to a source file or workflow log.

## Build and publish

The `Release DebridUI Android TV` workflow builds an unsigned APK on pull requests so the Gradle release variant is validated without exposing signing secrets. A tag matching `tv-vX.Y.Z` triggers a signed, stable GitHub release.

Example:

```sh
git tag tv-v1.0.1
git push origin tv-v1.0.1
```

The workflow uses its monotonically increasing GitHub Actions run number for Android's `versionCode`, and derives `versionName` from the tag.

Do not delete or replace the signing key after publishing the first stable APK. Android requires updates to be signed with the same key. If the key is lost, users generally need to uninstall the old app before installing a differently signed build.

## Preview APK

The existing `tv-latest` prerelease remains a preview channel. It is built from the debug variant and should not be treated as a stable upgrade path.
