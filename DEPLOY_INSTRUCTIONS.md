# Инструкция по развертыванию обновлений

## Что было добавлено

### 1. Админ-панель (React)
- Добавлена кнопка "Назначить клиенту" (иконка PersonAdd) в таблице курьеров
- Модальное окно для ввода номера телефона клиента
- Автоматическая отправка SMS клиенту на таджикском языке

### 2. Firebase Functions
- Новая функция `assignCourierToClient` для назначения курьера клиенту
- SMS отправляется через Payom.tj на таджикском языке
- Проверки: курьер не заблокирован и в сети

## Текст SMS (на таджикском)

```
Расонандаи мо [Имя] (тел: [телефон]) барои шумо таъин карда шуд. 
Барои фармоиш додан бо ӯ тамос гиред. 
Барномаи ZaKi: https://clck.ru/3TuGb6
```

## Как развернуть

### 1. Развернуть Firebase Functions

```bash
cd "c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\firebase"
firebase deploy --only functions
```

### 2. Пересобрать и развернуть админ-панель

```bash
cd "c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\admin-panel"
npm run build
```

Затем скопировать содержимое папки `dist` в `firebase/hosting`:

```bash
xcopy /E /I /Y dist "c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\firebase\hosting"
```

### 3. Развернуть хостинг

```bash
cd "c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\firebase"
firebase deploy --only hosting
```

## Как использовать

1. Откройте админ-панель
2. Перейдите на страницу "Курьеры"
3. Найдите нужного курьера в таблице
4. Нажмите на иконку с человечком (PersonAdd) в колонке "Действия"
5. В появившемся окне введите номер телефона клиента (формат: +992XXXXXXXXX или 9XXXXXXXX)
6. Нажмите кнопку "Назначить"
7. Клиент получит SMS на таджикском языке с информацией о курьере

## Проверки при назначении

- Курьер не должен быть заблокирован
- Курьер должен быть в сети (isOnline = true)
- Номер телефона клиента автоматически нормализуется

## Логирование

Все назначения сохраняются в коллекцию `courierAssignments` с информацией:
- adminId - ID администратора
- courierId - ID курьера
- courierName - Имя курьера
- clientPhone - Номер телефона клиента
- createdAt - Время назначения
