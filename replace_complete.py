#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os

files_to_update = [
    ("DeliveryCompleteScreen.kt", {
        'text = "Доставка завершена!"': 'text = str(Strings.deliveryCompleted)',
        'label = "Клиент"': 'label = str(Strings.client)',
        'label = "Расстояние"': 'label = str(Strings.distance)',
        'label = "Время поездки"': 'label = "${str(Strings.time)}"',
        'label = "Дата"': 'label = "${str(Strings.time)}"',
        'text = "Итого"': 'text = str(Strings.totalCost)',
        'text = "Готово"': 'text = str(Strings.done)',
    }),
    ("HistoryScreen.kt", {
        'title = { Text("История доставок") }': 'title = { Text(str(Strings.deliveryHistory)) }',
        'Icon(Icons.Default.ArrowBack, contentDescription = "Назад")': 'Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))',
        'placeholder = { Text("Поиск по номеру телефона") }': 'placeholder = { Text(str(Strings.searchByPhone)) }',
        'Text("Нет доставок")': 'Text(str(Strings.noDeliveries))',
        'DeliveryStatus.IN_PROGRESS -> "В процессе"': 'DeliveryStatus.IN_PROGRESS -> str(Strings.inProgress)',
        'DeliveryStatus.COMPLETED -> "Завершена"': 'DeliveryStatus.COMPLETED -> str(Strings.completed)',
        'DeliveryStatus.CANCELLED -> "Отменена"': 'DeliveryStatus.CANCELLED -> str(Strings.cancelled)',
    }),
    ("LoginScreen.kt", {
        'Text("ZaKi Taksometr")': 'Text(str(Strings.appName))',
        'label = { Text("Телефон") }': 'label = { Text(str(Strings.phoneNumber)) }',
        'placeholder = { Text("Введите номер телефона") }': 'placeholder = { Text(str(Strings.enterPhoneNumber)) }',
        'label = { Text("Пароль") }': 'label = { Text(str(Strings.password)) }',
        'placeholder = { Text("Введите пароль") }': 'placeholder = { Text(str(Strings.enterPassword)) }',
        'Text("Войти")': 'Text(str(Strings.loginButton))',
        'Text("Вход...")': 'Text(str(Strings.loggingIn))',
    }),
]

base_path = r"c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\android\app\src\main\java\com\zaki\taksometr\presentation"

for filename, replacements in files_to_update:
    if filename == "LoginScreen.kt":
        file_path = os.path.join(base_path, "auth", filename)
    elif filename == "HistoryScreen.kt":
        file_path = os.path.join(base_path, "history", filename)
    else:
        file_path = os.path.join(base_path, "delivery", filename)
    
    try:
        # Read file
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Apply replacements
        for old, new in replacements.items():
            content = content.replace(old, new)
        
        # Write back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"✅ {filename} updated successfully! Applied {len(replacements)} replacements")
    except Exception as e:
        print(f"❌ Error updating {filename}: {e}")

print("\n🎉 All files updated!")
