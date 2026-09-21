# AI working instructions

## Start here

This is a multi-client delivery/taxi system. Use `PROJECT_MAP.md` as the project
index instead of recursively reading the repository.

For every task:

1. Read this file.
2. Consult only the relevant section of `PROJECT_MAP.md`.
3. Open the entry point and the smallest set of files named there.
4. Use `rg` for symbols, routes, collection names, and callers before opening
   additional files.
5. Expand the search only when the targeted files do not answer the question.

## Source of truth

- Android app: `android/app/src/main/`
- Web admin: `admin-panel/src/`
- Cloud Functions: `firebase/functions/src/`
- Firestore policy: `firebase/firestore.rules` and
  `firebase/firestore.indexes.json`
- Windows desktop wrapper: `windows/ZaKi.Dispatcher/`, excluding build output
- Shared data contract: actual reads/writes in the clients, Functions, and rules

Treat old reports and deployment notes as historical unless current source code
confirms them. In particular, the delivery-chain documentation describes work
that is only partly present in the current UI.

## Never scan or edit unless explicitly requested

- `*.apk`, `*.idsig`, `*.exe`, `*.zip`
- `node_modules/`, `lib/`, `dist/`, `build/`, `bin/`, `obj/`, `.gradle/`
- `hosting/`, `firebase/hosting/`, `android/app/src/main/assets/admin/`
- `windows/publish-onefile/`, `windows/release/`
- minified/generated JavaScript such as `index-*.js`
- `google-services.json`, keystores, service-account files, or `.env` files

The three web-output directories are generated copies of `admin-panel`; make UI
changes in `admin-panel/src/` first.

## Change discipline

- Preserve unrelated user changes.
- Do not deploy, sign APKs, publish Windows binaries, or modify production data
  unless the user explicitly asks.
- For cross-client features, verify the Firestore/Function contract in every
  affected client and in security rules.
- Keep `PROJECT_MAP.md` updated when entry points, modules, commands, routes,
  collections, or generated-output locations change.
- Run the narrowest relevant verification from `PROJECT_MAP.md` after edits.
