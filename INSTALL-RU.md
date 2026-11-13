# Бесплатный IPA: сборка и установка

Готовая сборка: https://github.com/minchiki/quickprint-ios/releases/download/ipa-1/QuickPrint-unsigned.ipa

Требуется iOS 16.4 или новее. Размер: 9 512 124 байт. Сборка на macOS успешно завершена; проверены arm64-приложение, Share Extension, JS bundle, целостность архива и SHA-256 `5c96672e14f668b25d2ccc27b304f1d93a069e241f639df3b8ba85ae8764f8f7`. Проверка на физическом iPhone ещё не выполнена.

Исходники опубликованы с разрешения владельца: https://github.com/minchiki/quickprint-ios. Workflow `.github/workflows/ios-unsigned.yml` компилирует приложение для устройства arm64 вместе с QuickPrintShare. Успешные сборки доступны в https://github.com/minchiki/quickprint-ios/releases.

Apple Developer и Expo account для **неподписанной сборки** не нужны. Нужен macOS build host: в данном проекте предлагается стандартный GitHub Actions runner в публичном репозитории. Публикация исходников требует отдельного согласия владельца. В приватном репозитории нельзя обещать бесплатную сборку без проверки остатка квоты и бюджета.

Неподписанный IPA нельзя просто открыть на iPhone. Его необходимо переподписать своим обычным Apple ID через AltStore Classic/AltServer либо совместимый инструмент. На Windows первый раз используется USB-подключение. Для бесплатного Apple ID подпись действует 7 дней; нужен периодический refresh. Apple ID/пароль вводит сам пользователь в выбранном установщике, не в чате.

QuickPrint использует App Group и Share Extension. При переподписании нужно сохранить расширение, а общий контейнер должен соответствовать реально выданным App Group entitlements. Совместимость требует проверки на устройстве; успешный ZIP/IPA build её не доказывает. Удалять расширение ради успешной установки нельзя — это уберёт основной сценарий.

Проверенные источники:
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://sideloadly.io/faq
- https://faq.altstore.io/altstore-classic/app-ids

## Установка после успешной сборки

1. Установите AltServer на Windows по официальной инструкции: https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows. Она включает необходимые iTunes/iCloud, подключение iPhone по USB и установку AltStore на телефон.
2. На iPhone подтвердите доверие своему профилю разработчика в «Настройки → Основные → VPN и управление устройством». Включите «Настройки → Конфиденциальность и безопасность → Режим разработчика», если требуется.
3. Скачайте `QuickPrint-unsigned.ipa` из Releases в «Файлы» на iPhone. В AltStore откройте My Apps → «+» и выберите IPA. Если предложено удалить расширения, сохраните их (Keep App Extensions).
4. Запустите Windows-агент QuickPrint. Для печати нужен установленный SumatraPDF; для DOCX дополнительно LibreOffice. Телефон и компьютер должны быть в одной локальной сети.
5. Откройте QuickPrint на iPhone, разрешите локальную сеть и камеру, отсканируйте свежий QR из меню значка QuickPrint на компьютере.
6. Откройте документ → «Поделиться» → QuickPrint → «Напечатать».

Обновляйте подпись через AltStore → My Apps → Refresh All до истечения 7 дней, при доступном AltServer. https://faq.altstore.io/altstore-classic/your-altstore

Оплачивать Apple Developer не требуется. Вход в Apple ID и действия на телефоне выполняет владелец устройства. Совместимость общего контейнера, установка и физическая печать требуют проверки на iPhone.
