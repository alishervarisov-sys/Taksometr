# Интеграция функции "Дерево заказов"

## ✅ Уже реализовано:

1. ✅ Модели данных (DeliveryChain, ChainDeliveryItem)
2. ✅ База данных (Room entities, DAOs)
3. ✅ Репозиторий (DeliveryChainRepository)
4. ✅ ViewModel и UI экран (DeliveryChainScreen)
5. ✅ Admin Panel компонент (DeliveryChains.tsx)
6. ✅ Cloud Functions (все необходимые функции)

## 📝 Что нужно доделать:

### 1. Android App - Добавить навигацию

Нужно добавить экран DeliveryChainScreen в навигацию приложения.

**Файл для изменения:** `presentation/navigation/NavGraph.kt` или аналогичный

```kotlin
// Добавить маршрут
composable("delivery_chain") {
    DeliveryChainScreen(
        onBack = { navController.popBackStack() }
    )
}
```

**В HomeScreen или главном меню добавить кнопку:**

```kotlin
Button(
    onClick = { navController.navigate("delivery_chain") },
    modifier = Modifier.fillMaxWidth()
) {
    Icon(Icons.Default.List, null)
    Spacer(modifier = Modifier.width(8.dp))
    Text("Дерево заказов")
}
```

### 2. Android App - Подключить DI (Dependency Injection)

**Файл:** `di/AppModule.kt` или аналогичный

Добавить:

```kotlin
@Provides
@Singleton
fun provideDeliveryChainRepository(
    firestore: FirebaseFirestore,
    functions: FirebaseFunctions,
    chainDao: DeliveryChainDao,
    itemDao: ChainDeliveryItemDao,
    routePointDao: RoutePointDao,
    prefs: SharedPreferences
): DeliveryChainRepository {
    return DeliveryChainRepositoryImpl(
        firestore,
        functions,
        chainDao,
        itemDao,
        routePointDao,
        prefs
    )
}
```

### 3. Android App - Добавить зависимость для Reorderable

**Файл:** `android/app/build.gradle.kts`

Добавить в dependencies:

```kotlin
implementation("org.burnoutcrew.composereorderable:reorderable:0.9.6")
```

После добавления синхронизировать Gradle.

### 4. Admin Panel - Добавить в меню

**Файл:** `admin-panel/src/App.tsx` или `Layout.tsx`

Добавить маршрут:

```typescript
import DeliveryChains from './pages/DeliveryChains';

// В роутинге:
<Route path="/delivery-chains" element={<DeliveryChains adminId={adminId} />} />
```

Добавить пункт меню:

```typescript
<ListItem button onClick={() => navigate('/delivery-chains')}>
  <ListItemIcon><ListAlt /></ListItemIcon>
  <ListItemText primary="Деревья заказов" />
</ListItem>
```

### 5. Firebase - Деплой функций

После того как убедитесь что всё работает локально:

```bash
cd firebase/functions
npm run build
firebase deploy --only functions
```

### 6. Firestore - Создать индексы

Для оптимальной производительности создайте составные индексы:

**Консоль Firebase → Firestore Database → Indexes → Create Index:**

1. Collection: `delivery_chains`
   - Fields: `courierId` (Ascending), `status` (Ascending), `createdAt` (Descending)

2. Collection: `chain_delivery_items`
   - Fields: `chainId` (Ascending), `sequenceOrder` (Ascending)

3. Collection: `chain_delivery_items`
   - Fields: `chainId` (Ascending), `status` (Ascending)

### 7. Тестирование

**Тестовый сценарий:**

1. **Курьер:**
   - Открыть экран "Дерево заказов"
   - Создать новую цепочку
   - Добавить 2-3 заказа с разными номерами
   - Изменить порядок (drag & drop)
   - Запустить цепочку
   - Завершить первую доставку
   - Проверить что началась вторая
   - Завершить все доставки

2. **Администратор:**
   - Открыть "Деревья заказов"
   - Создать цепочку
   - Добавить заказы
   - Выбрать курьера
   - Запустить
   - Проверить что курьер получил уведомление
   - Отследить прогресс

3. **Клиент:**
   - Проверить что клиент получает SMS при начале доставки
   - Проверить что клиент получает SMS при завершении

## 🔧 Troubleshooting

### Проблема: Ошибка компиляции Kotlin

**Решение:** Убедитесь что все imports правильные. Возможно нужно добавить:
```kotlin
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.material3.*
```

### Проблема: Cloud Function не срабатывает

**Решение:** 
1. Проверьте логи в Firebase Console → Functions → Logs
2. Убедитесь что функция задеплоена: `firebase functions:log`
3. Проверьте что .env файл настроен правильно

### Проблема: База данных не обновляется

**Решение:**
1. Удалите приложение с устройства
2. Пересоберите проект (Clean + Rebuild)
3. Установите заново

## 📚 Дополнительная информация

- Все SMS отправляются через Payom.tj
- Комиссия списывается за каждую доставку в цепочке
- Цепочку можно отменить на любом этапе
- История цепочек сохраняется в Firestore
- Локальный кеш в Room для офлайн работы
