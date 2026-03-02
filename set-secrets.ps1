# Скрипт для установки секретов Supabase на новый проект
# Замените значения своими данными и запустите этот файл

$env:SUPABASE_ACCESS_TOKEN = "sbp_a9298d8c0abbd6f5a470adcd748b230f8d1d6acf"
$PROJECT_REF = "htepbcotdqrewbxmasbf"

# ===== ЗАПОЛНИТЕ ЭТИ ЗНАЧЕНИЯ =====

$TELEGRAM_BOT_TOKEN = "ВСТАВЬТЕ_ТОКЕН_БОТА"      # Получить у @BotFather в Telegram
$GOOGLE_SHEETS_CREDENTIALS = "ВСТАВЬТЕ_JSON"     # JSON сервисного аккаунта Google

# ===================================

$secrets = @(
    @{ name = "TELEGRAM_BOT_TOKEN";       value = $TELEGRAM_BOT_TOKEN },
    @{ name = "GOOGLE_SHEETS_CREDENTIALS"; value = $GOOGLE_SHEETS_CREDENTIALS }
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
