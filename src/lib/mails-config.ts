import { getSheetData } from '@/app/lib/googleSheetsAuth';

export interface MailConfig {
    process_id: string;           // request_position_status_id
    category_id?: string;         // категория (если нужна фильтрация)
    to_mail: string;             // основной получатель или название столбца из Sheet1
    to_name: string;             // имя основного получателя  
    cc_mail?: string;            // копия
    cc_name?: string;            // имя получателя копии
    has_xlsx: boolean;           // нужен ли Excel файл
    xlsx_template?: 'icpu' | 'translation';  // тип Excel шаблона
    email_template: string;      // имя HTML шаблона
    use_column_data: boolean;    // брать email из данных заявки (true) или использовать статичный to_mail (false)
}

interface RawMailConfig {
    Process_id: string;
    Category_id: string;
    To_mail: string;
    To_name: string;
    CC_mail: string;
    CC_name: string;
    Has_xlsx: string;
    Xlsx_template: string;
    Email_template: string;
    Use_column_data: string;
}

let cachedMailsConfig: MailConfig[] | null = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getMailsConfig(): Promise<MailConfig[]> {
    const now = Date.now();
    
    // Return cached data if still valid
    if (cachedMailsConfig && (now - lastCacheTime) < CACHE_DURATION) {
        return cachedMailsConfig;
    }

    try {
        console.log('Fetching mails configuration from Google Sheets...');
        const rawData = await getSheetData('Mails') as RawMailConfig[];
        
        if (!rawData || rawData.length === 0) {
            console.warn('No mails configuration found in Mails sheet');
            return [];
        }

        const mailsConfig: MailConfig[] = rawData
            .filter(row => row.Process_id && row.To_mail) // Only valid records
            .map(row => ({
                process_id: row.Process_id.toString().trim(),
                category_id: row.Category_id ? row.Category_id.toString().trim() : undefined,
                to_mail: row.To_mail.trim(),
                to_name: row.To_name ? row.To_name.trim() : '',
                cc_mail: row.CC_mail ? row.CC_mail.trim() : undefined,
                cc_name: row.CC_name ? row.CC_name.trim() : undefined,
                has_xlsx: row.Has_xlsx ? row.Has_xlsx.toString().toLowerCase() === 'true' : false,
                xlsx_template: row.Xlsx_template && ['icpu', 'translation'].includes(row.Xlsx_template.toLowerCase()) 
                    ? row.Xlsx_template.toLowerCase() as 'icpu' | 'translation' 
                    : undefined,
                email_template: row.Email_template ? row.Email_template.trim() : 'default_notification.html',
                use_column_data: row.Use_column_data ? row.Use_column_data.toString().toLowerCase() === 'true' : false
            }));

        // Cache the result
        cachedMailsConfig = mailsConfig;
        lastCacheTime = now;

        console.log(`Loaded ${mailsConfig.length} mail configuration records`);
        return mailsConfig;

    } catch (error) {
        console.error('Error loading mails configuration:', error);
        // Return cached data if available, or empty array
        return cachedMailsConfig || [];
    }
}

export async function getMailConfigForProcess(
    statusId: string, 
    categoryId?: string
): Promise<MailConfig[]> {
    const allConfigs = await getMailsConfig();
    
    return allConfigs.filter(config => {
        // Match process_id (status)
        if (config.process_id !== statusId) return false;
        
        // If config has category_id specified, it must match the requested category
        if (config.category_id && config.category_id !== categoryId) {
            return false;
        }
        
        // If config has no category_id (empty), it applies to all categories
        return true;
    });
}

export async function clearMailsConfigCache(): Promise<void> {
    cachedMailsConfig = null;
    lastCacheTime = 0;
    console.log('Mails configuration cache cleared');
}