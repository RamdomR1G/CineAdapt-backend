#!/bin/bash
# Arranca el backend contra la base de pruebas y deja el PID en /tmp/cineadapt-pid. Uso: scripts/servidor-pruebas.sh [carpeta_src]
SRC=${1:-src}; cd "$(dirname "$0")/.."
export DB_HOST=${TEST_DB_HOST:-/tmp} DB_PORT=${TEST_DB_PORT:-5433} DB_NAME=${WB_DB_NAME:-cineadapt_wb} DB_USER=postgres DB_PASSWORD= DB_SSL=false JWT_SECRET=secreto-solo-pruebas PORT=4100
node $SRC/server.js > /tmp/cineadapt-server.log 2>&1 &
echo $! > /tmp/cineadapt-pid; sleep 2; cat /tmp/cineadapt-server.log
