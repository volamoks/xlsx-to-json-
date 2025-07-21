import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../../.env') });
let sheetsClient = null;
function getGoogleSheetsClient() {
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
    }
    catch (error) {
        console.error('[FATAL] Error initializing Google Sheets client:', error);
        throw error;
    }
}
async function getGoogleSpreadsheetDoc(spreadsheetId) {
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
    }
    catch (error) {
        console.error("Error accessing Google Spreadsheet document:", error);
        return null;
    }
}
function validateSheetRow(row) {
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
        request_position_status_id: data.request_position_status_id
            ? String(data.request_position_status_id)
            : undefined,
        icpu_check_sent_at: data.icpu_check_sent_at ? String(data.icpu_check_sent_at) : undefined,
        translation_sent_at: data.translation_sent_at ? String(data.translation_sent_at) : undefined,
        brand_name: data.brand_name ? String(data.brand_name) : undefined,
        parent_brand_name: data.parent_brand_name ? String(data.parent_brand_name) : undefined,
        product_group_code: data.product_group_code ? String(data.product_group_code) : undefined,
        product_group_name: data.product_group_name ? String(data.product_group_name) : undefined,
        _rowNumber: row.rowNumber,
    };
}
async function getSheetData(sheetName) {
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
    return rows.map(validateSheetRow);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRawSheetData(sheetName) {
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
async function updateSheetRows(sheetName, rowsToUpdate) {
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
