import psycopg2
import os
import datetime
import logging
from typing import Tuple, List, Dict, Any
import time
from dotenv import load_dotenv
from msgraph import GraphServiceClient
from azure.identity import ClientSecretCredential, InteractiveBrowserCredential
from microsoft.graph.models import WorkbookRange, WorkbookTable

# Оптимизированный SQL запрос с устранением дублирования и улучшенными JOIN
DB_QUERY = """
SELECT * FROM product_requests
"""

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class Config:
    """Класс для управления конфигурацией приложения"""
    def __init__(self):
        self.DB_HOST = os.getenv('DB_HOST')
        self.DB_NAME = os.getenv('DB_NAME')
        self.DB_USER = os.getenv('DB_USER')
        self.DB_PASSWORD = os.getenv('DB_PASSWORD')
        self.DB_PORT = os.getenv('DB_PORT', '5432')
        self.TENANT_ID = os.getenv('TENANT_ID')
        self.CLIENT_ID = os.getenv('CLIENT_ID')
        self.CLIENT_SECRET = os.getenv('CLIENT_SECRET')
        self.USER_ID = os.getenv('USER_ID') # Или 'me' для текущего пользователя
        self.DRIVE_ITEM_ID = os.getenv('DRIVE_ITEM_ID') # ID файла Excel
        self.WORKSHEET_NAME = os.getenv('WORKSHEET_NAME', 'Sheet1')
        self.TABLE_NAME = os.getenv('TABLE_NAME', 'Table1') # Имя таблицы в Excel
        self.BATCH_SIZE = int(os.getenv('BATCH_SIZE', '100'))
        self.SERVER_CURSOR_NAME = os.getenv('SERVER_CURSOR_NAME', 'server_cursor')

    def validate(self) -> bool:
        """Проверяет наличие обязательных переменных окружения"""
        required_vars = [
            self.DB_HOST, self.DB_NAME,
            self.DB_USER, self.DB_PASSWORD,
            self.TENANT_ID, self.CLIENT_ID,
            self.DRIVE_ITEM_ID
        ]
        # CLIENT_SECRET или интерактивная аутентификация
        if not self.CLIENT_SECRET:
            logger.warning("CLIENT_SECRET не установлен. Будет использоваться интерактивная аутентификация.")
        return all(var is not None for var in required_vars)

# Load environment variables
load_dotenv()

def get_db_connection(config: Config) -> psycopg2.extensions.connection:
    """Устанавливает соединение с PostgreSQL с использованием серверного курсора"""
    logger.info("Попытка подключения к базе данных")
    try:
        conn = psycopg2.connect(
            host=config.DB_HOST,
            dbname=config.DB_NAME,
            user=config.DB_USER,
            password=config.DB_PASSWORD,
            port=config.DB_PORT,
            connect_timeout=10
        )
        logger.info("Соединение с базой данных установлено успешно")
        return conn
    except psycopg2.OperationalError as e:
        logger.error(f"Ошибка подключения к базе данных: {e}")
        return None
    except psycopg2.DatabaseError as e:
        logger.error(f"Ошибка базы данных: {e}")
        return None
    except Exception as e:
        logger.error(f"Неожиданная ошибка при подключении: {e}")
        return None

def extract_data(conn: psycopg2.extensions.connection,
                query: str,
                limit: int = 1000) -> Tuple[list, list]:
    """Извлекает данные из БД с использованием серверного курсора
    
    Args:
        conn: Соединение с БД
        query: SQL запрос
        limit: Максимальное количество строк
        
    Returns:
        Кортеж (список колонок, список данных)
    """
    logger.info(f"Извлечение данных с лимитом {limit} строк")
    logger.info(f"Полный SQL запрос:\n{query}")
    
    try:
        # Используем серверный курсор для потоковой обработки
        with conn.cursor() as cur:
            # Формируем финальный запрос с учетом типа СУБД
            final_query = query
            if 'LIMIT' not in query.upper():
                final_query = f"{query} LIMIT {limit}"
                
            logger.debug(f"Выполняемый запрос:\n{final_query}")
            
            cur.execute(final_query)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            data = cur.fetchall() or []  # Гарантируем пустой список вместо None
            
            if data:
                logger.info(f"Извлечено {len(data)} строк с {len(columns)} колонками")
                # Логируем первые 5 строк
                sample_rows = min(5, len(data))
                logger.info(f"Первые {sample_rows} строк результата:")
                for i, row in enumerate(data[:sample_rows], 1):
                    logger.info(f"Строка {i}: {row}")
            else:
                logger.warning("Запрос не вернул ни одной строки данных")
                
            return columns, data
            
    except psycopg2.DatabaseError as e:
        logger.error(f"Ошибка при извлечении данных: {e}")
        if 'LIMIT' in str(e):
            logger.warning("Проблема с синтаксисом LIMIT. Попробуйте другой формат для вашей СУБД")
        raise
    except Exception as e:
        logger.error(f"Неожиданная ошибка: {e}")
        raise

def get_graph_client(config: Config) -> GraphServiceClient:
    """Получает аутентифицированный клиент Microsoft Graph API."""
    logger.info("Попытка аутентификации в Microsoft Graph API")
    try:
        scopes = ['https://graph.microsoft.com/.default', 'offline_access']
        
        if config.CLIENT_SECRET:
            credentials = ClientSecretCredential(
                tenant_id=config.TENANT_ID,
                client_id=config.CLIENT_ID,
                client_secret=config.CLIENT_SECRET
            )
            logger.info("Используется аутентификация по секрету клиента.")
        else:
            credentials = InteractiveBrowserCredential(
                tenant_id=config.TENANT_ID,
                client_id=config.CLIENT_ID
            )
            logger.info("Используется интерактивная аутентификация через браузер.")
            
        client = GraphServiceClient(credentials=credentials, scopes=scopes)
        logger.info("Клиент Microsoft Graph API успешно создан.")
        return client
    except Exception as e:
        logger.error(f"Ошибка аутентификации в Microsoft Graph API: {e}")
        return None

async def load_to_excel_online(graph_client: GraphServiceClient,
                               config: Config,
                               columns: List[str],
                               data: List[List[Any]]) -> None:
    """Загружает или обновляет данные в таблице Excel Online через Microsoft Graph API.
    
    Args:
        graph_client: Аутентифицированный клиент GraphServiceClient.
        config: Объект конфигурации.
        columns: Список названий колонок.
        data: Данные для загрузки.
    """
    logger.info(f"Начало загрузки {len(data)} строк в Excel Online: {config.DRIVE_ITEM_ID}, лист: {config.WORKSHEET_NAME}, таблица: {config.TABLE_NAME}")
    
    try:
        # Получаем ссылку на таблицу
        table_path = f"/drives/{config.USER_ID}/items/{config.DRIVE_ITEM_ID}/workbook/worksheets('{config.WORKSHEET_NAME}')/tables('{config.TABLE_NAME}')"
        
        # Проверяем, существует ли таблица
        try:
            table = await graph_client.request_adapter.send_async(table_path, WorkbookTable)
            logger.info(f"Таблица '{config.TABLE_NAME}' найдена.")
        except Exception as e:
            logger.warning(f"Таблица '{config.TABLE_NAME}' не найдена. Попытка создать новую таблицу. Ошибка: {e}")
            # Если таблица не найдена, создаем ее
            # Сначала получаем диапазон, чтобы определить, где создать таблицу
            # Предполагаем, что таблица начинается с A1 и включает все колонки из данных
            range_address = f"A1:{chr(ord('A') + len(columns) - 1)}{len(data) + 1}"
            
            # Создаем таблицу
            table_request_body = {
                "address": range_address,
                "hasHeaders": True,
                "name": config.TABLE_NAME
            }
            
            try:
                table = await graph_client.drives.by_drive_id(config.USER_ID).items.by_drive_item_id(config.DRIVE_ITEM_ID).workbook.worksheets.by_worksheet_id(config.WORKSHEET_NAME).tables.post(table_request_body)
                logger.info(f"Таблица '{config.TABLE_NAME}' успешно создана.")
            except Exception as create_e:
                logger.error(f"Ошибка при создании таблицы '{config.TABLE_NAME}': {create_e}")
                raise

        # Очищаем существующие данные в таблице (если нужно полное обновление)
        # Для инкрементального обновления, мы будем добавлять строки
        # Если нужно очистить, можно использовать:
        # await graph_client.drives.by_drive_id(config.USER_ID).items.by_drive_item_id(config.DRIVE_ITEM_ID).workbook.worksheets.by_worksheet_id(config.WORKSHEET_NAME).tables.by_table_id(table.id).clear()
        # logger.info(f"Данные в таблице '{config.TABLE_NAME}' очищены.")

        # Добавляем заголовки, если таблица новая или пустая
        # Проверяем, есть ли уже заголовки в таблице
        header_range = await graph_client.drives.by_drive_id(config.USER_ID).items.by_drive_item_id(config.DRIVE_ITEM_ID).workbook.worksheets.by_worksheet_id(config.WORKSHEET_NAME).tables.by_table_id(table.id).header_row.get()
        if not header_range or not header_range.values:
            logger.info("Заголовки отсутствуют. Добавляем заголовки.")
            # Добавляем заголовки как первую строку данных
            await graph_client.drives.by_drive_id(config.USER_ID).items.by_drive_item_id(config.DRIVE_ITEM_ID).workbook.worksheets.by_worksheet_id(config.WORKSHEET_NAME).tables.by_table_id(table.id).rows.add.post({"values": [columns]})
        else:
            logger.info("Заголовки уже существуют. Пропускаем добавление заголовков.")

        # Добавляем данные инкрементально
        # Преобразуем datetime/date объекты в строки для корректной записи
        formatted_data = []
        for row_data in data:
            formatted_row = [
                value.strftime('%Y-%m-%d %H:%M:%S') if isinstance(value, (datetime.datetime, datetime.date))
                else value
                for value in row_data
            ]
            formatted_data.append(formatted_row)

        # Разделяем данные на батчи
        for i in range(0, len(formatted_data), config.BATCH_SIZE):
            batch = formatted_data[i:i + config.BATCH_SIZE]
            
            # Добавляем строки в таблицу
            add_rows_request_body = {
                "values": batch
            }
            await graph_client.drives.by_drive_id(config.USER_ID).items.by_drive_item_id(config.DRIVE_ITEM_ID).workbook.worksheets.by_worksheet_id(config.WORKSHEET_NAME).tables.by_table_id(table.id).rows.add.post(add_rows_request_body)
            logger.info(f"Добавлено {len(batch)} строк в таблицу '{config.TABLE_NAME}'.")
            time.sleep(1) # Небольшая задержка для избежания превышения лимитов API

        logger.info(f"Успешно загружено {len(data)} строк в Excel Online.")
        
    except Exception as e:
        logger.error(f"Ошибка при загрузке данных в Excel Online: {e}")
        raise

def compare_data(conn: psycopg2.extensions.connection,
                excel_file: str) -> Tuple[bool, bool]:
    """Сравнивает данные между БД и Excel файлом с нормализацией типов
    
    Args:
        conn: Соединение с БД
        excel_file: Путь к Excel файлу
        
    Returns:
        Кортеж (совпадение количества строк, совпадение первых 5 строк)
    """
    logger.info("Начало сравнения данных")
    
    try:
        # Получаем общее количество строк из БД с тем же фильтром, что и основной запрос
        db_total_count_query = """
        SELECT COUNT(*) FROM product_requests pr
        JOIN request_positions rp ON pr.request_position_id = rp.id
        JOIN request_folders rf ON rp.folder_id = rf.id
        """
        with conn.cursor() as cur:
            cur.execute(db_total_count_query)
            db_total_count = cur.fetchone()[0]
        logger.info(f"Общее количество строк в БД: {db_total_count}")

        # Получаем первые 5 строк из БД (без добавления LIMIT, так как DB_QUERY уже может его содержать)
        with conn.cursor() as cur:
            cur.execute(DB_QUERY)
            db_first_5_rows = cur.fetchmany(5) # Извлекаем только первые 5 строк
        
        # Получаем данные из Excel файла
        if not os.path.exists(excel_file):
            logger.error(f"Excel файл не найден: {excel_file}")
            return False, False

        workbook = openpyxl.load_workbook(excel_file)
        sheet = workbook.active
        
        excel_data = []
        for row in sheet.iter_rows(min_row=2, values_only=True): # Пропускаем заголовки
            excel_data.append(list(row))
            
        excel_row_count = len(excel_data)
        excel_first_5_rows = excel_data[:5]

        # Нормализуем типы данных для сравнения
        def normalize_value(value):
            if value is None:
                return ''
            if isinstance(value, (datetime.datetime, datetime.date)):
                return value.strftime('%Y-%m-%d %H:%M:%S')
            return str(value)

        db_first_5_normalized = [
            [normalize_value(item) for item in row]
            for row in db_first_5_rows
        ]
        excel_first_5_normalized = [
            [normalize_value(item) for item in row]
            for row in excel_first_5_rows
        ]

        # Сравниваем количество строк
        row_count_match = db_total_count == excel_row_count
        logger.info(f"Сравнение количества строк: {'СОВПАДАЕТ' if row_count_match else 'НЕ СОВПАДАЕТ'}")

        # Сравниваем первые 5 строк
        first_5_rows_match = db_first_5_normalized == excel_first_5_normalized
        logger.info(f"Сравнение первых 5 строк: {'СОВПАДАЕТ' if first_5_rows_match else 'НЕ СОВПАДАЕТ'}")

        return row_count_match, first_5_rows_match

    except psycopg2.DatabaseError as e:
        logger.error(f"Ошибка базы данных при сравнении: {e}")
        raise
    except Exception as e:
        logger.error(f"Неожиданная ошибка при сравнении данных: {e}")
        raise


def main():
    """Основная функция выполнения ETL-процесса"""
    try:
        # Инициализация конфигурации
        config = Config()
        if not config.validate():
            logger.error("Отсутствуют обязательные переменные окружения для подключения к БД")
            return

        logger.info("Начало выполнения ETL-процесса")

        # Получаем соединение с БД
        conn = get_db_connection(config)
        if not conn:
            return

        try:
            # Извлекаем данные
            query = DB_QUERY
            columns, data = extract_data(conn, query, limit=1000)
            row_count = len(data)

            # Загружаем данные в Excel
            load_to_excel(columns, data, config.EXCEL_OUTPUT_FILE)

            # Сравниваем данные
            row_count_match, first_5_rows_match = compare_data(conn, config.EXCEL_OUTPUT_FILE)

            # Формируем отчет
            logger.info("\n--- Отчет о выполнении ---")
            logger.info(f"Excel файл: '{config.EXCEL_OUTPUT_FILE}'")
            logger.info(f"Экспортировано строк: {row_count}")
            logger.info(f"Совпадение количества строк: {'ДА' if row_count_match else 'НЕТ'}")
            logger.info(f"Совпадение первых 5 строк: {'ДА' if first_5_rows_match else 'НЕТ'}")
            logger.info("--------------------------")

        except Exception as e:
            logger.error(f"Ошибка в процессе ETL: {e}")
        finally:
            if conn:
                conn.close()
                logger.info("Соединение с базой данных закрыто")

    except Exception as e:
        logger.error(f"Критическая ошибка: {e}")

if __name__ == "__main__":
    main()