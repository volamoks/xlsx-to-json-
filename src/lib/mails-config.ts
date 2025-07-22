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
    alert_body_text?: string;    // Текст для тела уведомления (alertBodyText)
    show_contact_info: boolean;  // Показывать ли блок с контактной информацией
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
    Alert_body_text: string; // New field for alert body text
    Show_contact_info: string; // New field to control contact info visibility
    // Use_column_data: string; // This column is missing in the sheet, infer its value
}

let cachedMailsConfig: MailConfig[] | null = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getMailsConfig(): Promise<MailConfig[]> {
    const now = Date.now();
    
    if (cachedMailsConfig && (now - lastCacheTime) < CACHE_DURATION) {
        console.log('Using cached mail config');
        return cachedMailsConfig;
    }

    try {
        console.log('Fetching mails configuration from Google Sheets...');
        const rawData = await getSheetData('Mails', false) as unknown as RawMailConfig[];
        
        if (!rawData || rawData.length === 0) {
            console.warn('No mails configuration found in Mails sheet');
            return [];
        }

        const mailsConfig: MailConfig[] = rawData
            .filter(row => row.Process_id && row.To_mail)
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
                email_template: 'universal_notification.html', // Always use the universal template
                // Infer use_column_data: if to_mail is a known column name for emails, set to true
                use_column_data: ['kam_email_enriched', 'catman_email'].includes(row.To_mail.trim()),
                alert_body_text: row.Alert_body_text ? row.Alert_body_text.trim() : undefined,
                show_contact_info: row.Show_contact_info ? row.Show_contact_info.toString().toLowerCase() === 'true' : true // Default to true
            }));

        cachedMailsConfig = mailsConfig;
        lastCacheTime = now;

        console.log(`Loaded ${mailsConfig.length} mail configuration records.`);
        return mailsConfig;

    } catch (error) {
        console.error('Error loading mails configuration:', error);
        return cachedMailsConfig || [];
    }
}

export async function getMailConfigForProcess(
    statusId: string,
    categoryId?: string
): Promise<MailConfig[]> {
    console.log(`Fetching mail config for status ${statusId}, category ${categoryId}`);
    const allConfigs = await getMailsConfig();
    
    console.log(`Found ${allConfigs.length} total configs`);
    console.log('All configs:', allConfigs.map(c => ({process: c.process_id, category: c.category_id, has_xlsx: c.has_xlsx})));

    // Возвращаем все конфигурации для данного статуса, включая те что без вложений
    const specificConfig = allConfigs.filter(config => {
        const matches = config.process_id === statusId && 
                       config.category_id && 
                       config.category_id === categoryId;
        console.log(`Config ${config.process_id}-${config.category_id} matches specific: ${matches}`);
        return matches;
    });

    if (specificConfig.length > 0) {
        console.log(`Found ${specificConfig.length} specific configs for category ${categoryId}`);
        return specificConfig;
    }

    const generalConfig = allConfigs.filter(config => 
        config.process_id === statusId && 
        (!config.category_id || config.category_id.trim() === '')
    );

    console.log(`Found ${generalConfig.length} general configs for status ${statusId}`);
    return generalConfig;
}

export async function clearMailsConfigCache(): Promise<void> {
    cachedMailsConfig = null;
    lastCacheTime = 0;
    console.log('Mails configuration cache cleared');
}