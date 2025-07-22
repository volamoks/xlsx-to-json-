import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../../.env') });

let sheetsClient: sheets_v4.Sheets | null = null;

function getGoogleSheetsClient(): sheets_v4.Sheets {
    if (sheetsClient) {
        return sheetsClient;
    }

    const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!keyFilePath) {
        console.error('Error: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set in .env file.');
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set.');
    }

    const absoluteKeyFilePath = path.resolve(path.join(__dirname, '../../../'), keyFilePath);

    try {
        console.log(`[INFO] Attempting to authenticate Google Sheets API using keyFile: ${absoluteKeyFilePath}`);
        const auth = new GoogleAuth({
            keyFile: absoluteKeyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        sheetsClient = google.sheets({ version: 'v4', auth });
        console.log('[INFO] Google Sheets client authenticated successfully.');
        return sheetsClient;
    } catch (error) {
        console.error('[FATAL] Error initializing Google Sheets client:', error);
        throw error;
    }
}

interface RawSheetRow {
    [key: string]: unknown;
    barcode?: unknown;
    name_by_doc?: unknown;
    name_without_brand?: unknown;
    parent_brand_id?: unknown;
    brand_id?: unknown;
    icpu_code?: unknown;
    package_code_number?: unknown;
    package_code_name?: unknown;
    request_position_id?: unknown;
    folder_id?: unknown;
    request_position_folder_id?: unknown;
    request_position_status_id?: unknown;
    icpu_check_sent_at?: unknown;
    translation_sent_at?: unknown;
    brand_name?: unknown;
    parent_brand_name?: unknown;
    product_group_code?: unknown;
    product_group_name?: unknown;
    supplier_inn?: unknown;
    vat?: unknown;
    input_vat?: unknown;
    supplier_name?: unknown;
    contractor_name?: unknown;
    contractor_tin_number?: unknown;
    contract_number?: unknown;
    internal_number?: unknown;
    document_date?: unknown;
    addendum_number?: unknown;
    folder_creation_datetime?: unknown;
    folder_change_datetime?: unknown;
    folder_category_id?: unknown;
    folder_category_name?: unknown;
    catman_fio?: unknown;
    folder_creator_sub?: unknown;
    kam_email?: unknown;
    kam_fio?: unknown;
    catman_email?: unknown;
    catman_phone?: unknown;
    kam_email_enriched?: unknown;
    kam_fio_enriched?: unknown;
}

interface SheetRow {
    barcode: string;
    name_by_doc: string;
    name_without_brand: string;
    parent_brand_id: string;
    brand_id: string;
    icpu_code: string;
    package_code_number: string;
    package_code_name: string;
    request_position_id: string;
    folder_id: string;
    request_position_folder_id?: string;
    request_position_status_id?: string;
    icpu_check_sent_at?: string;
    translation_sent_at?: string;
    brand_name?: string;
    parent_brand_name?: string;
    product_group_code?: string;
    product_group_name?: string;
    supplier_inn?: string;
    vat?: string;
    input_vat?: string;
    supplier_name?: string;
    contractor_name?: string;
    contractor_tin_number?: string;
    contract_number?: string;
    internal_number?: string;
    document_date?: string;
    addendum_number?: string;
    folder_creation_datetime?: string;
    folder_change_datetime?: string;
    folder_category_id?: string;
    folder_category_name?: string;
    catman_fio?: string;
    folder_creator_sub?: string;
    kam_email?: string;
    kam_fio?: string;
    catman_email?: string;
    catman_phone?: string;
    kam_email_enriched?: string;
    kam_fio_enriched?: string;
    _rowNumber: number; // Internal property to track row number
}

async function getGoogleSpreadsheetDoc(spreadsheetId: string): Promise<GoogleSpreadsheet | null> {
    const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyFilePath) {
        console.error("GOOGLE_APPLICATION_CREDENTIALS is not defined.");
        return null;
    }

    try {
        const absoluteKeyFilePath = path.resolve(path.join(__dirname, '../../../'), keyFilePath);
        const auth = new JWT({
            keyFile: absoluteKeyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(spreadsheetId, auth);
        await doc.loadInfo();
        return doc;
    } catch (error) {
        console.error("Error accessing Google Spreadsheet document:", error);
        return null;
    }
}

function formatDateSafely(dateValue: unknown): string {
    if (!dateValue) return '';

    try {
        // Handle different date formats from database
        let date: Date;

        if (dateValue instanceof Date) {
            date = dateValue;
        } else if (typeof dateValue === 'string') {
            // Try parsing ISO string, PostgreSQL timestamp, etc.
            date = new Date(dateValue);
        } else if (typeof dateValue === 'number') {
            // Unix timestamp
            date = new Date(dateValue);
        } else {
            return String(dateValue);
        }

        // Check if date is valid
        if (isNaN(date.getTime())) {
            console.warn(`Invalid date value: ${dateValue}`);
            return String(dateValue);
        }

        // Format to Russian locale with date and time
        return date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });

    } catch (error) {
        console.warn(`Error formatting date ${dateValue}:`, error);
        return String(dateValue);
    }
}

function validateSheetRow(row: GoogleSpreadsheetRow<RawSheetRow>): SheetRow {
    const data = row.toObject();
    const requiredFields = [
        'barcode', 'name_by_doc', 'name_without_brand',
        'parent_brand_id', 'brand_id', 'icpu_code',
        'package_code_number', 'package_code_name',
        'request_position_id', 'folder_id'
    ];

    const missingFields = requiredFields.filter(field => !(field in data));
    if (missingFields.length > 0) {
        throw new Error(`Missing required fields in sheet row: ${missingFields.join(', ')}`);
    }

    return {
        barcode: String(data.barcode),
        name_by_doc: String(data.name_by_doc),
        name_without_brand: String(data.name_without_brand),
        parent_brand_id: String(data.parent_brand_id),
        brand_id: String(data.brand_id),
        icpu_code: String(data.icpu_code),
        package_code_number: String(data.package_code_number),
        package_code_name: String(data.package_code_name),
        request_position_id: String(data.request_position_id),
        folder_id: String(data.folder_id),
        request_position_folder_id: data.request_position_folder_id ? String(data.request_position_folder_id) : undefined,
        request_position_status_id: data.request_position_status_id
            ? String(data.request_position_status_id)
            : undefined,
        icpu_check_sent_at: data.icpu_check_sent_at ? String(data.icpu_check_sent_at) : undefined,
        translation_sent_at: data.translation_sent_at ? String(data.translation_sent_at) : undefined,
        brand_name: data.brand_name ? String(data.brand_name) : undefined,
        parent_brand_name: data.parent_brand_name ? String(data.parent_brand_name) : undefined,
        product_group_code: data.product_group_code ? String(data.product_group_code) : undefined,
        product_group_name: data.product_group_name ? String(data.product_group_name) : undefined,
        supplier_inn: data.supplier_inn ? String(data.supplier_inn) : undefined,
        vat: data.vat ? String(data.vat) : undefined,
        input_vat: data.input_vat ? String(data.input_vat) : undefined,
        supplier_name: data.supplier_name ? String(data.supplier_name) : undefined,
        contractor_name: data.contractor_name ? String(data.contractor_name) : undefined,
        contractor_tin_number: data.contractor_tin_number ? String(data.contractor_tin_number) : undefined,
        contract_number: data.contract_number ? String(data.contract_number) : undefined,
        internal_number: data.internal_number ? String(data.internal_number) : undefined,
        document_date: data.document_date ? formatDateSafely(data.document_date) : undefined,
        addendum_number: data.addendum_number ? String(data.addendum_number) : undefined,
        folder_creation_datetime: data.folder_creation_datetime ? formatDateSafely(data.folder_creation_datetime) : undefined,
        folder_change_datetime: data.folder_change_datetime ? formatDateSafely(data.folder_change_datetime) : undefined,
        folder_category_id: data.folder_category_id ? String(data.folder_category_id) : undefined,
        folder_category_name: data.folder_category_name ? String(data.folder_category_name) : undefined,
        catman_fio: data.catman_fio ? String(data.catman_fio) : undefined,
        folder_creator_sub: data.folder_creator_sub ? String(data.folder_creator_sub) : undefined,
        kam_email: data.kam_email ? String(data.kam_email) : undefined,
        kam_fio: data.kam_fio ? String(data.kam_fio) : undefined,
        catman_email: data.catman_email ? String(data.catman_email) : undefined,
        catman_phone: data.catman_phone ? String(data.catman_phone) : undefined,
        kam_email_enriched: data.kam_email_enriched ? String(data.kam_email_enriched) : undefined,
        kam_fio_enriched: data.kam_fio_enriched ? String(data.kam_fio_enriched) : undefined,
        _rowNumber: row.rowNumber,
    };
}

async function getSheetData(sheetName: string): Promise<SheetRow[]> {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
        throw new Error('GOOGLE_SPREADSHEET_ID is not defined in .env');
    }

    const doc = await getGoogleSpreadsheetDoc(spreadsheetId);
    if (!doc) {
        throw new Error('Failed to access Google Spreadsheet');
    }

    const sheet = doc.sheetsByTitle[sheetName];
    if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
    }

    const rows = await sheet.getRows<RawSheetRow>();
    return rows.map(validateSheetRow);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRawSheetData(sheetName: string): Promise<Record<string, any>[]> {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
        throw new Error('GOOGLE_SPREADSHEET_ID is not defined in .env');
    }

    const doc = await getGoogleSpreadsheetDoc(spreadsheetId);
    if (!doc) {
        throw new Error('Failed to access Google Spreadsheet');
    }

    const sheet = doc.sheetsByTitle[sheetName];
    if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
    }

    const rows = await sheet.getRows();
    return rows.map(row => row.toObject());
}


async function updateSheetRows(sheetName: string, rowsToUpdate: SheetRow[]): Promise<void> {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
        throw new Error('GOOGLE_SPREADSHEET_ID is not defined in .env');
    }

    const doc = await getGoogleSpreadsheetDoc(spreadsheetId);
    if (!doc) {
        throw new Error('Failed to access Google Spreadsheet');
    }

    const sheet = doc.sheetsByTitle[sheetName];
    if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
    }

    const rows = await sheet.getRows<RawSheetRow>();

    for (const rowToUpdate of rowsToUpdate) {
        const rowIndex = rows.findIndex(r => r.rowNumber === rowToUpdate._rowNumber);
        if (rowIndex !== -1) {
            const row = rows[rowIndex];
            Object.assign(row, rowToUpdate);
            await row.save();
        }
    }
}


export { getGoogleSheetsClient, getGoogleSpreadsheetDoc, getSheetData, getRawSheetData, updateSheetRows };
export type { SheetRow, RawSheetRow };
