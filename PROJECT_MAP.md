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
| Smart Dispatch | `firebase/functions/src/dispatch/dispatch-service.ts` | `config-service.ts`, `candidate-search-service.ts`, `routes-api-service.ts`, `hungarian-assignment-service.ts` |
| Taxi orders/bot | `firebase/functions/src/taxi.ts` | `admin-panel/src/pages/Taxi.tsx` |
| Taxi-driver moderation | `firebase/functions/src/taxiDrivers.ts` | `admin-panel/src/pages/TaxiDrivers.tsx` |
| Firestore permissions | `firebase/firestore.rules` | callers in Android/admin/Functions and `firestore.indexes.json` |
| Windows shell/login/sync | `windows/ZaKi.Dispatcher/App.xaml.cs` | `LoginWindow*`, `FullAdminWindow*`, `Services/`, `Data/LocalDatabase.cs` |
| Embedded admin in Windows | `Services/EmbeddedWebAdmin.cs` | `Assets/webadmin.zip`; source remains `admin-panel/src/` |
| Version enforcement | `presentation/version/AppVersionViewModel.kt` | `settings/appVersion`, backend `setMinAppVersion`, admin `AppVersions.tsx` |
| Commission/balance | Android `profile/OperationsScreen.kt` | admin `Commission.tsx`, backend functions containing `Commission`, `Balance`, or `Transaction` |
| Courier top-up requests / low balance | Android `profile/ProfileViewModel.kt`, `ProfileScreen.kt` | `util/BalanceNotification.kt`, `service/ZaKiFirebaseMessagingService.kt`, backend `balance-service.ts`, admin `components/BalanceRequests.tsx` |
| Admin browser push | `admin-panel/src/adminPush.ts` | `admin-panel/public/firebase-messaging-sw.js`, backend `admin-push.ts`, `settings/webPush` |
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
The `profile/top-up` route opens the profile's top-up form directly from a
system notification action or the courier inbox.

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
- `/smart-dispatch` → `SmartDispatch.tsx` (live offer/response audit and configuration)
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

Balance workflow (`balance-service.ts`): `requestBalanceTopUp` creates at most
one pending request per courier. `reviewBalanceTopUp` approves/rejects it;
approval atomically credits the balance once and records a `TOP_UP` ledger row
with `PAID` or `DEBT`. `notifyCourierLowBalance` emits a single actionable alert
at balance <= 10; any credit clears it, and a later debit can start a new alert.
Courier user documents mirror `pendingTopUpRequestId`, `pendingTopUpAmount`,
`lowBalanceNotificationActive`, `lowBalanceNotificationId`, and
`lowBalanceHandledAt`. Resolved warnings are hidden from the courier inbox.

Admin Web Push (`admin-push.ts`): `getBalanceTopUpRequests` reads pending requests
through a callable (clients have no direct collection access). Browser token
registration uses `registerAdminWebPush`. `notifyAdminsOfTopUpRequest` sends FCM
data messages handled by a native `push` event with `event.waitUntil`, even when
the panel tab is closed. The worker displays notifications before forwarding
the Firebase window message for live refresh, so visible login/tracking pages
cannot consume notifications. It reads the stored admin session after each
worker restart and suppresses messages after logout or account changes.
Each browser must grant notification permission. Configure the PUBLIC
Firebase Web Push key using the header notification dialog as SUPER_ADMIN
(`setAdminWebPushConfig`, `settings/webPush.vapidKey`) or the backend environment
variable `FIREBASE_WEB_PUSH_VAPID_KEY`. Existing custom login/verifyAdmin identity
semantics are unchanged; hardening authentication remains a separate task.
The project Web Push certificate was generated and its public key saved in
`settings/webPush.vapidKey` on 2026-10-02. The messaging client uses the registered
`zakitaksometr` web app (`1:286896671827:web:e3a11735f9298bf3dc0aa6`).
Published on 2026-10-02: the balance workflow's 12 new/updated Functions,
Firestore rules, the `balanceTopUpRequests` index (READY), and the admin panel
at `https://zakitaksometr.web.app`. Production read-only checks confirmed the
public Web Push configuration and pending-request callable. Each administrator
still needs to grant browser notification permission; delivery to a real device
has not been verified. Couriers need the updated Android build for the action.
The native push handler was published on 2026-10-02 after Chrome checks with
all site tabs closed and its worker stopped/restarted. CDP simulated transport;
actual FCM-to-device display still requires confirmation on the admin device.

Taxi exports are re-exported from `index.ts`. `taxi.ts` owns order creation and
the Telegram poller; `taxiDrivers.ts` owns approve/reject/block/broadcast/create.

### Main Firestore contract

Search all clients plus rules before changing a field. Important collections:

- `users`: admins, couriers, client linkage, balance, status/location
- `deliveries`: standard and marketplace delivery lifecycle/routes/cost
- `tariffs`: pricing configuration
- `settings`: commission, app version, Telegram/taxi state
- `transactions`: courier commission/balance operations
- `balanceTopUpRequests`: server-only pending/approved/rejected courier top-ups
- `adminPushTokens`: server-only browser FCM token registrations
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
- `Services/WindowsBalanceNotifications.cs`: native Windows toasts and 15-second
  polling of `getBalanceTopUpRequests`, independent of WebView2's unsupported Push API
- `Services/TopUpNotificationTracker.cs`: per-admin persisted deduplication and
  removal of notifications after requests are reviewed
- `Services/SingleInstance.cs`: per-Windows-user mutex and local named pipe;
  prevents duplicate monitoring and opens an existing hidden window
- `Data/LocalDatabase.cs`: local SQLite state
- `ZaKi.Dispatcher.csproj`: .NET 9 WPF packaging
- `installer/ZaKi-Admin-Windows.iss`: Windows installer definition
- `build-installer.ps1`: publishes the app and produces the installer

Version 1.3.0 keeps running in the tray when its main window is closed. Tray
actions open the panel/requests, test Windows notifications, or exit fully.
The installer offers background startup (`--background`) at Windows login.
WebView2 receives `window.zakiDesktopNotifications`; native notification clicks
open `/commission?requestId=...`. Web/native logout stops monitoring and clears
that administrator's notification history. Delivery uses native polling, not
FCM Web Push, and requires the background process and an internet connection.
The release script builds current web sources before embedding `webadmin.zip`.

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

TypeScript plus Vite build is the main local web compilation check.
`npm run test:push-worker` checks worker restart with no tabs, unrelated visible
pages, logout/account isolation, malformed payloads, and notification navigation.

### Cloud Functions

```powershell
cd firebase/functions
npm run build
```

Balance workflow verification (same Cloud Functions directory):
`npm run test:balance` covers competing approvals, duplicate retries, no credit
on submission/rejection, paid/debt records, and low-balance event ordering.

### Windows

```powershell
dotnet build windows/ZaKi.Dispatcher/ZaKi.Dispatcher.csproj
```
Run notification-state checks with
`dotnet run --project windows/ZaKi.Dispatcher.Tests -c Release`.
Release packaging: `./windows/build-installer.ps1 -Version 1.3.0`.
`--verify-package` checks the bundled panel/SQLite; `--verify-notifications
--output=<path>` verifies the Windows toast API without creating financial data.

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
