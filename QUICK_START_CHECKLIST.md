# ✅ Быстрый чек-лист интеграции "Дерево заказов"

## 🎯 Используйте этот чек-лист для быстрой интеграции

Просто отмечайте пункты по мере выполнения!

---

## 📱 Android приложение

### 1. Gradle синхронизация
- [ ] Открыть Android Studio
- [ ] Нажать "Sync Now" вверху экрана
- [ ] Дождаться завершения синхронизации
- [ ] Убедиться что нет ошибок

**Ожидаемый результат:** Проект синхронизирован, зависимость `reorderable:0.9.6` загружена

---

### 2. Dependency Injection (DI)

**Файл:** `di/AppModule.kt`

- [ ] Открыть файл `di/AppModule.kt`
- [ ] Найти другие `@Provides` функции
- [ ] Вставить после них:

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

- [ ] Добавить импорты (Alt+Enter на красном тексте)
- [ ] Сохранить файл

**Ожидаемый результат:** Нет ошибок компиляции

---

### 3. Навигация

**Файл:** `presentation/navigation/NavGraph.kt` (или аналогичный)

- [ ] Открыть файл с навигацией
- [ ] Найти блок с другими `composable(...)`
- [ ] Добавить:

```kotlin
composable("delivery_chain") {
    DeliveryChainScreen(
        onBack = { navController.popBackStack() }
    )
}
```

- [ ] Добавить импорт:
```kotlin
import com.zaki.taksometr.presentation.deliverychain.DeliveryChainScreen
```

- [ ] Сохранить файл

**Ожидаемый результат:** Нет ошибок компиляции

---

### 4. Кнопка в главном меню

**Файл:** `presentation/home/HomeScreen.kt` (или аналогичный)

- [ ] Открыть файл главного экрана
- [ ] Найти место где отображаются кнопки/карточки меню
- [ ] Добавить кнопку (выберите один вариант):

**Вариант А - Card:**
```kotlin
Card(
    onClick = { /* navController */ .navigate("delivery_chain") },
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
            modifier = Modifier.size(32.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column {
            Text(
                "Дерево заказов",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                "Цепочка доставок",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray
            )
        }
    }
}
```

**Вариант Б - Button:**
```kotlin
Button(
    onClick = { /* navController */ .navigate("delivery_chain") },
    modifier = Modifier.fillMaxWidth()
) {
    Icon(Icons.Default.List, null)
    Spacer(modifier = Modifier.width(8.dp))
    Text("Дерево заказов")
}
```

- [ ] Заменить `/* navController */` на вашу переменную навигации
- [ ] Добавить импорт:
```kotlin
import androidx.compose.material.icons.filled.List
```

- [ ] Сохранить файл

**Ожидаемый результат:** Кнопка отображается в меню

---

### 5. Тестовый запуск Android

- [ ] Build → Clean Project
- [ ] Build → Rebuild Project
- [ ] Запустить приложение на эмуляторе/устройстве
- [ ] Войти как курьер
- [ ] Найти кнопку "Дерево заказов"
- [ ] Нажать на кнопку
- [ ] Убедиться что экран открывается без ошибок

**Ожидаемый результат:** Экран "Дерево заказов" открывается, показывает "Создайте дерево заказов"

---

## 🌐 Admin Panel

### 6. Маршрут в App.tsx

**Файл:** `admin-panel/src/App.tsx`

- [ ] Открыть `admin-panel/src/App.tsx`
- [ ] Добавить импорт в начало файла:
```typescript
import DeliveryChains from './pages/DeliveryChains';
```

- [ ] Найти блок `<Routes>` или `<Switch>`
- [ ] Добавить маршрут:
```typescript
<Route path="/delivery-chains" element={<DeliveryChains adminId={adminId} />} />
```

- [ ] Сохранить файл

**Ожидаемый результат:** Нет ошибок компиляции TypeScript

---

### 7. Пункт меню

**Файл:** `admin-panel/src/components/Layout.tsx` (или `App.tsx`)

- [ ] Открыть файл с меню
- [ ] Добавить импорт:
```typescript
import { ListAlt } from '@mui/icons-material';
```

- [ ] Найти список пунктов меню
- [ ] Добавить пункт:
```typescript
<ListItem button onClick={() => navigate('/delivery-chains')}>
  <ListItemIcon><ListAlt /></ListItemIcon>
  <ListItemText primary="Деревья заказов" />
</ListItem>
```

- [ ] Сохранить файл

**Ожидаемый результат:** Пункт меню появился в навигации

---

### 8. Тестовый запуск Admin Panel

- [ ] Открыть терминал
- [ ] `cd admin-panel`
- [ ] `npm start` (или `npm run dev`)
- [ ] Открыть http://localhost:3000 (или другой порт)
- [ ] Войти как администратор
- [ ] Найти пункт "Деревья заказов"
- [ ] Нажать на пункт
- [ ] Убедиться что страница открывается

**Ожидаемый результат:** Страница "Деревья заказов" открывается, показывает таблицу

---

## ☁️ Firebase Functions

### 9. Deploy функций

- [ ] Открыть терминал
- [ ] `cd firebase/functions`
- [ ] `npm install` (если еще не делали)
- [ ] `npm run build`
- [ ] Проверить что нет ошибок компиляции TypeScript
- [ ] `firebase login` (если еще не залогинены)
- [ ] `firebase deploy --only functions`
- [ ] Дождаться завершения деплоя

**Ожидаемый результат:** 
```
✔  functions: Finished running deploy script.
✔  functions[startDeliveryChain(...)]: Successful create operation.
✔  functions[completeChainDelivery(...)]: Successful create operation.
✔  functions[cancelDeliveryChain(...)]: Successful create operation.
✔  functions[adminCreateDeliveryChain(...)]: Successful create operation.
✔  functions[adminCancelDeliveryChain(...)]: Successful create operation.
✔  functions[adminCompleteDelivery(...)]: Successful update operation.
```

---

## 🗃️ Firestore Индексы

### 10. Создать индексы

- [ ] Открыть Firebase Console: https://console.firebase.google.com
- [ ] Выбрать проект
- [ ] Firestore Database → Indexes
- [ ] Нажать "Create Index"

**Индекс 1:**
- [ ] Collection ID: `delivery_chains`
- [ ] Поля:
  - [ ] `courierId` → Ascending
  - [ ] `status` → Ascending  
  - [ ] `createdAt` → Descending
- [ ] Нажать "Create"
- [ ] Дождаться создания (может занять несколько минут)

**Индекс 2:**
- [ ] Collection ID: `chain_delivery_items`
- [ ] Поля:
  - [ ] `chainId` → Ascending
  - [ ] `sequenceOrder` → Ascending
- [ ] Нажать "Create"
- [ ] Дождаться создания

**Индекс 3:**
- [ ] Collection ID: `chain_delivery_items`
- [ ] Поля:
  - [ ] `chainId` → Ascending
  - [ ] `status` → Ascending
- [ ] Нажать "Create"
- [ ] Дождаться создания

**Ожидаемый результат:** Все 3 индекса в статусе "Enabled" (зеленая галочка)

---

## 🧪 Полное тестирование

### 11. Тест: Курьер создает цепочку

- [ ] Открыть Android приложение
- [ ] Войти как курьер
- [ ] Нажать "Дерево заказов"
- [ ] Нажать "Создать дерево заказов"
- [ ] Нажать FAB (+)
- [ ] Выбрать тип доставки
- [ ] Ввести номер телефона: `+992901234567`
- [ ] Ввести номер заказа: `TEST-001`
- [ ] Нажать "Добавить"
- [ ] Убедиться что заказ появился в списке

**Ожидаемый результат:** Заказ добавлен, отображается с номером 1

---

### 12. Тест: Добавление нескольких заказов

- [ ] Нажать FAB (+) снова
- [ ] Добавить заказ `TEST-002`
- [ ] Добавить заказ `TEST-003`
- [ ] Убедиться что все 3 заказа в списке

**Ожидаемый результат:** 3 заказа с порядковыми номерами 1, 2, 3

---

### 13. Тест: Изменение порядка

- [ ] Нажать и удерживать заказ №2
- [ ] Перетащить на место заказа №1
- [ ] Отпустить
- [ ] Убедиться что порядок изменился

**Ожидаемый результат:** Порядок: TEST-002 (1), TEST-001 (2), TEST-003 (3)

---

### 14. Тест: Запуск цепочки

- [ ] Нажать "Запустить цепочку"
- [ ] Убедиться что статус изменился на "Выполняется"
- [ ] Убедиться что первый заказ подсвечен как "В процессе"

**Ожидаемый результат:** 
- Цепочка в статусе "Выполняется"
- Первый заказ "В процессе"
- Остальные "Ожидают"

---

### 15. Тест: Завершение доставки

- [ ] Ввести время ожидания (например 5)
- [ ] Нажать "Завершить и перейти к следующему"
- [ ] Дождаться завершения запроса
- [ ] Убедиться что:
  - [ ] Первый заказ стал "Завершено"
  - [ ] Второй заказ стал "В процессе"

**Ожидаемый результат:** Автоматический переход к следующему заказу

---

### 16. Тест: Администратор создает цепочку

- [ ] Открыть админ-панель
- [ ] Перейти в "Деревья заказов"
- [ ] Нажать "Создать дерево заказов"
- [ ] Выбрать курьера
- [ ] Добавить 2 заказа
- [ ] Нажать "Создать и назначить курьеру"
- [ ] Убедиться что цепочка появилась в списке

**Ожидаемый результат:** 
- Цепочка создана
- Статус "Выполняется"
- Курьер получил push-уведомление (если у него установлен FCM токен)

---

### 17. Тест: SMS уведомления

- [ ] Использовать реальный номер телефона Таджикистана
- [ ] Создать заказ с этим номером
- [ ] Запустить цепочку
- [ ] Проверить SMS на начало доставки
- [ ] Завершить доставку
- [ ] Проверить SMS на завершение

**Ожидаемый результат:** 
- SMS при начале получено
- SMS при завершении получено
- Текст на таджикском языке
- Информация корректная

---

## 🎉 Финал

### 18. Финальная проверка

- [ ] Все чекбоксы выше отмечены ✅
- [ ] Android приложение работает без ошибок
- [ ] Admin Panel работает без ошибок
- [ ] Firebase Functions задеплоены
- [ ] Firestore индексы созданы
- [ ] SMS приходят клиентам
- [ ] Комиссия списывается корректно

**Поздравляем! 🎊 Функция "Дерево заказов" полностью интегрирована!**

---

## 🐛 Если что-то не работает

### Проблема: Ошибка компиляции Android

**Решение:**
1. File → Invalidate Caches → Invalidate and Restart
2. Build → Clean Project
3. Build → Rebuild Project
4. Попробовать снова

---

### Проблема: Cloud Function возвращает ошибку

**Решение:**
1. Firebase Console → Functions → Logs
2. Найти ошибку в логах
3. Проверить что .env файл настроен
4. Проверить что функция задеплоена

---

### Проблема: Firestore индекс не создается

**Решение:**
1. Подождать 5-10 минут
2. Обновить страницу
3. Если статус "Building" - это нормально
4. Если "Error" - удалить и создать заново

---

## 📚 Дополнительные ресурсы

- `README_DELIVERY_CHAINS.md` - подробная инструкция
- `DELIVERY_CHAINS_INTEGRATION.md` - детали интеграции
- `DELIVERY_CHAINS_FLOW.md` - блок-схемы
- `SUMMARY_RU.md` - полный отчет

---

## ⏱️ Ориентировочное время

- **Опытный разработчик:** 30-60 минут
- **Начинающий разработчик:** 2-3 часа
- **Deploy Firebase Functions:** 5-10 минут
- **Создание индексов:** 10-20 минут

---

**Успехов! 🚀**
