@echo off
chcp 65001 >nul
powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "%~dp0modal.ps1" -SecretValue "https://internal.bank.com/api/v1" -DefaultAlias "$BANK_API_URL"
