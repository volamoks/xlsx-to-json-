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

export interface RawSheetRow {
    [key: string]: unknown;
}

export interface SheetRow extends RawSheetRow {
    _rowNumber: number;
    [key: string]: unknown;
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
        let date: Date;
        if (dateValue instanceof Date) {
            date = dateValue;
        } else if (typeof dateValue === 'string' || typeof dateValue === 'number') {
            date = new Date(dateValue);
        } else {
            return String(dateValue);
        }
        if (isNaN(date.getTime())) {
            return String(dateValue);
        }
        return date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (_error) {
        return String(dateValue);
    }
}

export function validateSheetRow(row: GoogleSpreadsheetRow<RawSheetRow>): SheetRow {
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
    
    const validatedData: { [key: string]: unknown } = { _rowNumber: row.rowNumber };
    for (const key in data) {
        const value = data[key];
        if (key.includes('date') || key.includes('at')) {
            validatedData[key] = formatDateSafely(value);
        } else {
            validatedData[key] = value;
        }
    }
    return validatedData as SheetRow;
}

async function getSheetData(sheetName: string, useValidation: boolean = false): Promise<RawSheetRow[]> {
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

    // Using getValues directly to get raw, unformatted values
    const rows = await sheet.getRows({
        offset: 0,
        limit: sheet.rowCount,
    });

    const headerValues = sheet.headerValues;

    const rawRows = rows.map((row, index) => {
        const rowData: RawSheetRow = { _rowNumber: index + 2 }; // +2 because of header and 0-based index
        headerValues.forEach((header, _i) => {
            rowData[header] = row.get(header);
        });
        return rowData;
    });

    if (useValidation) {
        // This part needs adjustment if we want to use validateSheetRow with the new structure
        // For now, we assume validation is handled by the caller or is not needed for raw data
        return rawRows;
    }
    
    return rawRows;
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
            
            const updatePayload: { [key: string]: unknown } = { ...rowToUpdate };
            delete updatePayload._rowNumber; // Do not try to write the row number back to the sheet

            row.assign(updatePayload);
            await row.save();
        }
    }
}

export { getGoogleSheetsClient, getGoogleSpreadsheetDoc, getSheetData, updateSheetRows };
