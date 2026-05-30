/**
 * Скрипт инициализации Firestore для ZaKi Taksometr
 * 
 * Запуск:
 *   node init-firestore.js
 * 
 * Перед запуском:
 *   npm install firebase-admin
 *   Скачайте Service Account Key из Firebase Console:
 *   Project Settings → Service Accounts → Generate New Private Key
 *   Сохраните как serviceAccountKey.json в эту же папку
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Инициализация Firebase Admin
// Вариант 1: Через Service Account Key файл
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'auva-70253'
  });
} else {
  // Вариант 2: Через Application Default Credentials (gcloud auth)
  // Запустите: gcloud auth application-default login
  admin.initializeApp({
    projectId: 'auva-70253'
  });
  console.log('⚠️  serviceAccountKey.json не найден, используем Application Default Credentials');
  console.log('   Если ошибка — выполните: gcloud auth application-default login\n');
}

const db = admin.firestore();

// SHA-256 хеширование пароля
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function initializeFirestore() {
  console.log('🚀 Инициализация Firestore для ZaKi Taksometr...\n');

  // 1. Создание тарифа по умолчанию
  console.log('📋 Создание тарифа по умолчанию...');
  await db.collection('tariffs').doc('default').set({
    baseCost: 5000,
    costPerKm: 1500,
    currency: 'сум',
    isActive: true,
    updatedAt: Date.now()
  });
  console.log('   ✅ Тариф создан: базовая 5000 сум + 1500 сум/км\n');

  // 2. Создание администратора
  console.log('👤 Создание администратора...');
  const adminPassword = 'admin123'; // ИЗМЕНИТЕ ПАРОЛЬ!
  const adminPasswordHash = hashPassword(adminPassword);
  
  const adminRef = await db.collection('users').add({
    login: 'admin',
    passwordHash: adminPasswordHash,
    name: 'Администратор',
    phone: '',
    role: 'ADMIN',
    isOnline: false,
    isBlocked: false,
    createdAt: Date.now(),
    fcmToken: '',
    lastLocation: null
  });
  console.log(`   ✅ Администратор создан (ID: ${adminRef.id})`);
  console.log(`   📝 Логин: admin`);
  console.log(`   📝 Пароль: ${adminPassword}`);
  console.log(`   ⚠️  ОБЯЗАТЕЛЬНО СМЕНИТЕ ПАРОЛЬ!\n`);

  // 3. Создание тестового курьера
  console.log('🚴 Создание тестового курьера...');
  const courierPassword = 'courier123'; // ИЗМЕНИТЕ ПАРОЛЬ!
  const courierPasswordHash = hashPassword(courierPassword);

  const courierRef = await db.collection('users').add({
    login: 'courier1',
    passwordHash: courierPasswordHash,
    name: 'Тестовый Курьер',
    phone: '+998901234567',
    role: 'COURIER',
    isOnline: false,
    isBlocked: false,
    createdAt: Date.now(),
    fcmToken: '',
    lastLocation: null
  });
  console.log(`   ✅ Курьер создан (ID: ${courierRef.id})`);
  console.log(`   📝 Логин: courier1`);
  console.log(`   📝 Пароль: ${courierPassword}`);
  console.log(`   ⚠️  ОБЯЗАТЕЛЬНО СМЕНИТЕ ПАРОЛЬ!\n`);

  // 4. Создание настроек
  console.log('⚙️  Создание настроек...');
  await db.collection('settings').doc('general').set({
    appName: 'ZaKi Taksometr',
    version: '1.0.0',
    maintenanceMode: false,
    minAppVersion: '1.0.0',
    updatedAt: Date.now()
  });
  console.log('   ✅ Настройки созданы\n');

  // 5. Создание коллекции notifications (пустой документ-маркер)
  console.log('🔔 Инициализация коллекции notifications...');
  await db.collection('notifications').doc('_init').set({
    message: 'Collection initialized',
    createdAt: Date.now()
  });
  console.log('   ✅ Коллекция notifications создана\n');

  console.log('═══════════════════════════════════════════');
  console.log('✅ Инициализация завершена успешно!');
  console.log('═══════════════════════════════════════════');
  console.log('\nСозданные коллекции:');
  console.log('  • users (admin + тестовый курьер)');
  console.log('  • tariffs (default)');
  console.log('  • settings (general)');
  console.log('  • notifications (_init)');
  console.log('  • deliveries (будет заполняться при работе)');
  console.log('\n⚠️  Не забудьте:');
  console.log('  1. Сменить пароли admin и courier1');
  console.log('  2. Удалить serviceAccountKey.json из репозитория');
  console.log('  3. Задеплоить Firestore Rules: firebase deploy --only firestore:rules');
}

initializeFirestore()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });
