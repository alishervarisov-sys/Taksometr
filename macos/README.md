# ZaKi Admin for macOS

The macOS application embeds the same production React/Firebase admin panel as
the web and Windows versions. Chromium keeps Firestore's persistent IndexedDB
cache under the app profile, so previously loaded data is available during a
temporary connection outage.

## Build the one-file installer

Run on a Mac with Node.js installed:

```zsh
./build-macos.sh
```

The result is `release/ZaKi-Admin-macOS-universal.dmg`. It supports both Intel
and Apple Silicon iMac computers. For distribution without a Gatekeeper warning,
build with an Apple Developer ID Application certificate and notarization
credentials configured in the environment.
