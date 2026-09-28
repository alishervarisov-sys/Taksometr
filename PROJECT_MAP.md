# ZaKi Taksometr — project map

Last verified against the source tree: 2026-09-20.

This file is an index, not a full specification. Its purpose is to let an AI or
developer jump directly to the relevant code without loading the whole project.

## 1. System at a glance

ZaKi Taksometr is a Firebase-backed delivery and taxi ecosystem:

```text
Android courier app ─┐
React admin panel ───┼── Firestore + callable/HTTP Cloud Functions
Windows admin app ───┘                 │
                                      ├── FCM notifications
                                      ├── GPS/route tracking
                                      ├── Telegram reports/taxi bot
                                      └── hosted tracking/admin pages
```

Primary technologies:

| Area | Stack | Main directory |
|---|---|---|
| Courier mobile app | Kotlin, Jetpack Compose, Hilt, Room, WorkManager | `android/` |
| Admin web app | React 18, TypeScript, Vite, MUI, Firebase Web SDK | `admin-panel/` |
| Backend | Firebase Functions v1, TypeScript, Node 22 | `firebase/functions/` |
| Database/security | Cloud Firestore rules and indexes | `firebase/` |
| Windows admin | C#, WPF, WebView2, SQLite, .NET 9 | `windows/ZaKi.Dispatcher/` |
| macOS packaging | Electron wrapper scripts | `macos/` |

Firebase project referenced by current configuration: `auva-70253`.

## 2. Fast routing: task → files

| Task | Start here | Usually also inspect |
|---|---|---|
| Android login/session | `presentation/auth/AuthViewModel.kt` | `data/repository/AuthRepositoryImpl.kt`, `domain/repository/AuthRepository.kt` |
| Android navigation/startup | `presentation/MainActivity.kt` | `presentation/navigation/NavGraph.kt`, `Screen.kt`, `ZaKiApp.kt` |
| Courier home/pending orders | `presentation/home/HomeViewModel.kt` | `HomeScreen.kt`, `PendingOrdersMapScreen.kt`, `DeliveryRepositoryImpl.kt` |
| Active delivery/meter | `presentation/delivery/ActiveDeliveryViewModel.kt` | `ActiveDeliveryScreen.kt`, `LocationTrackingService.kt`, `DeliveryRepositoryImpl.kt` |
| Complete/cancel delivery | `presentation/delivery/DeliveryCompleteViewModel.kt` | `CompletionSyncWorker.kt`, backend `completeDelivery`/`cancelDelivery` |
| Background GPS | `service/LocationTrackingService.kt` | `LocationRepositoryImpl.kt`, `RouteSyncWorker.kt`, `util/Constants.kt` |
| Shift tracking | `service/ShiftTrackingService.kt` | `BootReceiver.kt`, `courier_tracks` rules/indexes |
| Offline synchronization | `service/*SyncWorker.kt` | `data/local/dao/`, `data/local/entity/`, `ZaKiDatabase.kt` |
| Android data models | `domain/model/` | matching Room entities and backend documents |
| Android dependency injection | `di/AppModule.kt` | repository interfaces/implementations |
| Admin route or page | `admin-panel/src/App.tsx` | `components/Layout.tsx`, relevant `pages/*.tsx` |
| Admin Firebase setup | `admin-panel/src/firebase.ts` | page-level Firestore/Functions calls |
| Delivery backend | `firebase/functions/src/index.ts` | search exact exported function name; then rules/indexes |
| Smart Dispatch | `firebase/functions/src/dispatch/dispatch-service.ts` | `config-service.ts`, `candidate-search-service.ts`, `hungarian-assignment-service.ts` |
| Taxi orders/bot | `firebase/functions/src/taxi.ts` | `admin-panel/src/pages/Taxi.tsx` |
| Taxi-driver moderation | `firebase/functions/src/taxiDrivers.ts` | `admin-panel/src/pages/TaxiDrivers.tsx` |
| Firestore permissions | `firebase/firestore.rules` | callers in Android/admin/Functions and `firestore.indexes.json` |
| Windows shell/login/sync | `windows/ZaKi.Dispatcher/App.xaml.cs` | `LoginWindow*`, `FullAdminWindow*`, `Services/`, `Data/LocalDatabase.cs` |
| Embedded admin in Windows | `Services/EmbeddedWebAdmin.cs` | `Assets/webadmin.zip`; source remains `admin-panel/src/` |
| Version enforcement | `presentation/version/AppVersionViewModel.kt` | `settings/appVersion`, backend `setMinAppVersion`, admin `AppVersions.tsx` |
| Commission/balance | Android `profile/OperationsScreen.kt` | admin `Commission.tsx`, backend functions containing `Commission`, `Balance`, or `Transaction` |
| Release/deployment | `DEPLOY_INSTRUCTIONS.md` | current Gradle/package/csproj config; never deploy implicitly |

All Android paths in this table are relative to:
`android/app/src/main/java/com/zaki/taksometr/`.

## 3. Android application

### Entry points and architecture

- Application: `ZaKiApp.kt`
- Activity: `presentation/MainActivity.kt`
- Navigation: `presentation/navigation/NavGraph.kt`, `Screen.kt`
- Manifest/services/permissions: `android/app/src/main/AndroidManifest.xml`
- Build/version/dependencies: `android/app/build.gradle.kts`
- Constants and Firestore names: `util/Constants.kt`
- DI bindings: `di/AppModule.kt`
- Room database: `data/local/ZaKiDatabase.kt`

The practical dependency direction is:

```text
Compose Screen → ViewModel → domain repository interface
                              ↓
                     data repository implementation
                       ↙ Room       ↘ Firebase/Functions
```

There is no current `domain/usecase/` layer despite older README text. Some
ViewModels also access Firestore directly, so search the ViewModel as well as the
repository when tracing a feature.

### Screen routes

`Screen.kt` defines: `auth`, `admin_panel`, `home`, `pending_orders_map`,
`active_delivery`, `delivery_complete/{deliveryId}`, `profile`, `daily_stats`,
`operations`, `courier_notifications`, `history`,
`delivery_detail/{deliveryId}`, and `delivery_chain`.

Note: a `delivery_chain` route and backend/domain code exist, but the current
source tree has no `presentation/deliverychain/` screen. Verify current behavior
before relying on the older delivery-chain documentation.

### Data and background work

- Domain models: `domain/model/`
- Repository contracts: `domain/repository/`
- Firebase/Room implementations: `data/repository/`
- Room entities and DAOs: `data/local/entity/`, `data/local/dao/`
- Delivery GPS: `service/LocationTrackingService.kt`
- Whole-shift breadcrumbs: `service/ShiftTrackingService.kt`
- Retry/offline work: `CompletionSyncWorker.kt`, `OperationSyncWorker.kt`,
  `RouteSyncWorker.kt`
- Push messages: `ZaKiFirebaseMessagingService.kt`
- Device restart recovery: `BootReceiver.kt`
- Home-screen widget: `widget/TaksometrWidgetProvider.kt`

Important values in `Constants.kt`: delivery location every 3 seconds, shift
location every 25 seconds, 30-day track retention, 200 m pickup-arrival radius,
and at most 2 concurrent in-progress deliveries.

## 4. Admin web application

Entry chain:

```text
src/main.tsx → src/App.tsx → components/Layout.tsx → pages/*.tsx
```

Authentication state is currently stored in browser `localStorage` by
`App.tsx`. Firestore and callable Function access is mostly implemented directly
inside each page, so for a page-specific task begin with that single page.

Active routes/pages:

- `/` → `Dashboard.tsx`
- `/couriers` → `Couriers.tsx`
- `/winner` → `Winner.tsx`
- `/tariffs` → `Tariffs.tsx`
- `/deliveries` → `Deliveries.tsx`
- `/clients` → `Clients.tsx`
- `/map` → `MapView.tsx`
- `/tracking` → `Tracking.tsx`
- `/statistics` → `Statistics.tsx`
- `/analytics` → `Analytics.tsx`
- `/commission` → `Commission.tsx`
- `/credentials` → `Credentials.tsx`
- `/admins` → `Admins.tsx` (SUPER_ADMIN only)
- `/telegram-report` → `TelegramReport.tsx`
- `/taxi` → `Taxi.tsx`
- `/taxi-drivers` → `TaxiDrivers.tsx`
- `/app-versions` → `AppVersions.tsx`

The delivery-chain admin route is removed in the current `App.tsx`.

Generated copies of the admin build live in `firebase/hosting/`, top-level
`hosting/`, Android assets, and the Windows embedded ZIP. Do not hand-edit them.

## 5. Firebase backend

### Configuration

- Project/deploy layout: `firebase/firebase.json`
- Security rules: `firebase/firestore.rules`
- Composite indexes: `firebase/firestore.indexes.json`
- Main functions: `firebase/functions/src/index.ts`
- Taxi bot/orders: `firebase/functions/src/taxi.ts`
- Taxi-driver administration: `firebase/functions/src/taxiDrivers.ts`

`index.ts` is large. Never read it from top to bottom by default. Find a function
with, for example:

```powershell
rg -n "export const completeDelivery|completeDelivery" firebase/functions/src/index.ts
```

Function groups in `index.ts` include delivery lifecycle and marketplace,
courier/admin management, tariff/statistics, commission/balance/transactions,
notifications/location requests, delivery chains, Telegram reports, monthly
winner, Motorol integration, app-version enforcement, and admin sync triggers.

Taxi exports are re-exported from `index.ts`. `taxi.ts` owns order creation and
the Telegram poller; `taxiDrivers.ts` owns approve/reject/block/broadcast/create.

### Main Firestore contract

Search all clients plus rules before changing a field. Important collections:

- `users`: admins, couriers, client linkage, balance, status/location
- `deliveries`: standard and marketplace delivery lifecycle/routes/cost
- `tariffs`: pricing configuration
- `settings`: commission, app version, Telegram/taxi state
- `transactions`: courier commission/balance operations
- `courier_tracks/{courierId}/points`: on-shift breadcrumbs
- `courierNotifications`: durable notification queue/status
- `winner_announcements`: monthly winner announcements
- `delivery_chains`, `chain_delivery_items`: chain workflow
- `taxi_orders`, `taxiDrivers`, `taxiRegistrationSessions`, `taxiAuditLog`:
  taxi flow
- `balanceTransfers`, `courierAssignments`, `deliveryEditHistory`: audit/workflow
- `deliveries/{deliveryId}/dispatchHistory`: Smart Dispatch candidate and offer audit trail
- `_syncChanges`: Windows/admin synchronization feed

The exact deployed schema is implicit in source code and rules; there is no
single schema file. Treat server-side validation and rules as part of the model.

## 6. Windows and macOS wrappers

Windows source is `windows/ZaKi.Dispatcher/`:

- `App.xaml.cs`: process/application startup
- `LoginWindow.xaml(.cs)`: login
- `FullAdminWindow.xaml(.cs)`: main WebView-based admin shell
- `MainWindow.xaml(.cs)`: alternate/legacy window; verify callers before editing
- `Services/FirebaseRestClient.cs`: Firebase REST access
- `Services/SyncService.cs`: sync logic
- `Services/EmbeddedWebAdmin.cs`: extracts/serves embedded web admin
- `Data/LocalDatabase.cs`: local SQLite state
- `ZaKi.Dispatcher.csproj`: .NET 9 WPF packaging

Ignore `bin/`, `obj/`, `publish-onefile/`, `release/`, packaged EXEs/ZIPs, and
`Assets/webadmin.zip` unless the user is specifically building a release.

`macos/` is a small Electron packaging wrapper (`main.js`, `package.json`,
`build-macos.sh`), not another source implementation of the business logic.

## 7. Verification commands

Run commands from the directory shown. Installing dependencies may require
network access; do not reinstall when the existing environment is sufficient.

### Android

```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
```

Unit coverage is currently small (`GreetingTest.kt` and
`CourierNotificationsSecurityTest.kt`), so also compile the affected Android
variant for non-trivial changes.

### Admin panel

```powershell
cd admin-panel
npm run build
```

There is no configured web test script; TypeScript plus Vite build is the main
local check.

### Cloud Functions

```powershell
cd firebase/functions
npm run build
```

### Windows

```powershell
dotnet build windows/ZaKi.Dispatcher/ZaKi.Dispatcher.csproj
```

## 8. Documentation reliability

Useful but potentially historical root documents include `README.md`,
`00_START_HERE.md`, delivery-chain guides, deployment reports, and release notes.
Use them for intent and operational context, not as proof of current code.

Priority when sources disagree:

1. Current executable source and build configuration
2. Firestore rules/indexes and client/backend call sites
3. Current tests
4. This map
5. README files, reports, checklists, and old release artifacts

## 9. Keeping this map useful

Update this file in the same change whenever you add/remove a major module,
entry point, route, Firestore collection, generated copy, or verification
command. Keep it concise: link to code; do not duplicate implementation details.
