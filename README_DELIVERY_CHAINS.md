# 🌳 Функция "Дерево заказов" - Инструкция по интеграции

## 📋 Что реализовано

Добавлена полная функциональность для создания цепочек доставок (дерево заказов):

### Для курьера:
- ✅ Создание нового дерева заказов
- ✅ Добавление заказов с номерами телефонов клиентов
- ✅ Указание номера заказа для каждого клиента
- ✅ Выбор типа доставки (по счетчику или фиксированная цена)
- ✅ Изменение очередности доставок (перетаскивание)
- ✅ Запуск цепочки доставок
- ✅ Автоматический переход к следующей доставке после завершения текущей
- ✅ SMS уведомления клиентам

### Для администратора:
- ✅ Просмотр всех цепочек заказов
- ✅ Создание новой цепочки
- ✅ Назначение курьера на цепочку
- ✅ Отслеживание прогресса выполнения
- ✅ Отмена цепочки

## 🚀 Быстрая интеграция (5 шагов)

### Шаг 1: Синхронизировать Gradle зависимости

Зависимость `reorderable` уже добавлена в `android/app/build.gradle.kts`.

В Android Studio:
1. Нажмите **"Sync Now"** вверху экрана
2. Или **File → Sync Project with Gradle Files**

### Шаг 2: Добавить навигацию в Android приложении

Откройте файл с навигацией (например `presentation/navigation/NavGraph.kt`):

```kotlin
import com.zaki.taksometr.presentation.deliverychain.DeliveryChainScreen

// В composable-функции с навигацией добавьте:
composable("delivery_chain") {
    DeliveryChainScreen(
        onBack = { navController.popBackStack() }
    )
}
```

### Шаг 3: Добавить кнопку в главное меню

В файле `HomeScreen.kt` (или где у вас главное меню) добавьте кнопку:

```kotlin
import androidx.compose.material.icons.filled.List

// В UI добавьте кнопку:
Card(
    onClick = { navController.navigate("delivery_chain") },
    modifier = Modifier
        .fillMaxWidth()
        .padding(vertical = 8.dp)
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.Default.List,
            contentDescription = null,
            modifier = Modifier.size(32.dp)
        )
        Spacer(modifier = Modifier.width(16.dp))
        Text(
            "Дерево заказов",
            style = MaterialTheme.typography.titleMedium
        )
    }
}
```

### Шаг 4: Добавить DI (Dependency Injection)

Откройте `di/AppModule.kt` (или аналогичный файл с Hilt модулями):

```kotlin
import com.zaki.taksometr.data.repository.DeliveryChainRepositoryImpl
import com.zaki.taksometr.domain.repository.DeliveryChainRepository

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    // ... существующие provides
    
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
}
```

### Шаг 5: Добавить страницу в Admin Panel

Откройте `admin-panel/src/App.tsx`:

```typescript
import DeliveryChains from './pages/DeliveryChains';

// Добавьте в Routes:
<Route path="/delivery-chains" element={<DeliveryChains adminId={adminId} />} />
```

Откройте файл с меню (например `Layout.tsx` или `App.tsx`):

```typescript
import { ListAlt } from '@mui/icons-material';

// Добавьте пункт меню:
<ListItem button onClick={() => navigate('/delivery-chains')}>
  <ListItemIcon><ListAlt /></ListItemIcon>
  <ListItemText primary="Деревья заказов" />
</ListItem>
```

## 🔥 Deploy Firebase Functions

После тестирования локально разверните функции:

```bash
cd firebase/functions
npm install
npm run build
firebase deploy --only functions
```

Новые функции:
- `startDeliveryChain`
- `completeChainDelivery`
- `cancelDeliveryChain`
- `adminCreateDeliveryChain`
- `adminCancelDeliveryChain`
- `adminCompleteDelivery`

## 🗃️ Firestore Индексы (важно!)

Создайте составные индексы в Firebase Console → Firestore → Indexes:

**Индекс 1:**
- Collection: `delivery_chains`
- Fields:
  - `courierId` → Ascending
  - `status` → Ascending
  - `createdAt` → Descending

**Индекс 2:**
- Collection: `chain_delivery_items`
- Fields:
  - `chainId` → Ascending
  - `sequenceOrder` → Ascending

**Индекс 3:**
- Collection: `chain_delivery_items`
- Fields:
  - `chainId` → Ascending
  - `status` → Ascending

## ✅ Тестирование

### Тест для курьера:
1. Откройте приложение курьера
2. Нажмите "Дерево заказов"
3. Нажмите "Создать дерево заказов"
4. Нажмите "+" (FAB) для добавления заказа
5. Выберите тип доставки
6. Введите номер телефона клиента
7. Введите номер заказа
8. Добавьте еще 1-2 заказа
9. Измените порядок перетаскиванием
10. Нажмите "Запустить цепочку"
11. Начните доставку первого заказа
12. Завершите - автоматически начнется следующий

### Тест для администратора:
1. Откройте админ-панель
2. Перейдите в "Деревья заказов"
3. Нажмите "Создать дерево заказов"
4. Выберите курьера
5. Добавьте несколько заказов
6. Нажмите "Создать и назначить курьеру"
7. Курьер получит push-уведомление
8. Отследите прогресс в списке

## 🐛 Возможные проблемы и решения

### Проблема: Ошибка компиляции "Cannot resolve DeliveryChainScreen"

**Решение:**
1. File → Invalidate Caches → Invalidate and Restart
2. Build → Clean Project
3. Build → Rebuild Project

### Проблема: Cloud Function возвращает ошибку

**Решение:**
1. Проверьте логи: Firebase Console → Functions → Logs
2. Убедитесь что функции задеплоены
3. Проверьте `.env` файл в `firebase/functions/`

### Проблема: База данных не обновляется

**Решение:**
1. Полностью удалите приложение с устройства
2. Rebuild проект
3. Переустановите приложение

### Проблема: Drag & Drop не работает

**Решение:**
Убедитесь что зависимость `reorderable` добавлена и Gradle синхронизирован:
```kotlin
implementation("org.burnoutcrew.composereorderable:reorderable:0.9.6")
```

## 📱 SMS уведомления

Клиенты получают SMS:
- ✉️ При начале доставки (с именем курьера и номером телефона)
- ✉️ При завершении доставки (с суммой и деталями)

Формат SMS на таджикском языке через Payom.tj API.

## 💰 Комиссия

- Комиссия списывается за каждую доставку в цепочке
- Используется либо индивидуальная комиссия курьера, либо глобальная
- Транзакции записываются в коллекцию `transactions`

## 📊 Статусы

### Статусы цепочки (DeliveryChain):
- `DRAFT` - Черновик, редактируется
- `IN_PROGRESS` - Выполняется
- `COMPLETED` - Все доставки завершены
- `CANCELLED` - Отменена

### Статусы заказа (ChainDeliveryItem):
- `PENDING` - Ожидает своей очереди
- `IN_PROGRESS` - Выполняется сейчас
- `COMPLETED` - Завершен
- `CANCELLED` - Отменен

## 🎯 Готово!

После выполнения всех шагов функция "Дерево заказов" будет полностью интегрирована в ваше приложение.

**Примечание:** Перед продакшн деплоем рекомендуется тщательное тестирование всех сценариев.
