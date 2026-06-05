$file = "c:\Users\alisher\Documents\Projic Flutter\Taksometr\ZaKiTaksometr\android\app\src\main\java\com\zaki\taksometr\presentation\home\HomeScreen.kt"
$content = Get-Content $file -Raw -Encoding UTF8

# Replace all hardcoded Russian strings with localized versions
$replacements = @{
    'text = state.user\?.name \?: "Курьер"' = 'text = state.user?.name ?: str(Strings.courier)'
    'text = if \(state.user\?.isOnline == true\) "Онлайн" else "Оффлайн"' = 'text = if (state.user?.isOnline == true) str(Strings.online) else str(Strings.offline)'
    'title = "Заработок"' = 'title = str(Strings.earnings)'
    'title = "Доставки"' = 'title = str(Strings.deliveries)'
    'text = "Начать поездку"' = 'text = str(Strings.startTrip)'
    'title = \{ Text\("Выберите тип доставки"\) \}' = 'title = { Text(str(Strings.selectDeliveryType)) }'
    'title = "По счётчику \(обычная\)"' = 'title = str(Strings.counterBased)'
    'subtitle = "Оплата по километражу"' = 'subtitle = str(Strings.paymentByKilometer)'
    'title = "Уголь"' = 'title = str(Strings.coal)'
    'title = "Газ до 15 литров"' = 'title = str(Strings.gas15)'
    'title = "Газ до 30 литров"' = 'title = str(Strings.gas30)'
    'title = "Газ более 30 литров"' = 'title = str(Strings.gas30plus)'
    'title = "Различные поручения"' = 'title = str(Strings.errands)'
    'title = "Тяжелые грузы"' = 'title = str(Strings.heavyCargo)'
    'subtitle = "Фиксированная цена: ' = 'subtitle = "${str(Strings.fixedPrice)}: '
    ' сомони"' = ' ${str(Strings.somoni)}"'
    'Text\("Далее"\)' = 'Text(str(Strings.next))'
    'Text\("Отмена"\)' = 'Text(str(Strings.cancel))'
    'title = \{ Text\("Новая доставка"\) \}' = 'title = { Text(str(Strings.newDelivery)) }'
    'label = \{ Text\("Номер телефона клиента"\) \}' = 'label = { Text(str(Strings.clientPhoneNumber)) }'
    'Text\("Начать"\)' = 'Text(str(Strings.start))'
}

foreach ($pattern in $replacements.Keys) {
    $replacement = $replacements[$pattern]
    $content = $content -replace $pattern, $replacement
}

$content | Out-File $file -Encoding UTF8 -NoNewline
Write-Host "Replacements completed!"
