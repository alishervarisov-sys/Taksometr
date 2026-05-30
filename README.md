# ZaKi Taksometr

Полноценное Android-приложение для курьерской доставки с GPS-тракингом, расчетом стоимости и админ-панелью.

## Структура проекта

```
ZaKiTaksometr/
├── android/                    # Android приложение (Kotlin + Jetpack Compose)
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── java/com/zaki/taksometr/
│   │   │   │   ├── data/          # Data layer
│   │   │   │   │   ├── local/     # Room Database
│   │   │   │   │   ├── remote/    # Firebase
│   │   │   │   │   └── repository/ # Repository implementations
│   │   │   │   ├── domain/        # Domain layer
│   │   │   │   │   ├── model/     # Data models
│   │   │   │   │   ├── repository/ # Repository interfaces
│   │   │   │   │   └── usecase/   # Use cases
│   │   │   │   ├── di/            # Hilt DI modules
│   │   │   │   ├── presentation/  # UI layer
│   │   │   │   │   ├── auth/      # Login screen
│   │   │   │   │   ├── home/      # Main screen
│   │   │   │   │   ├── delivery/  # Active delivery & completion
│   │   │   │   │   ├── history/   # Delivery history
│   │   │   │   │   ├── navigation/ # Navigation
│   │   │   │   │   └── theme/     # Material 3 theme
│   │   │   │   ├── service/       # Foreground service, FCM, Workers
│   │   │   │   └── util/          # Utilities
│   │   │   └── res/
│   │   └── google-services.json
│   ├── build.gradle.kts
│   └── settings.gradle.kts
├── firebase/                   # Firebase configuration
│   ├── functions/              # Cloud Functions (TypeScript)
│   │   └── src/index.ts
│   ├── firestore.rules         # Security rules
│   ├── firestore.indexes.json
│   └── firebase.json
└── admin-panel/                # React Admin Panel
    ├── src/
    │   ├── pages/              # Dashboard, Couriers, Tariffs, etc.
    │   ├── components/         # Layout, shared components
    │   └── firebase.ts         # Firebase config
    ├── package.json
    └── index.html
```

## Настройка

### 1. Firebase

1. Перейдите в [Firebase Console](https://console.firebase.google.com)
2. Откройте проект `auva-70253`
3. Добавьте Android-приложение с package name: `com.zaki.taksometr`
4. Скачайте `google-services.json` и замените файл в `android/app/`
5. Включите сервисы:
   - Authentication
   - Cloud Firestore
   - Cloud Functions
   - Cloud Messaging
   - Crashlytics
   - Analytics

### 2. Инициализация Firestore

Создайте начальные документы:

```javascript
// Коллекция tariffs - документ "default"
{
  baseCost: 5000,
  costPerKm: 1500,
  currency: "сум",
  isActive: true,
  updatedAt: Date.now()
}

// Коллекция users - документ администратора
{
  login: "admin",
  passwordHash: "SHA-256 hash пароля",
  name: "Администратор",
  phone: "",
  role: "ADMIN",
  isOnline: false,
  isBlocked: false,
  createdAt: Date.now(),
  fcmToken: ""
}
```

### 3. Cloud Functions

```bash
cd firebase/functions
npm install
npm run build
firebase deploy --only functions
```

### 4. Firestore Rules

```bash
cd firebase
firebase deploy --only firestore:rules
```

### 5. Admin Panel

```bash
cd admin-panel
npm install
npm run dev
```

### 6. Android

1. Откройте `android/` в Android Studio
2. Замените `MAPS_API_KEY` в `local.properties`
3. Замените `google-services.json`
4. Build & Run

## Архитектура

- **Clean Architecture**: Data → Domain → Presentation
- **MVVM**: ViewModel + StateFlow + Compose
- **DI**: Hilt
- **Local DB**: Room
- **Remote**: Firebase Firestore + Cloud Functions
- **GPS**: Fused Location Provider + Foreground Service
- **Background**: WorkManager для синхронизации

## Алгоритм GPS

- Обновление каждые 3 секунды
- Фильтрация по точности (< 20м)
- Фильтрация GPS-скачков (макс. скорость 180 км/ч)
- Минимальное расстояние между точками: 5м
- Haversine formula для расчета расстояния
- Работает в Foreground Service (свернутое приложение, выключенный экран)
- Автовосстановление после перезагрузки (BootReceiver)

## Расчет стоимости

```
Стоимость = Базовая цена + (Километры × Тариф за км)
```

Все расчеты выполняются на сервере через Cloud Functions.

## Безопасность

- Firestore Security Rules с разделением ролей
- Запрет изменения стоимости на клиенте
- Запрет удаления завершенных доставок
- Валидация через Cloud Functions
- SHA-256 хеширование паролей
