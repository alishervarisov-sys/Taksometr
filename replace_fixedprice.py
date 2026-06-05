#!/usr/bin/env python3
# -*- coding: utf-8 -*-

file_path = r"c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\android\app\src\main\java\com\zaki\taksometr\presentation\delivery\FixedPriceDeliveryScreen.kt"

# Read file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define replacements
replacements = {
    '"coal" -> "Уголь"': '"coal" -> str(Strings.coal)',
    '"gas15" -> "Газ до 15л"': '"gas15" -> str(Strings.gas15)',
    '"gas30" -> "Газ до 30л"': '"gas30" -> str(Strings.gas30)',
    '"gas30plus" -> "Газ более 30л"': '"gas30plus" -> str(Strings.gas30plus)',
    '"errands" -> "Различные поручения"': '"errands" -> str(Strings.errands)',
    '"heavyCargo" -> "Тяжелые грузы"': '"heavyCargo" -> str(Strings.heavyCargo)',
    'else -> "Доставка"': 'else -> str(Strings.delivery)',
    'title = { Text("Активная доставка") }': 'title = { Text(str(Strings.delivery)) }',
    'Icon(Icons.Default.ArrowBack, contentDescription = "Назад")': 'Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))',
    'text = "Фиксированная цена"': 'text = str(Strings.fixedPrice)',
    'text = "Время: ${LocationUtils.formatDuration(state.elapsedTime)}"': 'text = "${str(Strings.time)}: ${LocationUtils.formatDuration(state.elapsedTime)}"',
    'text = "Позвонить клиенту"': 'text = str(Strings.clientPhone)',
    'title = { Text("Отменить доставку?") }': 'title = { Text(str(Strings.cancelDelivery)) }',
    'text = { Text("Вы уверены, что хотите отменить текущую доставку?") }': 'text = { Text(str(Strings.confirmCancel)) }',
    'Text("Отменить доставку")': 'Text(str(Strings.cancelDelivery))',
    'Text("Нет")': 'Text(str(Strings.no))',
    'title = { Text("Завершить доставку?") }': 'title = { Text("${str(Strings.complete)}?") }',
    '"Тип: $deliveryTypeName\\n" +': '"${str(Strings.delivery)}: $deliveryTypeName\\n" +',
    '"Стоимость: ${fixedPrice?.let { LocationUtils.formatCost(it) } ?: "0"}"': '"${str(Strings.cost)}: ${fixedPrice?.let { LocationUtils.formatCost(it) } ?: "0"}"',
    'Text("Завершить")': 'Text(str(Strings.complete))',
    'Text("Отменить")': 'Text(str(Strings.cancel))',
}

# Apply replacements
for old, new in replacements.items():
    content = content.replace(old, new)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ FixedPriceDeliveryScreen.kt updated successfully!")
print(f"Applied {len(replacements)} replacements")
