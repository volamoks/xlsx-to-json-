#!/bin/bash

# Скрипт для обновления пользователя Keycloak путем слияния новых JSON-данных с существующими.
#
# Предварительные требования:
# 1. Keycloak Admin CLI (kcadm.sh) должен быть настроен и находиться в PATH,
#    либо укажите полный путь к нему в переменной KCADM_CMD.
# 2. Утилита jq (https://stedolan.github.io/jq/download/) должна быть установлена.
#
# Использование:
# ./update_keycloak_user_merge.sh <REALM_NAME> <USER_IDENTIFIER_KEY> <USER_IDENTIFIER_VALUE> <PATH_TO_UPDATE_JSON>
#
# Пример:
# ./update_keycloak_user_merge.sh myrealm username testuser ./user_updates.json
# ./update_keycloak_user_merge.sh myrealm email test@example.com ./email_update.json

# --- Конфигурация ---
# Если kcadm.sh не в PATH, укажите полный путь, например: /opt/keycloak/bin/kcadm.sh
KCADM_CMD="kcadm.sh"

# --- Проверка входных данных ---
if [ "$#" -ne 4 ]; then
    echo "Использование: $0 <REALM_NAME> <USER_IDENTIFIER_KEY> <USER_IDENTIFIER_VALUE> <PATH_TO_UPDATE_JSON>"
    echo "Пример: $0 myrealm username testuser ./user_updates.json"
    exit 1
fi

REALM_NAME="$1"
USER_IDENTIFIER_KEY="$2"
USER_IDENTIFIER_VALUE="$3"
UPDATE_JSON_PATH="$4"

if ! command -v jq &> /dev/null; then
    echo "Ошибка: утилита jq не установлена. Пожалуйста, установите jq для использования этого скрипта."
    echo "Подробнее: https://stedolan.github.io/jq/download/"
    exit 1
fi

if [ ! -f "$UPDATE_JSON_PATH" ]; then
    echo "Ошибка: Файл с JSON для обновления не найден по пути $UPDATE_JSON_PATH"
    exit 1
fi

# --- Логика скрипта ---
echo "Попытка обновить пользователя '$USER_IDENTIFIER_VALUE' в realm '$REALM_NAME'..."

# 1. Получить ID пользователя
echo "Получение ID пользователя для $USER_IDENTIFIER_KEY=$USER_IDENTIFIER_VALUE..."
USER_ID=$($KCADM_CMD get users -r "$REALM_NAME" -q "$USER_IDENTIFIER_KEY=$USER_IDENTIFIER_VALUE" --fields id --format csv --noquotes)

if [ -z "$USER_ID" ]; then
    echo "Ошибка: Пользователь с $USER_IDENTIFIER_KEY '$USER_IDENTIFIER_VALUE' не найден в realm '$REALM_NAME'."
    # Опционально: создать пользователя, если не найден (логика upsert)
    # echo "Пользователь не найден. Для создания пользователя вы можете использовать:"
    # echo "$KCADM_CMD create users -r \"$REALM_NAME\" -f \"$UPDATE_JSON_PATH\" -s enabled=true -s emailVerified=true" # Добавьте другие необходимые поля
    exit 1
fi
echo "ID пользователя: $USER_ID"

# 2. Получить текущие данные пользователя
CURRENT_USER_DATA_FILE=$(mktemp) # Создать временный файл
echo "Получение текущих данных для пользователя с ID $USER_ID..."
if ! $KCADM_CMD get "users/$USER_ID" -r "$REALM_NAME" > "$CURRENT_USER_DATA_FILE"; then
    echo "Ошибка: Не удалось получить текущие данные для пользователя с ID $USER_ID."
    rm "$CURRENT_USER_DATA_FILE"
    exit 1
fi
# echo "Текущие данные пользователя сохранены во временный файл: $CURRENT_USER_DATA_FILE" # Для отладки

# 3. Объединить JSON-данные
MERGED_USER_DATA_FILE=$(mktemp) # Создать еще один временный файл
echo "Объединение текущих данных пользователя с данными из файла $UPDATE_JSON_PATH..."
if ! jq -s '.[0] * .[1]' "$CURRENT_USER_DATA_FILE" "$UPDATE_JSON_PATH" > "$MERGED_USER_DATA_FILE"; then
    echo "Ошибка: Не удалось объединить JSON-данные с помощью jq."
    echo "Убедитесь, что '$UPDATE_JSON_PATH' содержит корректный JSON."
    rm "$CURRENT_USER_DATA_FILE" "$MERGED_USER_DATA_FILE"
    exit 1
fi
# echo "Объединенные данные пользователя сохранены во временный файл: $MERGED_USER_DATA_FILE" # Для отладки

# 4. Обновить пользователя объединенными данными
echo "Обновление пользователя с ID $USER_ID объединенными данными..."
if $KCADM_CMD update "users/$USER_ID" -r "$REALM_NAME" -f "$MERGED_USER_DATA_FILE"; then
    echo "Пользователь '$USER_IDENTIFIER_VALUE' (ID: $USER_ID) в realm '$REALM_NAME' успешно обновлен."
else
    echo "Ошибка: Не удалось обновить пользователя с ID $USER_ID."
    rm "$CURRENT_USER_DATA_FILE" "$MERGED_USER_DATA_FILE"
    exit 1
fi

# Очистка временных файлов
rm "$CURRENT_USER_DATA_FILE" "$MERGED_USER_DATA_FILE"

echo "Процесс обновления завершен."
