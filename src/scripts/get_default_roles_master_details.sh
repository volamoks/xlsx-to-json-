#!/bin/bash

# Загрузка переменных окружения из .env файла
if [ -f .env ]; then
    # Используем set -a для автоматического экспорта переменных при source
    set -a
    . ./.env
    set +a
else
    echo "Ошибка: Файл .env не найден."
    exit 1
fi

# Используем PROD-креды, так как они указаны в .env
KEYCLOAK_ADMIN_USER=${PROD_KEYCLOAK_ADMIN_USER}
KEYCLOAK_ADMIN_PASSWORD=${PROD_KEYCLOAK_ADMIN_PASSWORD}

# Проверка наличия необходимых переменных
if [ -z "$KEYCLOAK_URL" ] || [ -z "$KEYCLOAK_REALM" ] || [ -z "$KEYCLOAK_ADMIN_USER" ] || [ -z "$KEYCLOAK_ADMIN_PASSWORD" ]; then
    echo "Ошибка: Отсутствуют необходимые переменные окружения (KEYCLOAK_URL, KEYCLOAK_REALM, PROD_KEYCLOAK_ADMIN_USER, PROD_KEYCLOAK_ADMIN_PASSWORD)."
    exit 1
fi

echo "Подключение к Keycloak Realm: $KEYCLOAK_REALM на $KEYCLOAK_URL"

# Настройка учетных данных kcadm.sh
kcadm.sh config credentials --server $KEYCLOAK_URL/auth --realm $KEYCLOAK_REALM --user $KEYCLOAK_ADMIN_USER --password $KEYCLOAK_ADMIN_PASSWORD

# Получение деталей роли default-roles-master
echo "Получение деталей роли default-roles-master..."
kcadm.sh get roles/default-roles-master -r $KEYCLOAK_REALM