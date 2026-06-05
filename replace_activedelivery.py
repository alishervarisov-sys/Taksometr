#!/usr/bin/env python3
# -*- coding: utf-8 -*-

file_path = r"c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\android\app\src\main\java\com\zaki\taksometr\presentation\delivery\ActiveDeliveryScreen.kt"

# Read file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define replacements
replacements = {
    'title = { Text("Активная доставка") }': 'title = { Text(str(Strings.delivery)) }',
    'Icon(Icons.Default.ArrowBack, contentDescription = "Назад")': 'Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))',
    'title = "Текущее местоположение"': 'title = str(Strings.delivery)',
    'text = "Позвонить клиенту"': 'text = str(Strings.clientPhone)',
    'label = "Расстояние"': 'label = str(Strings.distance)',
    'label = "Время"': 'label = str(Strings.time)',
    'label = "Стоимость"': 'label = str(Strings.cost)',
    'text = "Ожидание: ${LocationUtils.formatDuration(state.totalWaitingMs)}"': 'text = "${str(Strings.waiting)}: ${LocationUtils.formatDuration(state.totalWaitingMs)}"',
    'text = if (state.isWaiting) "Остановить ожидание" else "Ожидание"': 'text = if (state.isWaiting) str(Strings.stopWaiting) else str(Strings.startWaiting)',
    'Text("Отменить")': 'Text(str(Strings.cancel))',
    'Text("Завершить")': 'Text(str(Strings.complete))',
    'title = { Text("Отменить доставку?") }': 'title = { Text(str(Strings.cancelDelivery)) }',
    'text = { Text("Вы уверены, что хотите отменить текущую доставку?") }': 'text = { Text(str(Strings.confirmCancel)) }',
    'Text("Отменить доставку")': 'Text(str(Strings.cancelDelivery))',
    'Text("Нет")': 'Text(str(Strings.no))',
    'title = { Text("Завершить доставку?") }': 'title = { Text("${str(Strings.complete)}?") }',
    '"Расстояние: ${LocationUtils.formatDistance(state.distanceMeters)}\\n" +': '"${str(Strings.distance)}: ${LocationUtils.formatDistance(state.distanceMeters)}\\n" +',
    '"Стоимость: ${LocationUtils.formatCost(state.currentCost)}"': '"${str(Strings.cost)}: ${LocationUtils.formatCost(state.currentCost)}"',
}

# Apply replacements
for old, new in replacements.items():
    content = content.replace(old, new)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ ActiveDeliveryScreen.kt updated successfully!")
print(f"Applied {len(replacements)} replacements")
