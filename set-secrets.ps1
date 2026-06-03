# Скрипт для установки секретов Supabase на новый проект
# Замените значения своими данными и запустите этот файл

$env:SUPABASE_ACCESS_TOKEN = "sbp_a9298d8c0abbd6f5a470adcd748b230f8d1d6acf"
$PROJECT_REF = "htepbcotdqrewbxmasbf"

# ===== ЗАПОЛНИТЕ ЭТИ ЗНАЧЕНИЯ =====

$TELEGRAM_BOT_TOKEN = "ВСТАВЬТЕ_ТОКЕН_БОТА"      # Получить у @BotFather в Telegram
$GOOGLE_SHEETS_CREDENTIALS = "ВСТАВЬТЕ_JSON"     # JSON сервисного аккаунта Google
$VAPID_PUBLIC_KEY = "BM7D3bxsQWn2RjeqcH4tFBh-Lmk7Szp48wyqxRu2KU8w189mUx8Bf1FUYSNDsD-o0ww6UlXSOn93qOAtN92G5lY"
$VAPID_PRIVATE_KEY = "ВСТАВЬТЕ_VAPID_PRIVATE_KEY"
$VAPID_SUBJECT = "mailto:eshua1988@gmail.com"

# ===================================

$secrets = @(
    @{ name = "TELEGRAM_BOT_TOKEN";       value = $TELEGRAM_BOT_TOKEN },
    @{ name = "GOOGLE_SHEETS_CREDENTIALS"; value = $GOOGLE_SHEETS_CREDENTIALS },
    @{ name = "VAPID_PUBLIC_KEY";          value = $VAPID_PUBLIC_KEY },
    @{ name = "VAPID_PRIVATE_KEY";         value = $VAPID_PRIVATE_KEY },
    @{ name = "VAPID_SUBJECT";             value = $VAPID_SUBJECT }
)

foreach ($secret in $secrets) {
    Write-Host "Setting $($secret.name)..."
    $body = @($secret) | ConvertTo-Json
    Invoke-RestMethod `
        -Uri "https://api.supabase.com/v1/projects/$PROJECT_REF/secrets" `
        -Method POST `
        -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"; "Content-Type" = "application/json" } `
        -Body $body
}

Write-Host "Done! Secrets set."
