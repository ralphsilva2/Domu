@echo off
title DOMU - Conector Omie
echo.
echo  =============================================
echo   DOMU - Iniciando...
echo  =============================================
echo.
echo  Apos iniciar, acesse no navegador:
echo  http://localhost:3000
echo.
echo  NAO feche esta janela!
echo.
node conector-omie.js
if %errorlevel% neq 0 (
  echo.
  echo  ERRO ao iniciar. Verifique se o Node.js esta instalado.
  echo  Baixe em: https://nodejs.org
  echo.
  pause
)
