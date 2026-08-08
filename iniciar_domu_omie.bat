@echo off
title DOMU - Conector Omie
echo.
echo  =============================================
echo   DOMU - Iniciando conector Omie...
echo  =============================================
echo.
node conector-omie.js
if %errorlevel% neq 0 (
  echo.
  echo  ERRO: Node.js nao encontrado ou erro no conector.
  echo  Certifique-se de que o Node.js esta instalado.
  echo.
  pause
)
