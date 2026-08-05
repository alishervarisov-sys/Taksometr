# 🏙️ Гайд по запуску Taksometr в новом городе

## 📋 Текущее состояние проекта

**Проект:** ZaKi Taksometr — сервис доставки и такси для Таджикистана  
**Текущий город:** Бохтар  
**Целевой город:** Душанбе  
**Firebase проект:** `auva-70253` (единый для всех городов)  
**Технологии:** Android (Kotlin) + Admin Panel (React/TypeScript) + Firebase

---

## ⚠️ КРИТИЧЕСКАЯ ПРОБЛЕМА: Отсутствие изоляции данных городов

### Что найдено в текущей архитектуре:

#### ✅ Что УЖЕ работает:
1. **Поле `city` у курьеров** — курьерам назначается город (Couriers.tsx:24)
2. **Список городов Таджикистана** — 20 городов включая Душанбе и Бохтар (Couriers.tsx:52-55)
3. **Глобальные тарифы** — единая система тарификации (Tariffs.tsx)
4. **Единая база Firebase** — все данные в одном проекте

#### ❌ Что НЕ работает (проблемы):

1. **НЕТ фильтрации по городу в админке**
   - Dashboard показывает всех курьеров всех городов
   - Deliveries показывает доставки всех городов
   - Analytics аггрегирует данные по всем городам
   - Map View показывает всех курьеров на карте

2. **НЕТ поля `city` у доставок**
   - Модель Delivery (Delivery.kt) не имеет поля city
   - Невозможно определить к какому городу относится доставка

3. **НЕТ разделения тарифов по городам**
   - Единый тариф `tariffs/default` для всех городов
   - Нельзя настроить разные цены для Душанбе и Бохтара

4. **НЕТ географических границ городов**
   - Нет определения "зоны обслуживания" города
   - Курьер из Бохтара может принять заказ в Душанбе

5. **НЕТ городской изоляции в Firebase Functions**
   - `createCourier` сохраняет city, но не проверяет
   - `getStatistics` возвращает данные всех городов

6. **НЕТ иерархии прав доступа**
   - Нет роли "Супер Админ"
   - Нет разделения прав между админами городов
   - Админы не привязаны к конкретным городам

---

## 👑 Система прав доступа: Иерархия администраторов

### Роли в системе

```
SUPER_ADMIN (Супер Администратор)
    ↓ назначает
CITY_ADMIN (Админ города)
    ↓ управляет
COURIER (Курьер)
    ↓ обслуживает
CLIENT (Клиент)
```

---

## 📱 Система аутентификации: SMS верификация для ВСЕХ

### Общая схема аутентификации

```
┌─────────────────────────────────────────────────────────────┐
│                    ВХОД В СИСТЕМУ                           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────┐
         │  Ввод номера телефона          │
         │  +992 XX XXX XXXX              │
         └────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────┐
         │  Проверка номера в базе:       │
         │  - 205250010 → SUPER_ADMIN ✓   │
         │  - 948212121 → SUPER_ADMIN ✓   │
         │  - Остальные → ADMIN/COURIER ✓ │
         └────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────┐
         │  Отправка SMS через Payom.tj   │
         │  (для ВСЕХ пользователей)      │
         └────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────┐
         │  Ввод SMS кода                 │
         │  (6 цифр, срок 5 минут)        │
         └────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌──────────────────┐          ┌──────────────────┐
│  SUPER_ADMIN     │          │  ADMIN/COURIER   │
│  (полный доступ) │          │  (доступ к городу)│
└──────────────────┘          └──────────────────┘
```

---

### 🔐 SUPER_ADMIN — SMS верификация (как у всех)

**Зарезервированные номера для SUPER_ADMIN:**
```
+992 20 525 0010 (основной)
+992 94 821 2121 (резервный)
```

**Особенности входа SUPER_ADMIN:**
- ✅ Вход ТОЖЕ ПО SMS верификации (как и обычные админы)
- ✅ Автоматическое определение роли по номеру
- ✅ При первом входе автоматически создаётся документ SUPER_ADMIN
- ✅ Логирование всех входов в систему
- ✅ **Повышенная безопасность** — даже SUPER_ADMIN подтверждает номер

**Почему SUPER_ADMIN тоже входит по SMS?**
1. **Безопасность** — двухфакторная аутентификация
2. **Подтверждение владения номером** — защита от подмены номера
3. **Единообразие** — все пользователи проходят одинаковый процесс
4. **Аудит** — каждый вход подтверждён через SMS

---

### 📱 Firebase Function: Единая проверка для всех

```typescript
// firebase/functions/src/index.ts

/**
 * Проверка номера телефона при входе (для ВСЕХ)
 * SMS отправляется ВСЕМ пользователям, включая SUPER_ADMIN
 */
export const checkPhoneForLogin = functions.https.onCall(async (data, context) => {
  const { phone } = data;
  
  // Нормализация номера телефона
  const normalizedPhone = normalizePhone(phone);
  
  // Список SUPER_ADMIN номеров (хранить в environment variables!)
  const SUPER_ADMIN_PHONES = [
    '+992205250010',  // Основной номер
    '+992948212121'   // Резервный номер
  ];
  
  // Проверка: это SUPER_ADMIN номер?
  const isSuperAdmin = SUPER_ADMIN_PHONES.includes(normalizedPhone);
  
  // Для SUPER_ADMIN - автоматическое создание при первом входе
  if (isSuperAdmin) {
    // Проверить существует ли SUPER_ADMIN с этим номером
    const superAdminExists = await db.collection('users')
      .where('phone', '==', normalizedPhone)
      .where('role', '==', 'SUPER_ADMIN')
      .get();
    
    // Даже если SUPER_ADMIN - ВСЕГДА отправляем SMS!
    const smsCode = generateSmsCode();
    const smsCodeHash = crypto.createHash('sha256').update(smsCode).digest('hex');
    
    await db.collection('sms_codes').add({
      phone: normalizedPhone,
      codeHash: smsCodeHash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      used: false,
      role: 'SUPER_ADMIN'
    });
    
    // Отправить SMS
    await sendSms(normalizedPhone, `Ваш код подтверждения ZaKi: ${smsCode}`);
    
    return {
      requiresSms: true,  // ← ВСЕГДА true, даже для SUPER_ADMIN
      role: 'SUPER_ADMIN',
      message: 'SMS код отправлен для Супер Администратора'
    };
  }
  
  // Обычный пользователь - проверить что номер существует в базе
  const userDoc = await db.collection('users')
    .where('phone', '==', normalizedPhone)
    .get();
  
  if (userDoc.empty) {
    throw new functions.https.HttpsError('not-found', 
      'Пользователь с таким номером не найден');
  }
  
  const userData = userDoc.docs[0].data();
  
  // Проверить что пользователь не заблокирован
  if (userData.isBlocked) {
    throw new functions.https.HttpsError('permission-denied', 
      'Ваш аккаунт заблокирован');
  }
  
  // Сгенерировать и отправить SMS код
  const smsCode = generateSmsCode();
  const smsCodeHash = crypto.createHash('sha256').update(smsCode).digest('hex');
  
  await db.collection('sms_codes').add({
    phone: normalizedPhone,
    codeHash: smsCodeHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    used: false,
    role: userData.role
  });
  
  // Отправить SMS через Payom.tj
  await sendSms(normalizedPhone, `Ваш код подтверждения ZaKi: ${smsCode}`);
  
  return {
    requiresSms: true,
    role: userData.role, // 'ADMIN' или 'COURIER'
    message: 'SMS код отправлен'
  };
});
```

---

### 🔐 Firebase Function: Подтверждение входа (для всех)

```typescript
/**
 * Подтверждение входа (проверка SMS кода для ВСЕХ)
 */
export const confirmLogin = functions.https.onCall(async (data, context) => {
  const { phone, smsCode } = data;
  
  const normalizedPhone = normalizePhone(phone);
  
  // Проверка SMS кода (для ВСЕХ, включая SUPER_ADMIN)
  if (!smsCode) {
    throw new functions.https.HttpsError('invalid-argument', 
      'Требуется SMS код');
  }
  
  // Найти неиспользованный код
  const smsCodeHash = crypto.createHash('sha256').update(smsCode).digest('hex');
  
  const codeQuery = await db.collection('sms_codes')
    .where('phone', '==', normalizedPhone)
    .where('codeHash', '==', smsCodeHash)
    .where('used', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  
  if (codeQuery.empty) {
    throw new functions.https.HttpsError('unauthenticated', 
      'Неверный или просроченный код');
  }
  
  const codeData = codeQuery.docs[0].data();
  const codeId = codeQuery.docs[0].id;
  
  // Проверить срок действия
  if (codeData.expiresAt.toDate() < new Date()) {
    throw new functions.https.HttpsError('unauthenticated', 
      'Код просрочен');
  }
  
  // Пометить код как использованный
  await db.collection('sms_codes').doc(codeId).update({
    used: true,
    usedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Определить роль по номеру или из кода
  const SUPER_ADMIN_PHONES = ['+992205250010', '+992948212121'];
  const isSuperAdmin = SUPER_ADMIN_PHONES.includes(normalizedPhone);
  
  if (isSuperAdmin) {
    // SUPER_ADMIN - найти или создать документ
    return await handleSuperAdminLogin(normalizedPhone, context);
  }
  
  // Обычный пользователь
  return await handleRegularLogin(normalizedPhone, context);
});

/**
 * Обработка входа SUPER_ADMIN (после подтверждения SMS)
 */
async function handleSuperAdminLogin(phone: string, context: any) {
  // Найти существующего SUPER_ADMIN
  const superAdminQuery = await db.collection('users')
    .where('phone', '==', phone)
    .where('role', '==', 'SUPER_ADMIN')
    .get();
  
  if (superAdminQuery.empty) {
    // Первый вход - создать SUPER_ADMIN
    const newSuperAdmin = {
      name: 'Super',
      surname: 'Admin',
      phone: phone,
      role: 'SUPER_ADMIN',
      cityId: null,
      cityName: null,
      isOnline: true,
      isBlocked: false,
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      permissions: {
        canManageAllCities: true,
        canManageAdmins: true,
        canDeleteUsers: true,
        canViewAllStatistics: true,
        canManageTariffs: true,
        canManageCities: true
      }
    };
    
    const docRef = await db.collection('users').add(newSuperAdmin);
    
    // Логировать создание
    await db.collection('audit_log').add({
      action: 'SUPER_ADMIN_CREATED_AFTER_SMS',
      phone: phone,
      userId: docRef.id,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: context.rawRequest?.ip || 'unknown'
    });
    
    console.log(`SUPER_ADMIN created after SMS: ${phone}`);
    
    return {
      success: true,
      userId: docRef.id,
      role: 'SUPER_ADMIN',
      message: 'SUPER_ADMIN создан и авторизован'
    };
  }
  
  // SUPER_ADMIN уже существует
  const adminId = superAdminQuery.docs[0].id;
  const adminData = superAdminQuery.docs[0].data();
  
  // Обновить lastLogin
  await db.collection('users').doc(adminId).update({
    isOnline: true,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Логировать вход
  await db.collection('audit_log').add({
    action: 'SUPER_ADMIN_LOGIN_SMS_VERIFIED',
    phone: phone,
    userId: adminId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip: context.rawRequest?.ip || 'unknown'
  });
  
  console.log(`SUPER_ADMIN logged in with SMS: ${phone}`);
  
  return {
    success: true,
    userId: adminId,
    role: 'SUPER_ADMIN',
    name: adminData.name,
    surname: adminData.surname
  };
}

/**
 * Обработка входа обычного пользователя (ADMIN/COURIER)
 */
async function handleRegularLogin(phone: string, context: any) {
  // Найти пользователя
  const userQuery = await db.collection('users')
    .where('phone', '==', phone)
    .get();
  
  if (userQuery.empty) {
    throw new functions.https.HttpsError('not-found', 
      'Пользователь не найден');
  }
  
  const userData = userQuery.docs[0].data();
  const userId = userQuery.docs[0].id;
  
  // Обновить lastLogin
  await db.collection('users').doc(userId).update({
    isOnline: true,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Логировать вход
  await db.collection('audit_log').add({
    action: 'USER_LOGIN_SMS_VERIFIED',
    phone: phone,
    userId: userId,
    role: userData.role,
    cityId: userData.cityId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip: context.rawRequest?.ip || 'unknown'
  });
  
  return {
    success: true,
    userId: userId,
    role: userData.role,
    cityId: userData.cityId,
    cityName: userData.cityName,
    name: userData.name,
    surname: userData.surname
  };
}

/**
 * Подтверждение входа (для SUPER_ADMIN - без SMS)
 */
export const confirmLogin = functions.https.onCall(async (data, context) => {
  const { phone, smsCode } = data;
  
  const normalizedPhone = normalizePhone(phone);
  
  // Список SUPER_ADMIN номеров
  const SUPER_ADMIN_PHONES = [
    '+992205250010',
    '+992948212121'
  ];
  
  const isSuperAdmin = SUPER_ADMIN_PHONES.includes(normalizedPhone);
  
  if (isSuperAdmin) {
    // SUPER_ADMIN - прямой вход без SMS
    // Найти или создать документ SUPER_ADMIN
    let superAdminDoc = await db.collection('users')
      .where('phone', '==', normalizedPhone)
      .where('role', '==', 'SUPER_ADMIN')
      .get();
    
    if (superAdminDoc.empty) {
      // Создать SUPER_ADMIN если не существует
      const newSuperAdmin = {
        name: 'Super',
        surname: 'Admin',
        phone: normalizedPhone,
        role: 'SUPER_ADMIN',
        cityId: null,
        cityName: null,
        isOnline: true,
        isBlocked: false,
        lastLogin: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        permissions: {
          canManageAllCities: true,
          canManageAdmins: true,
          canDeleteUsers: true,
          canViewAllStatistics: true,
          canManageTariffs: true,
          canManageCities: true
        }
      };
      
      const docRef = await db.collection('users').add(newSuperAdmin);
      
      // Логировать создание SUPER_ADMIN
      await db.collection('audit_log').add({
        action: 'SUPER_ADMIN_AUTO_CREATED',
        phone: normalizedPhone,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: context.rawRequest?.ip
      });
      
      return {
        success: true,
        userId: docRef.id,
        role: 'SUPER_ADMIN',
        message: 'SUPER_ADMIN автоматически создан и авторизован'
      };
    }
    
    // SUPER_ADMIN уже существует
    const adminId = superAdminDoc.docs[0].id;
    
    // Обновить lastLogin
    await db.collection('users').doc(adminId).update({
      isOnline: true,
      lastLogin: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Логировать вход
    await db.collection('audit_log').add({
      action: 'SUPER_ADMIN_LOGIN',
      phone: normalizedPhone,
      userId: adminId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: context.rawRequest?.ip
    });
    
    return {
      success: true,
      userId: adminId,
      role: 'SUPER_ADMIN'
    };
  }
  
  // Обычный пользователь - проверка SMS кода
  if (!smsCode) {
    throw new functions.https.HttpsError('invalid-argument', 
      'Требуется SMS код');
  }
  
  // Найти неиспользованный код
  const smsCodeHash = crypto.createHash('sha256').update(smsCode).digest('hex');
  
  const codeDoc = await db.collection('sms_codes')
    .where('phone', '==', normalizedPhone)
    .where('codeHash', '==', smsCodeHash)
    .where('used', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  
  if (codeDoc.empty) {
    throw new functions.https.HttpsError('unauthenticated', 
      'Неверный или просроченный код');
  }
  
  const codeData = codeDoc.docs[0].data();
  
  // Проверить срок действия
  if (codeData.expiresAt.toDate() < new Date()) {
    throw new functions.https.HttpsError('unauthenticated', 
      'Код просрочен');
  }
  
  // Пометить код как использованный
  await db.collection('sms_codes').doc(codeDoc.docs[0].id).update({
    used: true,
    usedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Найти пользователя
  const userDoc = await db.collection('users')
    .where('phone', '==', normalizedPhone)
    .get();
  
  const userData = userDoc.docs[0].data();
  const userId = userDoc.docs[0].id;
  
  // Обновить lastLogin
  await db.collection('users').doc(userId).update({
    isOnline: true,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Логировать вход
  await db.collection('audit_log').add({
    action: 'USER_LOGIN',
    phone: normalizedPhone,
    userId: userId,
    role: userData.role,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip: context.rawRequest?.ip
  });
  
  return {
    success: true,
    userId: userId,
    role: userData.role,
    cityId: userData.cityId,
    cityName: userData.cityName
  };
});

/**
 * Генерация 6-значного SMS кода
 */
function generateSmsCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Нормализация номера телефона
 */
function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return '';
  
  let digits = String(raw).replace(/[^\d+]/g, '');
  digits = digits.replace(/(?!^)\+/g, '');
  
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  
  if (digits.startsWith('992')) {
    digits = digits.replace(/^992/, '');
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  
  if (!/^\d{9}$/.test(digits)) {
    return '';
  }
  
  return `+992${digits}`;
}
```

---

### 🏙️ ADMIN/COURIER — SMS верификация через Payom.tj

**Процесс входа для админов и курьеров:**

```
1. Пользователь вводит номер телефона
2. Система проверяет номер в базе данных
3. Генерируется 6-значный код
4. SMS отправляется через Payom.tj API
5. Пользователь вводит код
6. Система проверяет код (срок действия 5 минут)
7. Пользователь авторизован
```

**Интеграция с Payom.tj (уже реализована):**

```typescript
// Уже есть в firebase/functions/src/index.ts

const PAYOM_API_HOST = process.env.PAYOM_API_HOST || "https://gateway.payom.tj";
const PAYOM_API_TOKEN = process.env.PAYOM_API_TOKEN || "";
const PAYOM_SENDER_NAME = process.env.PAYOM_SENDER_NAME || "ZaKi";

async function sendSms(telephoneRaw: string, text: string): Promise<void> {
  const telephone = normalizePhone(telephoneRaw);

  if (!telephone) {
    console.warn(`SMS skipped: invalid phone number "${telephoneRaw}"`);
    return;
  }

  if (!PAYOM_API_TOKEN) {
    console.warn("SMS skipped: PAYOM_API_TOKEN is not configured");
    return;
  }

  try {
    const response = await fetch(`${PAYOM_API_HOST}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PAYOM_API_TOKEN}`
      },
      body: JSON.stringify({
        telephone: telephone,
        text: text,
        sender: PAYOM_SENDER_NAME
      })
    });

    if (!response.ok) {
      console.error(`SMS API error: ${response.status}`);
    }
  } catch (err) {
    console.error("SMS send error:", err);
  }
}
```

---

### 📱 Admin Panel: Страница входа

```typescript
// admin-panel/src/pages/Login.tsx
import React, { useState } from 'react';
import {
  Box, Card, CardContent, TextField, Button, Typography,
  Alert, CircularProgress, InputAdornment
} from '@mui/material';
import { Phone as PhoneIcon, Sms as SmsIcon } from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const Login: React.FC = () => {
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [step, setStep] = useState<'phone' | 'sms'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requiresSms, setRequiresSms] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  
  const handlePhoneSubmit = async () => {
    setError('');
    setLoading(true);
    
    try {
      const checkPhoneFn = httpsCallable(functions, 'checkPhoneForLogin');
      const result = await checkPhoneFn({ phone }) as any;
      
      setRequiresSms(result.data.requiresSms);
      setUserRole(result.data.role);
      
      if (result.data.requiresSms) {
        setStep('sms');
      } else {
        // SUPER_ADMIN - автоматический вход
        await handleConfirmLogin('');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка отправки SMS');
    } finally {
      setLoading(false);
    }
  };
  
  const handleConfirmLogin = async (code: string) => {
    setError('');
    setLoading(true);
    
    try {
      const confirmFn = httpsCallable(functions, 'confirmLogin');
      const result = await confirmFn({ 
        phone, 
        smsCode: code 
      }) as any;
      
      // Сохранить userId в localStorage
      localStorage.setItem('userId', result.data.userId);
      localStorage.setItem('userRole', result.data.role);
      
      if (result.data.cityId) {
        localStorage.setItem('userCityId', result.data.cityId);
        localStorage.setItem('userCityName', result.data.cityName);
      }
      
      // Перенаправить на Dashboard
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Box sx={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      bgcolor: '#f5f5f5'
    }}>
      <Card sx={{ maxWidth: 400, width: '100%', mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 3, textAlign: 'center' }}>
            ZaKi Taksometr
          </Typography>
          
          {userRole === 'SUPER_ADMIN' && !requiresSms && (
            <Alert severity="info" sx={{ mb: 2 }}>
              👑 Вход для Супер Администратора
            </Alert>
          )}
          
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          
          {step === 'phone' && (
            <>
              <TextField
                fullWidth
                label="Номер телефона"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+992 91 800 0000"
                margin="normal"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PhoneIcon />
                    </InputAdornment>
                  )
                }}
              />
              
              <Button
                fullWidth
                variant="contained"
                onClick={handlePhoneSubmit}
                disabled={loading || !phone}
                sx={{ mt: 3 }}
              >
                {loading ? <CircularProgress size={24} /> : 'Войти'}
              </Button>
            </>
          )}
          
          {step === 'sms' && (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                SMS код отправлен на номер {phone}
              </Alert>
              
              <TextField
                fullWidth
                label="SMS код"
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value)}
                placeholder="Введите 6-значный код"
                margin="normal"
                type="number"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SmsIcon />
                    </InputAdornment>
                  )
                }}
              />
              
              <Button
                fullWidth
                variant="contained"
                onClick={() => handleConfirmLogin(smsCode)}
                disabled={loading || smsCode.length !== 6}
                sx={{ mt: 3 }}
              >
                {loading ? <CircularProgress size={24} /> : 'Подтвердить'}
              </Button>
              
              <Button
                fullWidth
                onClick={() => {
                  setStep('phone');
                  setSmsCode('');
                }}
                sx={{ mt: 1 }}
              >
                Назад
              </Button>
            </>
          )}
          
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3, textAlign: 'center' }}>
            Для админов и курьеров требуется SMS верификация
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Login;
```

---

### 👑 SUPER_ADMIN — Супер Администратор

**Кто это:** Владелец бизнеса, главный администратор всей системы

**Права:**
- ✅ Видит ВСЕ города (переключатель всех городов)
- ✅ Создаёт/редактирует/удаляет админов городов
- ✅ Назначает админа на конкретный город
- ✅ Создаёт/редактирует/удаляет курьеров любого города
- ✅ Видит все доставки, клиентов, статистику всех городов
- ✅ Настраивает тарифы для любого города
- ✅ Добавляет новые города в систему
- ✅ Может заблокировать/разблокировать любого пользователя
- ✅ Видит финансовую аналитику по всем городам
- ✅ Управляет настройками системы

**Ограничения:**
- ❌ Не может быть удалён другими админами
- ❌ Не может быть понижен в правах без собственного согласия

**Реализация:**
```javascript
// users/{superAdminId}
{
  id: "user_super_001",
  name: "Алишер",
  surname: "Рахмонов",
  phone: "+992918000001",
  role: "SUPER_ADMIN",
  
  // Супер-админ не привязан к конкретному городу
  cityId: null, // или "all"
  
  // Полномочия
  permissions: {
    canManageAllCities: true,
    canManageAdmins: true,
    canDeleteUsers: true,
    canViewAllStatistics: true,
    canManageTariffs: true,
    canManageCities: true
  },
  
  // Метаданные
  isOnline: true,
  isBlocked: false,
  createdAt: 1234567890,
  createdBy: "system"
}
```

**Admin Panel UI для SUPER_ADMIN:**
```typescript
// components/Layout.tsx для SUPER_ADMIN
const Layout: React.FC = () => {
  const { user, currentCity, setCity, cities } = useAuth();
  
  if (user.role === 'SUPER_ADMIN') {
    return (
      <AppBar>
        <Toolbar>
          <Typography>ZaKi Taksometr — Супер Админ</Typography>
          
          {/* SUPER_ADMIN видит ВСЕ города */}
          <Select
            value={currentCity}
            onChange={(e) => setCity(e.target.value)}
          >
            <MenuItem value="all">
              <strong>🌍 Все города</strong>
            </MenuItem>
            <Divider />
            {cities.map(city => (
              <MenuItem key={city.id} value={city.id}>
                {city.nameRu}
              </MenuItem>
            ))}
          </Select>
          
          {/* Специальное меню для SUPER_ADMIN */}
          <Button color="inherit" href="/admins">
            👥 Админы городов
          </Button>
          <Button color="inherit" href="/cities">
            🏙️ Управление городами
          </Button>
        </Toolbar>
      </AppBar>
    );
  }
};
```

---

### 🏙️ CITY_ADMIN — Админ города

**Кто это:** Управляющий конкретным городом (Бохтар, Душанбе и т.д.)

**Права:**
- ✅ Видит только СВОЙ город (фиксированный при создании)
- ✅ Создаёт/редактирует/удаляет курьеров СВОЕГО города
- ✅ Видит доставки, клиентов, статистику ТОЛЬКО своего города
- ✅ Настраивает тарифы для СВОЕГО города
- ✅ Управляет балансом курьеров своего города
- ✅ Видит аналитику по своему городу
- ✅ Блокирует/разблокирует курьеров своего города

**Ограничения:**
- ❌ Не видит данные других городов
- ❌ Не может создавать админов
- ❌ Не может изменять тарифы других городов
- ❌ Не может управлять курьерами других городов
- ❌ Не может быть повышен до SUPER_ADMIN (только SUPER_ADMIN может это сделать)

**Реализация:**
```javascript
// users/{cityAdminId}
{
  id: "user_admin_bokhtar_001",
  name: "Мухаммад",
  surname: "Исомов",
  phone: "+992918000002",
  role: "ADMIN",
  
  // Админ привязан к конкретному городу
  cityId: "bokhtar",
  cityName: "Бохтар",
  
  // Полномочия
  permissions: {
    canManageCouriers: true,
    canViewStatistics: true,
    canManageTariffs: true,
    canManageDeliveries: true,
    canManageClients: true
  },
  
  // Кто назначил
  assignedBy: "user_super_001", // ID супер-админа
  assignedAt: 1234567890,
  
  // Метаданные
  isOnline: true,
  isBlocked: false,
  createdAt: 1234567890
}
```

**Admin Panel UI для CITY_ADMIN:**
```typescript
// components/Layout.tsx для CITY_ADMIN
const Layout: React.FC = () => {
  const { user, currentCity } = useAuth();
  
  if (user.role === 'ADMIN') {
    return (
      <AppBar>
        <Toolbar>
          <Typography>
            ZaKi Taksometr — {user.cityName}
          </Typography>
          
          {/* Админ видит только свой город - НЕПЕРЕКЛЮЧАЕМЫЙ */}
          <Chip 
            label={user.cityName} 
            color="primary" 
            icon={<LocationCityIcon />}
          />
          
          {/* Обычное меню */}
          <Button href="/dashboard">Dashboard</Button>
          <Button href="/couriers">Курьеры</Button>
          <Button href="/deliveries">Доставки</Button>
        </Toolbar>
      </AppBar>
    );
  }
};
```

---

### 📋 Новая страница: Управление админами (только для SUPER_ADMIN)

```typescript
// admin-panel/src/pages/Admins.tsx
import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, Chip, IconButton, Alert
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Block as BlockIcon,
  CheckCircle as ActiveIcon
} from '@mui/icons-material';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface AdminUser {
  id: string;
  name: string;
  surname: string;
  phone: string;
  email?: string;
  login: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  cityId?: string;
  cityName?: string;
  isBlocked: boolean;
  createdAt: number;
  assignedBy?: string;
}

const Admins: React.FC = () => {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  
  // Форма создания/редактирования админа
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    phone: '',
    login: '',
    password: '',
    cityId: ''
  });
  
  useEffect(() => {
    loadAdmins();
    loadCities();
  }, []);
  
  const loadAdmins = async () => {
    const snapshot = await getDocs(
      query(collection(db, 'users'), where('role', 'in', ['ADMIN', 'SUPER_ADMIN']))
    );
    const adminList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as AdminUser));
    setAdmins(adminList);
    setLoading(false);
  };
  
  const loadCities = async () => {
    const snapshot = await getDocs(collection(db, 'cities'));
    const cityList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    setCities(cityList);
  };
  
  const handleCreateAdmin = async () => {
    try {
      const createAdminFn = httpsCallable(functions, 'createCityAdmin');
      await createAdminFn({
        name: formData.name,
        surname: formData.surname,
        phone: formData.phone,
        login: formData.login,
        password: formData.password,
        cityId: formData.cityId
      });
      
      setDialogOpen(false);
      loadAdmins();
      resetForm();
    } catch (error) {
      console.error('Error creating admin:', error);
    }
  };
  
  const handleBlockAdmin = async (adminId: string, block: boolean) => {
    await updateDoc(doc(db, 'users', adminId), {
      isBlocked: block
    });
    loadAdmins();
  };
  
  const handleDeleteAdmin = async (adminId: string) => {
    if (confirm('Вы уверены что хотите удалить этого админа?')) {
      await deleteDoc(doc(db, 'users', adminId));
      loadAdmins();
    }
  };
  
  const resetForm = () => {
    setFormData({
      name: '',
      surname: '',
      phone: '',
      login: '',
      password: '',
      cityId: ''
    });
    setEditingAdmin(null);
  };
  
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          👥 Управление админами городов
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
        >
          Добавить админа
        </Button>
      </Box>
      
      <Alert severity="info" sx={{ mb: 2 }}>
        Только Супер Администратор может управлять админами городов
      </Alert>
      
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Админ</TableCell>
                <TableCell>Логин</TableCell>
                <TableCell>Телефон</TableCell>
                <TableCell>Роль</TableCell>
                <TableCell>Город</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {admins.map(admin => (
                <TableRow key={admin.id}>
                  <TableCell>
                    <Typography fontWeight={600}>
                      {admin.name} {admin.surname}
                    </Typography>
                  </TableCell>
                  <TableCell>{admin.login}</TableCell>
                  <TableCell>{admin.phone}</TableCell>
                  <TableCell>
                    <Chip
                      label={admin.role === 'SUPER_ADMIN' ? '👑 Супер Админ' : '🏙️ Админ города'}
                      color={admin.role === 'SUPER_ADMIN' ? 'warning' : 'primary'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {admin.role === 'SUPER_ADMIN' ? (
                      <Chip label="Все города" color="secondary" size="small" />
                    ) : (
                      <Chip label={admin.cityName || admin.cityId} size="small" />
                    )}
                  </TableCell>
                  <TableCell>
                    {admin.isBlocked ? (
                      <Chip icon={<BlockIcon />} label="Заблокирован" color="error" size="small" />
                    ) : (
                      <Chip icon={<ActiveIcon />} label="Активен" color="success" size="small" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {admin.role !== 'SUPER_ADMIN' && (
                      <>
                        <IconButton
                          onClick={() => handleBlockAdmin(admin.id, !admin.isBlocked)}
                          color={admin.isBlocked ? 'success' : 'warning'}
                        >
                          {admin.isBlocked ? <ActiveIcon /> : <BlockIcon />}
                        </IconButton>
                        <IconButton
                          onClick={() => handleDeleteAdmin(admin.id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </>
                    )}
                    {admin.role === 'SUPER_ADMIN' && (
                      <Typography variant="caption" color="text.secondary">
                        Нельзя редактировать
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      
      {/* Диалог создания админа */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Создать админа города</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Имя"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Фамилия"
            value={formData.surname}
            onChange={(e) => setFormData({ ...formData, surname: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Телефон"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Логин"
            value={formData.login}
            onChange={(e) => setFormData({ ...formData, login: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            type="password"
            label="Пароль"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            margin="normal"
          />
          <Select
            fullWidth
            value={formData.cityId}
            onChange={(e) => setFormData({ ...formData, cityId: e.target.value })}
            displayEmpty
            sx={{ mt: 2 }}
          >
            <MenuItem value="" disabled>
              Выберите город
            </MenuItem>
            {cities.map(city => (
              <MenuItem key={city.id} value={city.id}>
                {city.nameRu}
              </MenuItem>
            ))}
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleCreateAdmin}
            disabled={!formData.name || !formData.login || !formData.password || !formData.cityId}
          >
            Создать
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Admins;
```

---

### 🔐 Firebase Function: Создание админа города

```typescript
// firebase/functions/src/index.ts

/**
 * Создание админа города (только для SUPER_ADMIN)
 */
export const createCityAdmin = functions.https.onCall(async (data, context) => {
  const { name, surname, phone, login, password, cityId } = data;
  const callerId = context.auth?.uid;
  
  if (!callerId) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  // Проверить что вызывающий - SUPER_ADMIN
  const callerDoc = await db.collection('users').doc(callerId).get();
  const callerRole = callerDoc.data()?.role;
  
  if (callerRole !== 'SUPER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 
      'Только Супер Администратор может создавать админов городов');
  }
  
  // Валидация города
  const cityDoc = await db.collection('cities').doc(cityId).get();
  if (!cityDoc.exists || !cityDoc.data()?.isActive) {
    throw new functions.https.HttpsError('invalid-argument', 'Неверный город');
  }
  
  // Проверить уникальность логина
  const existingUser = await db.collection('users')
    .where('login', '==', login)
    .get();
  
  if (!existingUser.empty) {
    throw new functions.https.HttpsError('already-exists', 
      'Пользователь с таким логином уже существует');
  }
  
  // Хешировать пароль
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  
  // Создать админа
  const adminData = {
    name,
    surname: surname || '',
    phone: phone || '',
    login,
    password: hashedPassword,
    role: 'ADMIN',
    
    // Привязка к городу
    cityId,
    cityName: cityDoc.data()?.nameRu || cityId,
    
    // Кто назначил
    assignedBy: callerId,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    
    // Статус
    isOnline: false,
    isBlocked: false,
    balance: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    
    // Полномочия
    permissions: {
      canManageCouriers: true,
      canViewStatistics: true,
      canManageTariffs: true,
      canManageDeliveries: true,
      canManageClients: true
    }
  };
  
  const docRef = await db.collection('users').add(adminData);
  
  console.log(`Admin ${login} created for city ${cityId} by ${callerId}`);
  
  return {
    success: true,
    adminId: docRef.id
  };
});

/**
 * Удаление админа города (только для SUPER_ADMIN)
 */
export const deleteCityAdmin = functions.https.onCall(async (data, context) => {
  const { adminId } = data;
  const callerId = context.auth?.uid;
  
  if (!callerId) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  // Проверить права
  const callerDoc = await db.collection('users').doc(callerId).get();
  if (callerDoc.data()?.role !== 'SUPER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 
      'Только Супер Администратор может удалять админов');
  }
  
  // Проверить что удаляемый - не SUPER_ADMIN
  const adminToDelete = await db.collection('users').doc(adminId).get();
  if (adminToDelete.data()?.role === 'SUPER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 
      'Невозможно удалить Супер Администратора');
  }
  
  // Удалить
  await db.collection('users').doc(adminId).delete();
  
  return { success: true };
});

/**
 * Блокировка/разблокировка админа (только для SUPER_ADMIN)
 */
export const toggleAdminBlock = functions.https.onCall(async (data, context) => {
  const { adminId, block } = data;
  const callerId = context.auth?.uid;
  
  if (!callerId) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  // Проверить права
  const callerDoc = await db.collection('users').doc(callerId).get();
  if (callerDoc.data()?.role !== 'SUPER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 
      'Только Супер Администратор может блокировать админов');
  }
  
  // Заблокировать/разблокировать
  await db.collection('users').doc(adminId).update({
    isBlocked: block
  });
  
  return { success: true };
});
```

---

### 🔒 Обновлённые правила Firestore

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ============ USERS ============
    match /users/{userId} {
      // Курьер видит только себя
      allow read, write: if isCourier() && request.auth.uid == userId;
      
      // Админ города видит курьеров своего города
      allow read: if isAdmin() && resource.data.cityId == getAdminCity();
      allow write: if isAdmin() && resource.data.cityId == getAdminCity() 
                   && resource.data.role == 'COURIER';
      
      // Супер Админ видит ВСЕХ и управляет ВСЕМИ
      allow read, write: if isSuperAdmin();
    }
    
    // ============ DELIVERIES ============
    match /deliveries/{deliveryId} {
      // Курьер видит доставки своего города
      allow read, create: if isCourier() && resource.data.cityId == getUserCity();
      
      // Админ видит доставки своего города
      allow read, write: if isAdmin() && resource.data.cityId == getAdminCity();
      
      // Супер Админ видит ВСЕ доставки
      allow read, write: if isSuperAdmin();
    }
    
    // ============ TARIFFS ============
    match /tariffs/{cityId} {
      // Читают все авторизованные
      allow read: if isAuthenticated();
      
      // Админ редактирует тариф СВОЕГО города
      allow write: if isAdmin() && cityId == getAdminCity();
      
      // Супер Админ редактирует ВСЕ тарифы
      allow write: if isSuperAdmin();
    }
    
    // ============ CITIES ============
    match /cities/{cityId} {
      // Читают все
      allow read: if true;
      
      // Создаёт/редактирует только Супер Админ
      allow write: if isSuperAdmin();
    }
    
    // ============ FUNCTIONS ============
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isCourier() {
      return isAuthenticated() && 
             exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'COURIER';
    }
    
    function isAdmin() {
      return isAuthenticated() && 
             exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'ADMIN';
    }
    
    function isSuperAdmin() {
      return isAuthenticated() && 
             exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'SUPER_ADMIN';
    }
    
    function getUserCity() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.cityId;
    }
    
    function getAdminCity() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.cityId;
    }
  }
}
```

---



### Вариант A: Быстрый запуск (1-2 дня) ⚡
**Подходит если:**
- Хотите запустить Душанбе быстро
- Данные городов могут пересекаться временно
- Админы будут работать с фильтрами вручную

**Что делать:**
1. Добавить фильтры города в админку (dropdown в Dashboard, Deliveries, Clients)
2. Добавить поле `city` в доставки (createdAt + city composite index)
3. Админы manually фильтруют по городу

**Риски:**
- Админы видят данные других городов
- Можно случайно назначить курьера не того города
- Аналитика смешанная

---

### Вариант B: Полная изоляция городов (5-7 дней) 🏗️
**Подходит если:**
- Нужна полная независимость городов
- Разные команды админов
- Разные тарифы и бизнес-логика

**Что делать:**
1. Создать концепцию "Города" как first-class entity
2. Добавить `cityId` во все сущности (deliveries, users, tariffs, clients)
3. Разделить админку по городам (city switcher в header)
4. Создать географические зоны (polygons для каждого города)
5. Изолировать Firebase Functions по городу

**Преимущества:**
- Полная изоляция данных
- Независимая работа городов
- Разные тарифы и настройки
- Масштабируемость (легко добавить город)

---

## 📝 Рекомендуемый план (Вариант B — Полная изоляция)

---

## ЭТАП 0: Создание первого SUPER_ADMIN

### 0.1 Скрипт инициализации Супер Администратора

**Важно:** Этот скрипт выполняется один раз при настройке системы.

```typescript
// firebase/functions/src/initSuperAdmin.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const db = admin.firestore();

/**
 * Инициализация Супер Администратора
 * Запускается вручную один раз при развёртывании
 */
export const initSuperAdmin = functions.https.onRequest(async (req, res) => {
  // Проверка секретного ключа (защита от несанкционированного вызова)
  const secretKey = req.query.key || req.body.key;
  
  if (secretKey !== process.env.SUPER_ADMIN_INIT_KEY) {
    res.status(403).send('Invalid secret key');
    return;
  }
  
  try {
    // Проверить, существует ли уже SUPER_ADMIN
    const existingSuperAdmin = await db.collection('users')
      .where('role', '==', 'SUPER_ADMIN')
      .get();
    
    if (!existingSuperAdmin.empty) {
      res.status(400).json({
        success: false,
        message: 'Супер Администратор уже существует',
        count: existingSuperAdmin.size
      });
      return;
    }
    
    // Данные супер-админа (из environment variables или переданные в запросе)
    const superAdminData = {
      name: process.env.SUPER_ADMIN_NAME || req.body.name || 'Super',
      surname: process.env.SUPER_ADMIN_SURNAME || req.body.surname || 'Admin',
      phone: process.env.SUPER_ADMIN_PHONE || req.body.phone || '+992918000000',
      login: process.env.SUPER_ADMIN_LOGIN || req.body.login || 'superadmin',
      password: crypto.createHash('sha256')
        .update(process.env.SUPER_ADMIN_PASSWORD || req.body.password || 'SuperAdmin123!')
        .digest('hex'),
      
      role: 'SUPER_ADMIN',
      cityId: null, // Не привязан к городу
      cityName: null,
      
      // Полные права
      permissions: {
        canManageAllCities: true,
        canManageAdmins: true,
        canDeleteUsers: true,
        canViewAllStatistics: true,
        canManageTariffs: true,
        canManageCities: true,
        canManageCouriers: true,
        canManageDeliveries: true
      },
      
      // Статус
      isOnline: false,
      isBlocked: false,
      balance: 0,
      
      // Метаданные
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'system_initialization'
    };
    
    const docRef = await db.collection('users').add(superAdminData);
    
    res.status(200).json({
      success: true,
      message: 'Супер Администратор успешно создан',
      adminId: docRef.id,
      login: superAdminData.login,
      // НЕ возвращаем пароль!
    });
    
  } catch (error) {
    console.error('Error creating super admin:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### 0.2 Запуск инициализации SUPER_ADMIN

```bash
# В терминале, после деплоя Firebase Functions

# Вариант 1: Через curl с секретным ключом
curl "https://us-central1-auva-70253.cloudfunctions.net/initSuperAdmin?key=ВАШ_СЕКРЕТНЫЙ_КЛЮЧ" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Алишер",
    "surname": "Рахмонов",
    "phone": "+992918000001",
    "login": "alisher_super",
    "password": "SecurePassword123!"
  }'

# Вариант 2: Автоматически через environment variables
# В firebase/functions/.env
SUPER_ADMIN_INIT_KEY=your_secret_key_here
SUPER_ADMIN_NAME=Алишер
SUPER_ADMIN_SURNAME=Рахмонов
SUPER_ADMIN_PHONE=+992918000001
SUPER_ADMIN_LOGIN=alisher_super
SUPER_ADMIN_PASSWORD=SecurePassword123!
```

---

## ЭТАП 1: Модель данных (Backend)

### 1.1 Создать коллекцию `cities` в Firestore

```javascript
// cities/{cityId}
{
  id: "dushanbe",
  name: "Душанбе",
  nameRu: "Душанбе",
  nameEn: "Dushanbe",
  
  // Географический центр города
  center: {
    latitude: 38.5598,
    longitude: 68.7740
  },
  
  // Границы города (polygon) - опционально для проверки
  boundaries: [
    { lat: 38.5, lng: 68.7 },
    { lat: 38.6, lng: 68.7 },
    { lat: 38.6, lng: 68.9 },
    { lat: 38.5, lng: 68.9 }
  ],
  
  // Радиус обслуживания (если не используем polygon)
  serviceRadiusMeters: 15000, // 15 км
  
  // Статус
  isActive: true,
  
  // Метаданные
  createdAt: 1234567890,
  createdBy: "admin_id"
}
```

**Примеры документов:**
```javascript
// cities/bokhtar
{
  id: "bokhtar",
  name: "Бохтар",
  nameRu: "Бохтар (Курган-Тюбе)",
  center: { latitude: 37.8407, longitude: 68.7800 },
  serviceRadiusMeters: 10000,
  isActive: true
}

// cities/dushanbe
{
  id: "dushanbe",
  name: "Душанбе",
  center: { latitude: 38.5598, longitude: 68.7740 },
  serviceRadiusMeters: 15000,
  isActive: true
}
```

---

### 1.2 Добавить `cityId` во все основные коллекции

#### А. Коллекция `users` (Курьеры)

```kotlin
// Обновить модель User в Android
data class User(
    val id: String = "",
    val name: String = "",
    val surname: String = "",
    val phone: String = "",
    val role: UserRole = UserRole.COURIER,
    
    // ДОБАВИТЬ:
    val cityId: String = "", // "dushanbe" или "bokhtar"
    val cityName: String = "", // Для отображения
    
    // Существующие поля
    val isOnline: Boolean = false,
    val isBlocked: Boolean = false,
    val balance: Double = 0.0,
    // ...
)
```

**Миграция:**
```javascript
// Скрипт миграции в Firebase Functions
// Назначить cityId="bokhtar" всем существующим курьерам
db.collection('users')
  .where('role', '==', 'COURIER')
  .get()
  .then(snapshot => {
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, { 
        cityId: 'bokhtar',
        cityName: 'Бохтар'
      });
    });
    return batch.commit();
  });
```

---

#### Б. Коллекция `deliveries` (Доставки)

```kotlin
// Обновить модель Delivery
data class Delivery(
    val id: String = "",
    val courierId: String = "",
    
    // ДОБАВИТЬ:
    val cityId: String = "", // Город доставки
    val cityName: String = "",
    
    // Существующие поля
    val clientPhone: String = "",
    val status: DeliveryStatus = DeliveryStatus.IN_PROGRESS,
    val cost: Double = 0.0,
    // ...
)
```

**Firebase Function триггер:**
```typescript
// Автоматически назначать cityId при создании доставки
export const onDeliveryCreate = functions.firestore
  .document('deliveries/{deliveryId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    
    // Получить город курьера
    const courierDoc = await db.collection('users').doc(data.courierId).get();
    const courierCity = courierDoc.data()?.cityId;
    
    // Назначить город доставки
    await snap.ref.update({
      cityId: courierCity || 'unknown',
      cityName: courierDoc.data()?.cityName || ''
    });
  });
```

---

#### В. Коллекция `tariffs` (Тарифы)

```javascript
// БЫЛО: tariffs/default (один тариф на всех)
// СТАЛО: tariffs/{cityId}

// tariffs/dushanbe
{
  cityId: "dushanbe",
  cityName: "Душанбе",
  baseCost: 7000, // Дороже в столице
  baseDistanceKm: 3,
  costPerKm: 2000,
  freeWaitingMinutes: 5,
  costPerWaitingMinute: 600,
  // ...
}

// tariffs/bokhtar
{
  cityId: "bokhtar",
  cityName: "Бохтар",
  baseCost: 5000, // Дешевле в провинции
  baseDistanceKm: 3,
  costPerKm: 1500,
  freeWaitingMinutes: 5,
  costPerWaitingMinute: 500,
  // ...
}
```

---

#### Г. Коллекция `clients` (Клиенты)

```javascript
// users/{userId} - клиенты
{
  phone: "+992918001234",
  name: "Алишер",
  
  // ДОБАВИТЬ:
  cityId: "dushanbe", // Город регистрации (первый заказ)
  
  // История заказов уже содержит cityId
}
```

---

### 1.3 Обновить Firebase Functions

#### А. Функция `checkPhoneForLogin` (проверка номера при входе)

```typescript
// firebase/functions/src/index.ts

/**
 * Проверка номера телефона при входе
 * SUPER_ADMIN номера (+992205250010, +992948212121) пропускаются без SMS
 */
export const checkPhoneForLogin = functions.https.onCall(async (data, context) => {
  const { phone } = data;
  
  // Нормализация номера телефона
  const normalizedPhone = normalizePhone(phone);
  
  // Список SUPER_ADMIN номеров (хранить в environment variables!)
  const SUPER_ADMIN_PHONES = [
    '+992205250010',  // Основной номер
    '+992948212121'   // Резервный номер
  ];
  
  // Проверка: это SUPER_ADMIN?
  const isSuperAdmin = SUPER_ADMIN_PHONES.includes(normalizedPhone);
  
  if (isSuperAdmin) {
    // SUPER_ADMIN - вход без SMS
    console.log(`SUPER_ADMIN login attempt: ${normalizedPhone}`);
    return {
      requiresSms: false,
      role: 'SUPER_ADMIN',
      message: 'Вход для Супер Администратора'
    };
  }
  
  // Обычный пользователь - нужен SMS код
  // Проверить что номер существует в базе
  const userDoc = await db.collection('users')
    .where('phone', '==', normalizedPhone)
    .get();
  
  if (userDoc.empty) {
    throw new functions.https.HttpsError('not-found', 
      'Пользователь с таким номером не найден');
  }
  
  const userData = userDoc.docs[0].data();
  
  // Проверить что пользователь не заблокирован
  if (userData.isBlocked) {
    throw new functions.https.HttpsError('permission-denied', 
      'Ваш аккаунт заблокирован');
  }
  
  // Сгенерировать и отправить SMS код
  const smsCode = generateSmsCode(); // 6-значный код
  const smsCodeHash = crypto.createHash('sha256').update(smsCode).digest('hex');
  
  // Сохранить код в базе (с TTL 5 минут)
  await db.collection('sms_codes').add({
    phone: normalizedPhone,
    codeHash: smsCodeHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 минут
    used: false
  });
  
  // Отправить SMS через Payom.tj
  await sendSms(normalizedPhone, `Ваш код подтверждения ZaKi: ${smsCode}`);
  
  console.log(`SMS sent to ${normalizedPhone}, role: ${userData.role}`);
  
  return {
    requiresSms: true,
    role: userData.role, // 'ADMIN' или 'COURIER'
    message: 'SMS код отправлен'
  };
});

/**
 * Подтверждение входа (для SUPER_ADMIN - без SMS)
 */
export const confirmLogin = functions.https.onCall(async (data, context) => {
  const { phone, smsCode } = data;
  
  const normalizedPhone = normalizePhone(phone);
  
  // Список SUPER_ADMIN номеров
  const SUPER_ADMIN_PHONES = [
    '+992205250010',
    '+992948212121'
  ];
  
  const isSuperAdmin = SUPER_ADMIN_PHONES.includes(normalizedPhone);
  
  if (isSuperAdmin) {
    // SUPER_ADMIN - прямой вход без SMS
    return await handleSuperAdminLogin(normalizedPhone, context);
  }
  
  // Обычный пользователь - проверка SMS кода
  return await handleRegularLogin(normalizedPhone, smsCode, context);
});

/**
 * Обработка входа SUPER_ADMIN
 */
async function handleSuperAdminLogin(phone: string, context: any) {
  // Найти или создать документ SUPER_ADMIN
  const superAdminQuery = await db.collection('users')
    .where('phone', '==', phone)
    .where('role', '==', 'SUPER_ADMIN')
    .get();
  
  if (superAdminQuery.empty) {
    // Создать SUPER_ADMIN если не существует
    const newSuperAdmin = {
      name: 'Super',
      surname: 'Admin',
      phone: phone,
      role: 'SUPER_ADMIN',
      cityId: null,
      cityName: null,
      isOnline: true,
      isBlocked: false,
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      permissions: {
        canManageAllCities: true,
        canManageAdmins: true,
        canDeleteUsers: true,
        canViewAllStatistics: true,
        canManageTariffs: true,
        canManageCities: true
      }
    };
    
    const docRef = await db.collection('users').add(newSuperAdmin);
    
    // Логировать создание SUPER_ADMIN
    await db.collection('audit_log').add({
      action: 'SUPER_ADMIN_AUTO_CREATED',
      phone: phone,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: context.rawRequest?.ip || 'unknown'
    });
    
    console.log(`SUPER_ADMIN auto-created: ${phone}`);
    
    return {
      success: true,
      userId: docRef.id,
      role: 'SUPER_ADMIN',
      message: 'SUPER_ADMIN автоматически создан и авторизован'
    };
  }
  
  // SUPER_ADMIN уже существует
  const adminId = superAdminQuery.docs[0].id;
  const adminData = superAdminQuery.docs[0].data();
  
  // Проверить что не заблокирован
  if (adminData.isBlocked) {
    throw new functions.https.HttpsError('permission-denied', 
      'SUPER_ADMIN аккаунт заблокирован');
  }
  
  // Обновить lastLogin
  await db.collection('users').doc(adminId).update({
    isOnline: true,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Логировать вход
  await db.collection('audit_log').add({
    action: 'SUPER_ADMIN_LOGIN',
    phone: phone,
    userId: adminId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip: context.rawRequest?.ip || 'unknown'
  });
  
  console.log(`SUPER_ADMIN logged in: ${phone}`);
  
  return {
    success: true,
    userId: adminId,
    role: 'SUPER_ADMIN',
    name: adminData.name,
    surname: adminData.surname
  };
}

/**
 * Обработка входа обычного пользователя
 */
async function handleRegularLogin(phone: string, smsCode: string, context: any) {
  if (!smsCode) {
    throw new functions.https.HttpsError('invalid-argument', 
      'Требуется SMS код');
  }
  
  // Найти неиспользованный код
  const smsCodeHash = crypto.createHash('sha256').update(smsCode).digest('hex');
  
  const codeQuery = await db.collection('sms_codes')
    .where('phone', '==', phone)
    .where('codeHash', '==', smsCodeHash)
    .where('used', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  
  if (codeQuery.empty) {
    throw new functions.https.HttpsError('unauthenticated', 
      'Неверный или просроченный код');
  }
  
  const codeData = codeQuery.docs[0].data();
  const codeId = codeQuery.docs[0].id;
  
  // Проверить срок действия
  if (codeData.expiresAt.toDate() < new Date()) {
    throw new functions.https.HttpsError('unauthenticated', 
      'Код просрочен');
  }
  
  // Пометить код как использованный
  await db.collection('sms_codes').doc(codeId).update({
    used: true,
    usedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Найти пользователя
  const userQuery = await db.collection('users')
    .where('phone', '==', phone)
    .get();
  
  if (userQuery.empty) {
    throw new functions.https.HttpsError('not-found', 
      'Пользователь не найден');
  }
  
  const userData = userQuery.docs[0].data();
  const userId = userQuery.docs[0].id;
  
  // Обновить lastLogin
  await db.collection('users').doc(userId).update({
    isOnline: true,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Логировать вход
  await db.collection('audit_log').add({
    action: 'USER_LOGIN',
    phone: phone,
    userId: userId,
    role: userData.role,
    cityId: userData.cityId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ip: context.rawRequest?.ip || 'unknown'
  });
  
  console.log(`User logged in: ${phone}, role: ${userData.role}`);
  
  return {
    success: true,
    userId: userId,
    role: userData.role,
    cityId: userData.cityId,
    cityName: userData.cityName,
    name: userData.name,
    surname: userData.surname
  };
}

/**
 * Генерация 6-значного SMS кода
 */
function generateSmsCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

#### Б. Функция `createCourier` (с проверкой прав)

```typescript
export const createCourier = functions.https.onCall(async (data, context) => {
  const { login, password, name, surname, birthYear, city, phone, adminId, 
          scooterPhotoUrl, passportFrontUrl, passportBackUrl } = data;
  
  // Проверка авторизации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  const callerId = context.auth.uid;
  
  // Получить данные вызывающего пользователя
  const callerDoc = await db.collection('users').doc(callerId).get();
  const callerRole = callerDoc.data()?.role;
  const callerCity = callerDoc.data()?.cityId;
  
  // Проверка прав:
  // - SUPER_ADMIN может создать курьера в ЛЮБОМ городе
  // - ADMIN может создать курьера ТОЛЬКО в своём городе
  if (callerRole === 'ADMIN') {
    // Обычный админ - проверяем что создаёт курьера в своём городе
    if (city !== callerCity) {
      throw new functions.https.HttpsError('permission-denied', 
        'Админ может создавать курьеров только в своём городе');
    }
  } else if (callerRole !== 'SUPER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 
      'Только администраторы могут создавать курьеров');
  }
  
  // Валидация города
  const cityDoc = await db.collection('cities').doc(city).get();
  if (!cityDoc.exists || !cityDoc.data()?.isActive) {
    throw new functions.https.HttpsError('invalid-argument', 'Неверный город');
  }
  
  // Проверить уникальность логина
  const existingUser = await db.collection('users')
    .where('login', '==', login)
    .get();
  
  if (!existingUser.empty) {
    throw new functions.https.HttpsError('already-exists', 
      'Пользователь с таким логином уже существует');
  }
  
  // Хешировать пароль
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  
  // Создать курьера
  const courierData = {
    login,
    password: hashedPassword,
    name,
    surname: surname || '',
    birthYear: birthYear || '',
    phone,
    role: 'COURIER',
    
    // Город курьера
    cityId: city,
    cityName: cityDoc.data()?.nameRu || city,
    
    // Кто создал
    createdBy: callerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    
    // Фото документов
    scooterPhotoUrl: scooterPhotoUrl || '',
    passportFrontUrl: passportFrontUrl || '',
    passportBackUrl: passportBackUrl || '',
    
    // Статус
    isOnline: false,
    isBlocked: false,
    balance: 0
  };
  
  const docRef = await db.collection('users').add(courierData);
  
  console.log(`Courier ${login} created in city ${city} by ${callerId} (${callerRole})`);
  
  return {
    success: true,
    courierId: docRef.id
  };
});
```

#### Б. Функция `getStatistics` (с фильтрацией по городу)

```typescript
export const getStatistics = functions.https.onCall(async (data, context) => {
  const { adminId, cityId, startDate, endDate } = data;
  
  // Проверка авторизации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  const callerId = context.auth.uid;
  
  // Получить данные вызывающего
  const callerDoc = await db.collection('users').doc(callerId).get();
  const callerRole = callerDoc.data()?.role;
  const callerCity = callerDoc.data()?.cityId;
  
  // Определить город для выборки
  let queryCity: string;
  
  if (callerRole === 'SUPER_ADMIN') {
    // Супер админ может выбрать любой город или все города
    queryCity = cityId || 'all'; // 'all' означает все города
  } else if (callerRole === 'ADMIN') {
    // Обычный админ видит только свой город
    queryCity = callerCity;
  } else {
    throw new functions.https.HttpsError('permission-denied', 
      'Нет прав для просмотра статистики');
  }
  
  // Формирование запроса
  let deliveriesQuery: any;
  
  if (queryCity === 'all') {
    // SUPER_ADMIN: все города
    deliveriesQuery = query(
      collection(db, 'deliveries'),
      where('status', '==', 'COMPLETED'),
      where('createdAt', '>=', startDate),
      where('createdAt', '<=', endDate)
    );
  } else {
    // ADMIN или SUPER_ADMIN выбрал конкретный город
    deliveriesQuery = query(
      collection(db, 'deliveries'),
      where('cityId', '==', queryCity),
      where('status', '==', 'COMPLETED'),
      where('createdAt', '>=', startDate),
      where('createdAt', '<=', endDate)
    );
  }
  
  const deliveriesSnapshot = await getDocs(deliveriesQuery);
  
  // Подсчёт статистики
  let totalDeliveries = 0;
  let totalRevenue = 0;
  let totalCommission = 0;
  
  deliveriesSnapshot.docs.forEach(doc => {
    const delivery = doc.data();
    totalDeliveries++;
    totalRevenue += delivery.cost || 0;
    totalCommission += delivery.commission || 0;
  });
  
  // Подсчёт курьеров
  let couriersQuery: any;
  
  if (queryCity === 'all') {
    couriersQuery = query(
      collection(db, 'users'),
      where('role', '==', 'COURIER')
    );
  } else {
    couriersQuery = query(
      collection(db, 'users'),
      where('role', '==', 'COURIER'),
      where('cityId', '==', queryCity)
    );
  }
  
  const couriersSnapshot = await getDocs(couriersQuery);
  const totalCouriers = couriersSnapshot.size;
  
  // Подсчёт активных курьеров (online и не заблокированы)
  let activeCouriers = 0;
  couriersSnapshot.docs.forEach(doc => {
    const courier = doc.data();
    if (courier.isOnline && !courier.isBlocked) {
      activeCouriers++;
    }
  });
  
  return {
    totalCouriers,
    activeCouriers,
    totalDeliveries,
    totalRevenue,
    totalCommission,
    cityId: queryCity
  };
});
```

#### В. Функция `updateTariff` (с проверкой прав)

```typescript
export const updateTariff = functions.https.onCall(async (data, context) => {
  const { adminId, cityId, baseCost, baseDistanceKm, costPerKm, 
          freeWaitingMinutes, costPerWaitingMinute, heavyCargoMeter, fixedTypes } = data;
  
  // Проверка авторизации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  const callerId = context.auth.uid;
  
  // Получить данные вызывающего
  const callerDoc = await db.collection('users').doc(callerId).get();
  const callerRole = callerDoc.data()?.role;
  const callerCity = callerDoc.data()?.cityId;
  
  // Проверка прав
  if (callerRole === 'SUPER_ADMIN') {
    // Может редактировать тариф любого города
  } else if (callerRole === 'ADMIN') {
    // Может редактировать только тариф своего города
    if (cityId !== callerCity) {
      throw new functions.https.HttpsError('permission-denied', 
        'Админ может редактировать тарифы только своего города');
    }
  } else {
    throw new functions.https.HttpsError('permission-denied', 
      'Нет прав для редактирования тарифов');
  }
  
  // Обновить тариф
  await db.collection('tariffs').doc(cityId).set({
    cityId,
    baseCost: Number(baseCost),
    baseDistanceKm: Number(baseDistanceKm),
    costPerKm: Number(costPerKm),
    freeWaitingMinutes: Number(freeWaitingMinutes),
    costPerWaitingMinute: Number(costPerWaitingMinute),
    heavyCargoMeter: {
      baseCost: Number(heavyCargoMeter?.baseCost || 0),
      baseDistanceKm: Number(heavyCargoMeter?.baseDistanceKm || 0),
      costPerKm: Number(heavyCargoMeter?.costPerKm || 0)
    },
    fixedTypes: {
      coal: Number(fixedTypes?.coal || 0),
      gas15: Number(fixedTypes?.gas15 || 0),
      gas30: Number(fixedTypes?.gas30 || 0),
      gas30plus: Number(fixedTypes?.gas30plus || 0),
      errands: Number(fixedTypes?.errands || 0),
      heavyCargo: Number(fixedTypes?.heavyCargo || 0)
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: callerId
  }, { merge: true });
  
  console.log(`Tariff for city ${cityId} updated by ${callerId} (${callerRole})`);
  
  return { success: true };
});
```

#### Г. Функция `deleteCourier` (с проверкой прав)

```typescript
export const deleteCourier = functions.https.onCall(async (data, context) => {
  const { courierId } = data;
  
  // Проверка авторизации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  const callerId = context.auth.uid;
  
  // Получить данные вызывающего
  const callerDoc = await db.collection('users').doc(callerId).get();
  const callerRole = callerDoc.data()?.role;
  const callerCity = callerDoc.data()?.cityId;
  
  // Получить данные курьера для удаления
  const courierDoc = await db.collection('users').doc(courierId).get();
  
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Курьер не найден');
  }
  
  const courierData = courierDoc.data();
  
  // Проверка прав
  if (callerRole === 'SUPER_ADMIN') {
    // Может удалить курьера любого города
  } else if (callerRole === 'ADMIN') {
    // Может удалить только курьера своего города
    if (courierData.cityId !== callerCity) {
      throw new functions.https.HttpsError('permission-denied', 
        'Админ может удалять курьеров только своего города');
    }
  } else {
    throw new functions.https.HttpsError('permission-denied', 
      'Нет прав для удаления курьеров');
  }
  
  // Удалить курьера
  await db.collection('users').doc(courierId).delete();
  
  console.log(`Courier ${courierId} deleted by ${callerId} (${callerRole})`);
  
  return { success: true };
});
```

#### Д. Функция `blockCourier` (с проверкой прав)

```typescript
export const blockCourier = functions.https.onCall(async (data, context) => {
  const { courierId, block } = data; // block: true = заблокировать, false = разблокировать
  
  // Проверка авторизации
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  const callerId = context.auth.uid;
  
  // Получить данные вызывающего
  const callerDoc = await db.collection('users').doc(callerId).get();
  const callerRole = callerDoc.data()?.role;
  const callerCity = callerDoc.data()?.cityId;
  
  // Получить данные курьера
  const courierDoc = await db.collection('users').doc(courierId).get();
  
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Курьер не найден');
  }
  
  const courierData = courierDoc.data();
  
  // Проверка прав (аналогично deleteCourier)
  if (callerRole === 'SUPER_ADMIN') {
    // Может блокировать курьера любого города
  } else if (callerRole === 'ADMIN') {
    // Может блокировать только курьера своего города
    if (courierData.cityId !== callerCity) {
      throw new functions.https.HttpsError('permission-denied', 
        'Админ может блокировать курьеров только своего города');
    }
  } else {
    throw new functions.https.HttpsError('permission-denied', 
      'Нет прав для блокировки курьеров');
  }
  
  // Заблокировать/разблокировать
  await db.collection('users').doc(courierId).update({
    isBlocked: block,
    blockedAt: block ? admin.firestore.FieldValue.serverTimestamp() : null,
    blockedBy: block ? callerId : null
  });
  
  console.log(`Courier ${courierId} ${block ? 'blocked' : 'unblocked'} by ${callerId} (${callerRole})`);
  
  return { success: true };
});
```

---

## ЭТАП 2: Android приложение

### 2.1 Обновить модель User

```kotlin
// domain/model/User.kt
data class User(
    val id: String = "",
    val name: String = "",
    val surname: String = "",
    val phone: String = "",
    val role: UserRole = UserRole.COURIER,
    
    // Добавить
    val cityId: String = "",
    val cityName: String = "",
    
    // ...
)
```

### 2.2 Обновить репозиторий доставок

```kotlin
// data/repository/DeliveryRepositoryImpl.kt
class DeliveryRepositoryImpl {
    fun getActiveDeliveries(cityId: String): Flow<List<Delivery>> {
        return firestore.collection("deliveries")
            .whereEqualTo("cityId", cityId)
            .whereEqualTo("status", "IN_PROGRESS")
            .snapshots()
            .map { it.toObjects(Delivery::class.java) }
    }
    
    suspend fun createDelivery(delivery: Delivery): String {
        // Автоматически назначить город курьера
        val courier = getCurrentCourier()
        val deliveryWithCity = delivery.copy(
            cityId = courier.cityId,
            cityName = courier.cityName
        )
        return firestore.collection("deliveries").add(deliveryWithCity).await().id
    }
}
```

### 2.3 Обновить загрузку тарифов

```kotlin
// data/repository/TariffRepository.kt
class TariffRepository {
    suspend fun getTariffForCity(cityId: String): Tariff {
        return firestore.collection("tariffs")
            .document(cityId)
            .get()
            .await()
            .toObject(Tariff::class.java) ?: Tariff()
    }
}
```

### 2.4 Добавить проверку геолокации курьера

```kotlin
// presentation/courier/LocationChecker.kt
class LocationChecker(
    private val userRepository: UserRepository,
    private val geocoder: Geocoder
) {
    /**
     * Проверить что курьер находится в зоне обслуживания своего города
     */
    fun isCourierInServiceZone(
        courierLocation: Location,
        courierCityId: String
    ): Boolean {
        // Вариант 1: Проверка по радиусу от центра
        val cityCenter = getCityCenter(courierCityId)
        val distance = calculateDistance(courierLocation, cityCenter)
        val serviceRadius = getServiceRadius(courierCityId)
        
        return distance <= serviceRadius
    }
    
    /**
     * Определить город по координатам (для новых курьеров)
     */
    suspend fun determineCityByLocation(location: Location): String? {
        val cities = getCities()
        
        for (city in cities) {
            val distance = calculateDistance(location, city.center)
            if (distance <= city.serviceRadiusMeters) {
                return city.id
            }
        }
        
        return null
    }
}
```

---

## ЭТАП 3: Admin Panel

### 3.1 Добавить City Selector в Layout

```typescript
// admin-panel/src/components/Layout.tsx
import { useCity } from '../contexts/CityContext';

const Layout: React.FC = ({ children }) => {
  const { currentCity, setCity, cities } = useCity();
  
  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6">ZaKi Taksometr</Typography>
        
        {/* City Selector */}
        <Select
          value={currentCity}
          onChange={(e) => setCity(e.target.value)}
          sx={{ ml: 2, minWidth: 150, bgcolor: 'white' }}
        >
          {cities.map(city => (
            <MenuItem key={city.id} value={city.id}>
              {city.nameRu}
            </MenuItem>
          ))}
        </Select>
        
        {/* ... остальное меню */}
      </Toolbar>
    </AppBar>
  );
};
```

### 3.2 Создать CityContext

```typescript
// admin-panel/src/contexts/CityContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface City {
  id: string;
  nameRu: string;
  nameEn: string;
  isActive: boolean;
}

interface CityContextType {
  currentCity: string;
  setCity: (cityId: string) => void;
  cities: City[];
  loading: boolean;
}

const CityContext = createContext<CityContextType | null>(null);

export const CityProvider: React.FC = ({ children }) => {
  const [currentCity, setCurrentCity] = useState<string>(() => {
    // Сохранить выбор города в localStorage
    return localStorage.getItem('selectedCity') || 'bokhtar';
  });
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadCities();
  }, []);
  
  const loadCities = async () => {
    const snapshot = await getDocs(collection(db, 'cities'));
    const cityList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as City));
    
    setCities(cityList.filter(c => c.isActive));
    setLoading(false);
  };
  
  const setCity = (cityId: string) => {
    setCurrentCity(cityId);
    localStorage.setItem('selectedCity', cityId);
  };
  
  return (
    <CityContext.Provider value={{ currentCity, setCity, cities, loading }}>
      {children}
    </CityContext.Provider>
  );
};

export const useCity = () => {
  const context = useContext(CityContext);
  if (!context) throw new Error('useCity must be used within CityProvider');
  return context;
};
```

### 3.3 Обновить Dashboard

```typescript
// admin-panel/src/pages/Dashboard.tsx
import { useCity } from '../contexts/CityContext';

const Dashboard: React.FC = ({ adminId }) => {
  const { currentCity } = useCity();
  
  useEffect(() => {
    loadStats();
  }, [currentCity]); // Перезагружать при смене города
  
  const loadStats = async () => {
    const result = await getStatistics({
      adminId,
      cityId: currentCity, // Фильтр по городу
      startDate: today.getTime(),
      endDate: Date.now(),
    });
    
    // ...
  };
  
  const loadLeaderboard = async (period: string) => {
    // Загружать доставок только текущего города
    const deliveriesQuery = query(
      collection(db, 'deliveries'),
      where('status', '==', 'COMPLETED'),
      where('cityId', '==', currentCity) // ФИЛЬТР ПО ГОРОДУ
    );
    
    // ...
  };
  
  // Курьеры на смене - только текущего города
  useEffect(() => {
    const couriersQ = query(
      collection(db, 'users'),
      where('role', '==', 'COURIER'),
      where('cityId', '==', currentCity) // ФИЛЬТР ПО ГОРОДУ
    );
    
    const unsubUsers = onSnapshot(couriersQ, (snapshot) => {
      // ...
    });
    
    return unsubUsers;
  }, [currentCity]);
};
```

### 3.4 Обновить Deliveries

```typescript
// admin-panel/src/pages/Deliveries.tsx
import { useCity } from '../contexts/CityContext';

const Deliveries: React.FC = ({ adminId }) => {
  const { currentCity } = useCity();
  
  const loadDeliveries = async () => {
    const q = query(
      collection(db, 'deliveries'),
      where('cityId', '==', currentCity), // ФИЛЬТР ПО ГОРОДУ
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    
    const snapshot = await getDocs(q);
    // ...
  };
  
  // Курьеры для назначения - только текущего города
  const loadCouriers = async () => {
    const q = query(
      collection(db, 'users'),
      where('role', '==', 'COURIER'),
      where('cityId', '==', currentCity) // ФИЛЬТР ПО ГОРОДУ
    );
    
    const snapshot = await getDocs(q);
    // ...
  };
};
```

### 3.5 Обновить Tariffs

```typescript
// admin-panel/src/pages/Tariffs.tsx
import { useCity } from '../contexts/CityContext';

const Tariffs: React.FC = ({ adminId }) => {
  const { currentCity, cities } = useCity();
  const currentCityData = cities.find(c => c.id === currentCity);
  
  const loadTariff = async () => {
    // Загрузить тариф ТЕКУЩЕГО города
    const tariffDoc = await getDoc(doc(db, 'tariffs', currentCity));
    
    if (tariffDoc.exists()) {
      const data = tariffDoc.data();
      // ...
    } else {
      // Создать тариф по умолчанию для нового города
      console.warn(`Тариф для города ${currentCity} не найден`);
    }
  };
  
  const handleSave = async () => {
    // Сохранить тариф для ТЕКУЩЕГО города
    await updateTariffFn({
      adminId,
      cityId: currentCity, // Город тарифа
      baseCost: Number(baseCost),
      // ...
    });
  };
  
  return (
    <Box>
      <Typography variant="h5">
        Тарифы — {currentCityData?.nameRu || currentCity}
      </Typography>
      
      {/* Остальной UI */}
    </Box>
  );
};
```

---

## ЭТАП 4: Firestore Indexes

### 4.1 Обновить `firestore.indexes.json`

```json
{
  "indexes": [
    {
      "collectionGroup": "deliveries",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "cityId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "deliveries",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "cityId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "courierId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "role", "order": "ASCENDING" },
        { "fieldPath": "cityId", "order": "ASCENDING" },
        { "fieldPath": "isOnline", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

### 4.2 Обновить `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Cities - читают все, пишут админы
    match /cities/{cityId} {
      allow read: if true;
      allow write: if isAdmin();
    }
    
    // Deliveries
    match /deliveries/{deliveryId} {
      // Курьеры видят только доставки своего города
      allow read: if isCourier() && resource.data.cityId == request.auth.uid.cityId;
      
      // Админы видят доставки своего города
      allow read: if isAdmin() && resource.data.cityId == getAdminCity();
      
      // Создание с автоматическим cityId
      allow create: if isCourier() && request.resource.data.cityId == request.auth.uid.cityId;
    }
    
    // Users
    match /users/{userId} {
      // Курьер видит только себя
      allow read, write: if isCourier() && request.auth.uid == userId;
      
      // Админ видит курьеров своего города
      allow read: if isAdmin() && resource.data.cityId == getAdminCity();
    }
    
    // Tariffs - по городу
    match /tariffs/{cityId} {
      allow read: if true;
      allow write: if isAdmin();
    }
  }
  
  function isCourier() {
    return exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'COURIER';
  }
  
  function isAdmin() {
    return exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'ADMIN';
  }
  
  function getAdminCity() {
    return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.cityId;
  }
}
```

---

## ЭТАП 5: Миграция данных

### 5.1 Скрипт миграции существующих данных

```javascript
// firebase/functions/src/migration.ts
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Миграция: добавить cityId="bokhtar" всем существующим данным
 * И создать тестового SUPER_ADMIN если не существует
 */
export const migrateToMultiCity = functions.https.onCall(async (data, context) => {
  const batch = db.batch();
  
  // 1. Проверить существование SUPER_ADMIN
  const superAdminExists = await db.collection('users')
    .where('role', '==', 'SUPER_ADMIN')
    .get();
  
  if (superAdminExists.empty) {
    // Создать SUPER_ADMIN по умолчанию (только для миграции!)
    console.warn('⚠️ SUPER_ADMIN не найден! Создаём временного супер-админа...');
    console.warn('⚠️ Обязательно измените логин/пароль после первого входа!');
    
    const defaultSuperAdmin = {
      name: 'Super',
      surname: 'Admin',
      phone: '+992918000000',
      login: 'superadmin',
      password: crypto.createHash('sha256').update('ChangeMe123!').digest('hex'),
      role: 'SUPER_ADMIN',
      cityId: null,
      cityName: null,
      isOnline: false,
      isBlocked: false,
      balance: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'migration_script',
      permissions: {
        canManageAllCities: true,
        canManageAdmins: true,
        canDeleteUsers: true,
        canViewAllStatistics: true,
        canManageTariffs: true,
        canManageCities: true
      }
    };
    
    await db.collection('users').add(defaultSuperAdmin);
    console.log('✅ Временный SUPER_ADMIN создан. Логин: superadmin, Пароль: ChangeMe123!');
  }
  
  // 2. Миграция курьеров
  const couriersSnap = await db.collection('users')
    .where('role', '==', 'COURIER')
    .get();
  
  console.log(`Миграция ${couriersSnap.size} курьеров...`);
  
  couriersSnap.docs.forEach(doc => {
    batch.update(doc.ref, {
      cityId: 'bokhtar',
      cityName: 'Бохтар',
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  // 3. Миграция доставок
  const deliveriesSnap = await db.collection('deliveries').get();
  
  console.log(`Миграция ${deliveriesSnap.size} доставок...`);
  
  deliveriesSnap.docs.forEach(doc => {
    batch.update(doc.ref, {
      cityId: 'bokhtar',
      cityName: 'Бохтар',
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  // 4. Миграция тарифов (переименовать default -> bokhtar)
  const defaultTariff = await db.collection('tariffs').doc('default').get();
  
  if (defaultTariff.exists) {
    console.log('Миграция тарифа default -> bokhtar...');
    
    const tariffData = defaultTariff.data();
    batch.set(db.collection('tariffs').doc('bokhtar'), {
      ...tariffData,
      cityId: 'bokhtar',
      cityName: 'Бохтар',
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Оставить default для обратной совместимости
    batch.update(db.collection('tariffs').doc('default'), {
      cityId: 'bokhtar',
      cityName: 'Бохтар',
      deprecated: true,
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  // 5. Создать город Бохтар в коллекции cities
  console.log('Создание документа города Бохтар...');
  
  batch.set(db.collection('cities').doc('bokhtar'), {
    id: 'bokhtar',
    name: 'Бохтар',
    nameRu: 'Бохтар (Курган-Тюбе)',
    nameEn: 'Bokhtar',
    center: {
      latitude: 37.8407,
      longitude: 68.7800
    },
    serviceRadiusMeters: 10000, // 10 км
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'migration_script'
  });
  
  // Выполнить все операции
  await batch.commit();
  
  console.log('✅ Миграция завершена успешно!');
  
  return { 
    success: true, 
    migrated: {
      superAdminCreated: superAdminExists.empty,
      couriers: couriersSnap.size,
      deliveries: deliveriesSnap.size,
      tariffMigrated: defaultTariff.exists,
      cityCreated: true
    },
    warning: superAdminExists.empty 
      ? '⚠️ Создан временный SUPER_ADMIN. Измените пароль!' 
      : null
  };
});

/**
 * Миграция: Создать город Душанбе и тариф для него
 */
export const createDushanbeCity = functions.https.onCall(async (data, context) => {
  const callerId = context.auth?.uid;
  
  if (!callerId) {
    throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
  }
  
  // Только SUPER_ADMIN может создавать новые города
  const callerDoc = await db.collection('users').doc(callerId).get();
  
  if (callerDoc.data()?.role !== 'SUPER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 
      'Только Супер Администратор может создавать города');
  }
  
  const batch = db.batch();
  
  // 1. Создать город Душанбе
  batch.set(db.collection('cities').doc('dushanbe'), {
    id: 'dushanbe',
    name: 'Душанбе',
    nameRu: 'Душанбе',
    nameEn: 'Dushanbe',
    center: {
      latitude: 38.5598,
      longitude: 68.7740
    },
    serviceRadiusMeters: 15000, // 15 км
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerId
  });
  
  // 2. Создать тариф для Душанбе
  batch.set(db.collection('tariffs').doc('dushanbe'), {
    cityId: 'dushanbe',
    cityName: 'Душанбе',
    baseCost: 7000, // Дороже чем в Бохтаре
    baseDistanceKm: 3,
    costPerKm: 2000,
    freeWaitingMinutes: 5,
    costPerWaitingMinute: 600,
    heavyCargoMeter: {
      baseCost: 20,
      baseDistanceKm: 3,
      costPerKm: 5
    },
    fixedTypes: {
      coal: 0,
      gas15: 0,
      gas30: 0,
      gas30plus: 0,
      errands: 0,
      heavyCargo: 0
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerId
  });
  
  await batch.commit();
  
  console.log(`✅ Город Душанбе создан супер-админом ${callerId}`);
  
  return { 
    success: true,
    city: 'dushanbe',
    tariff: 'dushanbe'
  };
});
```

---

## ЭТАП 6: Тестирование

### 6.1 Чек-лист тестирования

```markdown
## Тестирование изоляции городов и прав доступа

### � SMS Верификация и вход

#### SUPER_ADMIN вход (без SMS):
- [ ] Номер +992205250010 распознаётся как SUPER_ADMIN
- [ ] Номер +992948212121 распознаётся как SUPER_ADMIN
- [ ] SUPER_ADMIN входит БЕЗ SMS кода
- [ ] SUPER_ADMIN автоматически создаётся при первом входе
- [ ] SUPER_ADMIN может войти с любого устройства
- [ ] Логируется каждый вход SUPER_ADMIN в audit_log

#### ADMIN вход (с SMS):
- [ ] Админ вводит номер телефона
- [ ] Система проверяет номер в базе
- [ ] SMS код генерируется (6 цифр)
- [ ] SMS отправляется через Payom.tj
- [ ] SMS код имеет срок действия 5 минут
- [ ] Админ вводит верный код - успешный вход
- [ ] Админ вводит неверный код - ошибка
- [ ] Админ вводит просроченный код - ошибка
- [ ] Заблокированный админ не может войти
- [ ] Логируется каждый вход админа в audit_log

#### COURIER вход (с SMS):
- [ ] Курьер вводит номер телефона
- [ ] SMS код отправляется
- [ ] Курьер вводит верный код - успешный вход
- [ ] Заблокированный курьер не может войти
- [ ] Логируется каждый вход курьера

#### Несуществующий номер:
- [ ] Ввод несуществующего номера - ошибка
- [ ] Сообщение: "Пользователь с таким номером не найден"

### �👑 SUPER_ADMIN (Супер Администратор)
- [ ] Может войти в систему
- [ ] Видит переключатель всех городов ("🌍 Все города")
- [ ] Может переключаться между городами
- [ ] Видит статистику всех городов при выборе "Все города"
- [ ] Может создать админа для любого города
- [ ] Может редактировать админа любого города
- [ ] Может заблокировать админа любого города
- [ ] Может удалить админа любого города
- [ ] Может создать курьера в любом городе
- [ ] Может редактировать курьера любого города
- [ ] Может заблокировать курьера любого города
- [ ] Может удалить курьера любого города
- [ ] Может редактировать тариф любого города
- [ ] Может создать новый город
- [ ] НЕ может быть удалён или заблокирован другими админами

### 🏙️ CITY_ADMIN (Админ города - Бохтар)
- [ ] Может войти в систему
- [ ] Видит только свой город (фиксированный, не переключается)
- [ ] НЕ видит данные других городов
- [ ] Видит статистику только своего города
- [ ] Может создать курьера в СВОЁМ городе
- [ ] Может редактировать курьера СВОЕГО города
- [ ] Может заблокировать курьера СВОЕГО города
- [ ] Может удалить курьера СВОЕГО города
- [ ] НЕ может создать курьера в другом городе
- [ ] НЕ может редактировать курьеров других городов
- [ ] Может редактировать тариф СВОЕГО города
- [ ] НЕ может редактировать тариф другого города
- [ ] НЕ может создавать админов
- [ ] НЕ может видеть админов других городов

### 🏙️ CITY_ADMIN (Админ города - Душанбе)
- [ ] Может войти в систему
- [ ] Видит только свой город (Душанбе)
- [ ] НЕ видит данные Бохтара
- [ ] Все проверки аналогичны админу Бохтара

### 🚴 COURIER (Курьер)
- [ ] Может войти в приложение
- [ ] Видит только доставки своего города
- [ ] НЕ видит доставки других городов
- [ ] Создание доставки автоматически назначает город курьера
- [ ] Тарифы загружаются для города курьера
- [ ] НЕ может видеть курьеров других городов
- [ ] MapView показывает только курьеров текущего города

### 📱 Admin Panel
- [ ] City Selector работает для SUPER_ADMIN
- [ ] City Selector заблокирован для CITY_ADMIN
- [ ] Dashboard показывает статистику текущего города
- [ ] Deliveries фильтруется по городу
- [ ] Couriers показывает только курьеров текущего города
- [ ] Tariffs редактируется отдельно для каждого города
- [ ] Analytics аггрегирует данные только текущего города
- [ ] Map View показывает только объекты текущего города
- [ ] Страница Admins доступна только SUPER_ADMIN

### 🔐 Firebase Functions
- [ ] createCityAdmin требует SUPER_ADMIN
- [ ] createCourier проверяет права на город
- [ ] getStatistics фильтрует по cityId
- [ ] updateTariff проверяет права на город
- [ ] deleteCourier проверяет права на город
- [ ] blockCourier проверяет права на город
- [ ] createDushanbeCity требует SUPER_ADMIN
- [ ] Триггеры автоматически назначают cityId

### 🔒 Безопасность
- [ ] Курьер не может видеть доставки другого города
- [ ] Админ Бохтара не может управлять курьерами Душанбе
- [ ] Админ Душанбе не может управлять курьерами Бохтара
- [ ] Админ не может создать админа (только SUPER_ADMIN)
- [ ] SUPER_ADMIN не может быть удалён через API
- [ ] Тарифы защищены от несанкционированных изменений
- [ ] Firestore Rules правильно ограничивают доступ

### 🔄 Миграция данных
- [ ] Скрипт миграции выполняется без ошибок
- [ ] Все курьеры получили cityId="bokhtar"
- [ ] Все доставки получили cityId="bokhtar"
- [ ] Тариф "default" скопирован в "bokhtar"
- [ ] Город "bokhtar" создан в коллекции cities
- [ ] SUPER_ADMIN создан (если не существовал)
- [ ] Город "dushanbe" создан SUPER_ADMIN'ом
- [ ] Тариф для "dushanbe" создан
```

---

## ЭТАП 7: Запуск Душанбе

### 7.1 Пошаговый план запуска

```markdown
1. **Подготовка данных (1 день)**
   - [ ] Создать ветку `feature/multi-city-with-super-admin-sms`
   - [ ] Создать коллекцию `cities` в Firestore
   - [ ] Создать коллекцию `sms_codes` в Firestore
   - [ ] Создать коллекцию `audit_log` в Firestore
   - [ ] Добавить SUPER_ADMIN номера в environment variables:
     - `SUPER_ADMIN_PHONE_1=+992205250010`
     - `SUPER_ADMIN_PHONE_2=+992948212121`
   - [ ] Протестировать SMS верификацию на staging

2. **Backend обновление (3 дня)**
   - [ ] Обновить модели данных (users, deliveries, tariffs)
   - [ ] Добавить поле `role: SUPER_ADMIN | ADMIN | COURIER`
   - [ ] Добавить поле `phone` как основной идентификатор
   - [ ] Создать функции аутентификации:
     - `checkPhoneForLogin` - проверка номера и отправка SMS
     - `confirmLogin` - подтверждение входа
     - `generateSmsCode` - генерация кода
     - `normalizePhone` - нормализация номера
   - [ ] Создать функции управления:
     - `createCityAdmin` - создание админа города
     - `deleteCityAdmin` - удаление админа города
     - `toggleAdminBlock` - блокировка админа
     - `createCourier` - создание курьера с проверкой прав
     - `deleteCourier` - удаление курьера с проверкой прав
     - `blockCourier` - блокировка курьера с проверкой прав
     - `createDushanbeCity` - создание города Душанбе
   - [ ] Добавить индексы Firestore
   - [ ] Обновить правила безопасности
   - [ ] Деплой Firebase Functions на staging
   - [ ] Протестировать права доступа на staging
   - [ ] Протестировать SMS верификацию на staging

3. **Android обновление (2 дня)**
   - [ ] Обновить модели данных (User, Delivery)
   - [ ] Добавить поле cityId в модели
   - [ ] Добавить поле phone как идентификатор
   - [ ] Создать экран входа с SMS верификацией
   - [ ] Добавить фильтрацию по cityId в запросы
   - [ ] Обновить загрузку тарифов по городу курьера
   - [ ] Добавить проверку геолокации курьера
   - [ ] Тестирование на staging
   - [ ] Релиз новой версии APK (beta)

4. **Admin Panel обновление (4 дня)**
   - [ ] Создать AuthContext с ролями
   - [ ] Создать CityContext
   - [ ] Создать страницу Login.tsx с SMS верификацией
   - [ ] Добавить проверку ролей в Layout
   - [ ] Обновить навигацию:
     - SUPER_ADMIN: переключатель городов + меню "Админы"
     - CITY_ADMIN: фиксированный город
   - [ ] Создать страницу Admins.tsx (только для SUPER_ADMIN)
   - [ ] Создать страницу Cities.tsx (только для SUPER_ADMIN)
   - [ ] Обновить Dashboard с фильтрацией по городу
   - [ ] Обновить Deliveries с фильтрацией по городу
   - [ ] Обновить Couriers с фильтрацией по городу
   - [ ] Обновить Tariffs с фильтрацией по городу
   - [ ] Обновить Clients с фильтрацией по городу
   - [ ] Обновить Analytics с фильтрацией по городу
   - [ ] Обновить MapView с фильтрацией по городу
   - [ ] Тестирование на staging
   - [ ] Деплой на production

5. **Миграция production (1 день)**
   - [ ] Создать резервную копию Firestore
   - [ ] Добавить environment variables для SUPER_ADMIN номеров
   - [ ] Запустить деплой Firebase Functions
   - [ ] Проверить что SUPER_ADMIN может войти:
     - Тест +992205250010
     - Тест +992948212121
   - [ ] Проверить создание SUPER_ADMIN в audit_log
   - [ ] Назначить cityId="bokhtar" существующим данным
   - [ ] Создать город Душанбе
   - [ ] Создать тестового админа для Душанбе (назначить номер)
   - [ ] Протестировать SMS вход для админа Душанбе
   - [ ] Создать тестового курьера Душанбе
   - [ ] Протестировать SMS вход для курьера
   - [ ] Проверить изоляцию данных

6. **Мониторинг и финальная проверка (1 день)**
   - [ ] Проверить логи Firebase Functions
   - [ ] Проверить audit_log на наличие записей о входах
   - [ ] Мониторить ошибки в Crashlytics
   - [ ] Собрать обратную связь от админов Бохтара
   - [ ] Проверить что админ Душанбе видит только свой город
   - [ ] Проверить что SUPER_ADMIN видит все города
   - [ ] Проверить SMS доставку через Payom.tj
   - [ ] Документировать процесс для будущих городов
```

---

## 📊 Оценка времени и ресурсов

| Этап | Время | Сложность | Приоритет | Количество файлов |
|------|-------|-----------|-----------|-------------------|
| 0. Подготовка данных и SMS | 1 день | Средняя | Критический | 3 коллекции Firestore |
| 1. Backend (Firebase Functions) | 3 дня | Высокая | Критический | 5-7 файлов |
| 2. Android приложение | 2 дня | Высокая | Высокий | 10-15 файлов |
| 3. Admin Panel | 4 дня | Высокая | Критический | 15-20 файлов |
| 4. Firestore Indexes & Rules | 0.5 дня | Средняя | Высокий | 2 файла |
| 5. Миграция production | 1 день | Высокая | Критический | - |
| 6. Тестирование | 1 день | Средняя | Высокий | - |
| **ИТОГО** | **12.5 дней** | | | **~35-45 файлов** |

### Дополнительные файлы для создания:

1. **Firebase Functions:**
   - `checkPhoneForLogin.ts` — проверка номера и отправка SMS
   - `confirmLogin.ts` — подтверждение входа
   - `createCityAdmin.ts` — создание админа города
   - `deleteCityAdmin.ts` — удаление админа города
   - `toggleAdminBlock.ts` — блокировка админа
   - `createDushanbeCity.ts` — создание города Душанбе
   - `migration.ts` — миграция данных

2. **Firestore Collections:**
   - `sms_codes` — временные SMS коды (TTL 5 минут)
   - `audit_log` — логи действий пользователей
   - `cities` — города обслуживания

3. **Admin Panel:**
   - `pages/Login.tsx` — страница входа с SMS
   - `contexts/AuthContext.tsx` — контекст авторизации с ролями
   - `contexts/CityContext.tsx` — контекст выбора города
   - `pages/Admins.tsx` — управление админами (только SUPER_ADMIN)
   - `pages/Cities.tsx` — управление городами (только SUPER_ADMIN)
   - `components/RoleBasedRoute.tsx` — компонент для защиты роутов

4. **Android:**
   - Обновить `User.kt`, `Delivery.kt`, `Tariff.kt`
   - Создать `LoginActivity.kt` — экран входа с SMS
   - Обновить все репозитории
   - Обновить ViewModels

---

## 🚨 Риски и их митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| SMS не доставляется | Средняя | Высокое | Тестируйте Payom.tj API, добавьте retry логику |
| Потеря данных при миграции | Низкая | Критическое | Резервное копирование Firestore перед миграцией |
| Регрессия в Бохтаре | Средняя | Высокое | Тестирование на staging, поэтапный деплой |
| Проблемы производительности | Средняя | Среднее | Правильные индексы, мониторинг запросов |
| Ошибки в бизнес-логике | Средняя | Высокое | Code review, автоматические тесты |
| Несогласованность данных | Низкая | Среднее | Триггеры Firebase Functions |
| Компрометация SUPER_ADMIN номеров | Низкая | Критическое | Хранить номера в env vars, мониторинг входов |
| Случайное блокирование SUPER_ADMIN | Низкая | Критическое | Запрет на блокировку SUPER_ADMIN в коде |
| Админ пытается создать админа | Средняя | Низкое | Проверка роли в Firebase Functions |
| Админ пытается управлять другим городом | Средняя | Среднее | Проверка cityId в Firebase Functions |
| Истечение TTL SMS кода | Высокая | Низкое | Повторная отправка SMS, продление TTL |
| Подбор SMS кода | Низкая | Среднее | 6-значный код, ограничение попыток |

---

## 📚 Дополнительные ресурсы

### Документация Firestore
- [Compound queries](https://firebase.google.com/docs/firestore/query-data/queries)
- [Security rules](https://firebase.google.com/docs/rules)
- [Indexes](https://firebase.google.com/docs/firestore/query-data/indexing)

### Геолокация
- [GeoFlutterFire](https://pub.dev/packages/geoflutterfire) - для гео-запросов
- [Google Maps Platform](https://developers.google.com/maps/documentation) - boundaries

### Мульти-тенантность
- [Multi-tenancy with Firebase](https://firebase.google.com/docs/projects/multiprojects)

---

## ✅ Критерии успеха

**Запуск считается успешным если:**

### Иерархия прав доступа:
1. ✅ SUPER_ADMIN создан и может войти в систему
2. ✅ SUPER_ADMIN видит все города и может переключаться между ними
3. ✅ SUPER_ADMIN может создать админа для любого города
4. ✅ SUPER_ADMIN может редактировать/удалять админов
5. ✅ SUPER_ADMIN может управлять курьерами любого города
6. ✅ SUPER_ADMIN может редактировать тарифы любого города

### Изоляция городов:
7. ✅ Админ Бохтара видит только данные Бохтара
8. ✅ Админ Душанбе видит только данные Душанбе
9. ✅ Админ Бохтара НЕ может видеть данные Душанбе
10. ✅ Админ Душанбе НЕ может видеть данные Бохтара
11. ✅ Админ Бохтара НЕ может создать курьера в Душанбе
12. ✅ Админ Душанбе НЕ может создать курьера в Бохтаре

### Курьеры:
13. ✅ Курьеры Бохтара не могут принимать заказы в Душанбе
14. ✅ Курьеры Душанбе не могут принимать заказы в Бохтаре
15. ✅ Создание доставки автоматически назначает город курьера

### Тарифы и настройки:
16. ✅ Тарифы настроены независимо для каждого города
17. ✅ Админ Бохтара может редактировать тариф Бохтара
18. ✅ Админ Бохтара НЕ может редактировать тариф Душанбе
19. ✅ SUPER_ADMIN может редактировать тариф любого города

### Безопасность:
20. ✅ Админ НЕ может создать админа (только SUPER_ADMIN)
21. ✅ Админ НЕ может повысить себя до SUPER_ADMIN
22. ✅ SUPER_ADMIN не может быть удалён или заблокирован
23. ✅ Все Firebase Functions проверяют права доступа
24. ✅ Firestore Rules правильно ограничивают доступ

### Производительность:
25. ✅ Нет регрессии в существующем функционале Бохтара
26. ✅ Производительность системы не снизилась
27. ✅ Запросы к Firestore используют правильные индексы

---

## 🎯 Следующие шаги

**Для реализации:**

1. **Изучить этот документ** полностью
2. **Создать ветку** `feature/multi-city-with-super-admin` в git
3. **Начать с Этапа 0** (Инициализация SUPER_ADMIN)
4. **Делать коммиты** после каждого этапа
5. **Тестировать на staging** перед production
6. **Документировать** изменения в коде
7. **Создать резервную копию** Firestore перед миграцией

**Критически важные моменты:**

⚠️ **ОБЯЗАТЕЛЬНО измените пароль SUPER_ADMIN после первого входа!**  
⚠️ **Создайте резервную копию Firestore перед миграцией!**  
⚠️ **Тестируйте права доступа на staging перед production!**  
⚠️ **Документируйте логин/пароль SUPER_ADMIN в безопасном месте!**

---

## 📖 Пример использования системы

### Сценарий 1: SUPER_ADMIN входит в систему (без SMS)

```
1. SUPER_ADMIN открывает админ панель
2. Вводит номер телефона: +992205250010
3. Нажимает "Войти"
4. Система проверяет номер:
   - Найден в списке SUPER_ADMIN_PHONES ✓
   - requiresSms = false
5. Система создаёт/обновляет документ SUPER_ADMIN:
   - role: 'SUPER_ADMIN'
   - phone: '+992205250010'
   - lastLogin: текущее время
6. Логируется вход в audit_log:
   - action: 'SUPER_ADMIN_LOGIN'
   - phone: '+992205250010'
   - ip: 192.168.1.1
7. SUPER_ADMIN перенаправляется на Dashboard
8. Dashboard показывает переключатель городов: "🌍 Все города"
9. Готово! Вход занял < 2 секунды
```

### Сценарий 2: Админ Душанбе входит в систему (с SMS)

```
1. Админ открывает админ панель
2. Вводит номер телефона: +992918000002
3. Нажимает "Войти"
4. Система проверяет номер:
   - НЕ найден в SUPER_ADMIN_PHONES
   - Найден в базе: role='ADMIN', cityId='dushanbe'
   - requiresSms = true
5. Система генерирует SMS код: 847291
6. Код сохраняется в sms_codes:
   - phone: '+992918000002'
   - codeHash: sha256('847291')
   - expiresAt: now + 5 минут
7. SMS отправляется через Payom.tj:
   "Ваш код подтверждения ZaKi: 847291"
8. Админ видит форму ввода SMS кода
9. Вводит код: 847291
10. Система проверяет:
    - Код совпадает ✓
    - Код не просрочен ✓
    - Код не использован ✓
11. Код помечается как использованный
12. Логируется вход в audit_log
13. Админ перенаправляется на Dashboard
14. Dashboard показывает фиксированный город: "Душанбе"
15. Готово! Вход занял ~30 секунд
```

### Сценарий 3: SUPER_ADMIN создаёт админа для Душанбе

```
1. SUPER_ADMIN входит в систему (+992205250010)
2. Открывает страницу "Админы городов"
3. Нажимает "Добавить админа"
4. Заполняет форму:
   - Имя: Мухаммад
   - Фамилия: Исомов
   - Телефон: +992918000002
   - Город: Душанбе ✓
5. Нажимает "Создать"
6. Firebase Function проверяет:
   - Вызывающий = SUPER_ADMIN ✓
   - Город существует ✓
   - Номер уникален ✓
7. Админ создан:
   - role: 'ADMIN'
   - cityId: 'dushanbe'
   - phone: '+992918000002'
8. Новый админ может войти по SMS
9. Логируется в audit_log
```

### Сценарий 4: Админ Душанбе создаёт курьера

```
1. Админ Мухаммад входит (SMS: +992918000002)
2. Открывает страницу "Курьеры"
3. Нажимает "Добавить курьера"
4. Заполняет форму:
   - Имя: Рустам
   - Фамилия: Каримов
   - Телефон: +992918000003
   - Город: Душанбе (ФИКСИРОВАННО, не может выбрать другой)
5. Нажимает "Создать"
6. Firebase Function проверяет:
   - Вызывающий = ADMIN ✓
   - cityId = caller.cityId ("dushanbe") ✓
7. Курьер создан:
   - role: 'COURIER'
   - cityId: 'dushanbe'
   - phone: '+992918000003'
8. Курьер может войти по SMS
9. Логируется в audit_log
```

### Сценарий 5: Админ Бохтара пытается создать курьера в Душанбе

```
1. Админ Бохтара входит (cityId='bokhtar')
2. Открывает страницу "Курьеры"
3. Нажимает "Добавить курьера"
4. Пытается подделать запрос: cityId='dushanbe'
5. Firebase Function проверяет:
   - Вызывающий = ADMIN, cityId='bokhtar'
   - Запрос: cityId='dushanbe'
   - cityId !== caller.cityId
6. Ошибка 403: "Админ может создавать курьеров только в своём городе"
7. Курьер НЕ создан
8. Попытка логируется в audit_log как 'PERMISSION_DENIED'
```

### Сценарий 6: SUPER_ADMIN просматривает статистику всех городов

```
1. SUPER_ADMIN входит (+992948212121)
2. Открывает Dashboard
3. Выбирает в переключателе: "🌍 Все города"
4. Firebase Function возвращает данные всех городов
5. Dashboard показывает:
   - Всего курьеров: 50 (Бохтар: 30, Душанбе: 20)
   - Активные курьеры: 15
   - Доставки сегодня: 100
   - Выручка сегодня: 500,000 сомони
6. SUPER_ADMIN может переключиться на конкретный город
7. Выбор города сохраняется в localStorage
```

### Сценарий 7: Админ Душанбе просматривает статистику

```
1. Админ Душанбе входит (SMS)
2. Открывает Dashboard
3. Переключатель городов ОТСУТСТВУЕТ (заблокирован)
4. Dashboard показывает только данные Душанбе:
   - Курьеры: 20 (только Душанбе)
   - Активные курьеры: 8
   - Доставки сегодня: 40 (только Душанбе)
   - Выручка сегодня: 200,000 сомони (только Душанбе)
5. Админ НЕ видит данные Бохтара
6. Все запросы фильтруются по cityId='dushanbe'
```

### Сценарий 8: Пользователь вводит неверный SMS код

```
1. Пользователь вводит номер: +992918000003
2. SMS код отправлен: 847291
3. Пользователь вводит неверный код: 123456
4. Firebase Function проверяет:
   - Ищет код с hash sha256('123456')
   - Не найден
5. Ошибка 401: "Неверный или просроченный код"
6. Пользователь может попробовать снова
7. После 3 неудачных попыток - временная блокировка (1 минута)
```

### Сценарий 9: SUPER_ADMIN входит с резервного номера

```
1. SUPER_ADMIN открывает админ панель
2. Вводит номер: +992948212121 (резервный)
3. Нажимает "Войти"
4. Система проверяет:
   - Найден в SUPER_ADMIN_PHONES ✓
   - requiresSms = false
5. Система находит существующий документ SUPER_ADMIN:
   - phone: '+992948212121'
   - role: 'SUPER_ADMIN'
6. Обновляет lastLogin
7. Логируется вход с резервного номера
8. SUPER_ADMIN имеет те же права что и с основного номера
```

---

## 📚 Дополнительные ресурсы

### Документация Firestore
- [Compound queries](https://firebase.google.com/docs/firestore/query-data/queries)
- [Security rules](https://firebase.google.com/docs/rules)
- [Indexes](https://firebase.google.com/docs/firestore/query-data/indexing)
- [Role-based access control](https://firebase.google.com/docs/firestore/solutions/role-based-access)

### Геолокация
- [GeoFlutterFire](https://pub.dev/packages/geoflutterfire) - для гео-запросов
- [Google Maps Platform](https://developers.google.com/maps/documentation) - boundaries

### Мульти-тенантность
- [Multi-tenancy with Firebase](https://firebase.google.com/docs/projects/multiprojects)

### React + TypeScript
- [Context API](https://react.dev/reference/react/createContext)
- [Role-based routing](https://www.robinwieruch.de/react-router-private-routes/)

---

**Автор:** Kiro AI  
**Дата:** Август 2026  
**Версия:** 2.0 (с системой SUPER_ADMIN)
