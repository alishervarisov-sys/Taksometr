#!/usr/bin/env python3
# -*- coding: utf-8 -*-

file_path = r"c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\android\app\src\main\java\com\zaki\taksometr\presentation\home\HomeScreen.kt"

# Read file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define replacements
replacements = {
    'text = state.user?.name ?: "Курьер"': 'text = state.user?.name ?: str(Strings.courier)',
    'text = if (state.user?.isOnline == true) "Онлайн" else "Оффлайн"': 'text = if (state.user?.isOnline == true) str(Strings.online) else str(Strings.offline)',
    'title = "Заработок"': 'title = str(Strings.earnings)',
    'title = "Доставки"': 'title = str(Strings.deliveries)',
    'text = "Начать поездку"': 'text = str(Strings.startTrip)',
    'title = { Text("Выберите тип доставки") }': 'title = { Text(str(Strings.selectDeliveryType)) }',
    'title = "По счётчику (обычная)"': 'title = str(Strings.counterBased)',
    'subtitle = "Оплата по километражу"': 'subtitle = str(Strings.paymentByKilometer)',
    'title = "Уголь"': 'title = str(Strings.coal)',
    'title = "Газ до 15 литров"': 'title = str(Strings.gas15)',
    'title = "Газ до 30 литров"': 'title = str(Strings.gas30)',
    'title = "Газ более 30 литров"': 'title = str(Strings.gas30plus)',
    'title = "Различные поручения"': 'title = str(Strings.errands)',
    'title = "Тяжелые грузы"': 'title = str(Strings.heavyCargo)',
    'subtitle = "Фиксированная цена: ${fixedTypes["coal"]?.toLong() ?: 0} сомони"': 'subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["coal"]?.toLong() ?: 0} ${str(Strings.somoni)}"',
    'subtitle = "Фиксированная цена: ${fixedTypes["gas15"]?.toLong() ?: 0} сомони"': 'subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["gas15"]?.toLong() ?: 0} ${str(Strings.somoni)}"',
    'subtitle = "Фиксированная цена: ${fixedTypes["gas30"]?.toLong() ?: 0} сомони"': 'subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["gas30"]?.toLong() ?: 0} ${str(Strings.somoni)}"',
    'subtitle = "Фиксированная цена: ${fixedTypes["gas30plus"]?.toLong() ?: 0} сомони"': 'subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["gas30plus"]?.toLong() ?: 0} ${str(Strings.somoni)}"',
    'subtitle = "Фиксированная цена: ${fixedTypes["errands"]?.toLong() ?: 0} сомони"': 'subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["errands"]?.toLong() ?: 0} ${str(Strings.somoni)}"',
    'subtitle = "Фиксированная цена: ${fixedTypes["heavyCargo"]?.toLong() ?: 0} сомони"': 'subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["heavyCargo"]?.toLong() ?: 0} ${str(Strings.somoni)}"',
    'Text("Далее")': 'Text(str(Strings.next))',
    'Text("Отмена")': 'Text(str(Strings.cancel))',
    'title = { Text("Новая доставка") }': 'title = { Text(str(Strings.newDelivery)) }',
    'label = { Text("Номер телефона клиента") }': 'label = { Text(str(Strings.clientPhoneNumber)) }',
    'Text("Начать")': 'Text(str(Strings.start))',
}

# Apply replacements
for old, new in replacements.items():
    content = content.replace(old, new)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ HomeScreen.kt updated successfully!")
print(f"Applied {len(replacements)} replacements")
