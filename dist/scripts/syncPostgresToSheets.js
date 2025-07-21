import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';
import path from 'path';
import { queryPostgres } from '../app/lib/postgresClient.js';
// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });
const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
// Removed unused googleSheetGid variable
const googleServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY;
if (!googleSpreadsheetId || !googleServiceAccountEmail || !googlePrivateKey) {
    console.error('Error: Missing Google Sheets environment variables in .env file');
    process.exit(1);
}
async function syncPostgresToSheets(sqlQuery, sheetName) {
    var _a, _b, _c, _d;
    try {
        // Query PostgreSQL data
        const data = await queryPostgres(sqlQuery);
        if (!data || data.length === 0) {
            console.log('No data returned from PostgreSQL query');
            return;
        }
        // Initialize Google Sheets client
        const auth = new JWT({
            email: googleServiceAccountEmail,
            key: googlePrivateKey.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        // Get or create sheet
        let sheetTitle = sheetName;
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: googleSpreadsheetId,
        });
        // Check if sheet exists
        let sheet = (_a = spreadsheet.data.sheets) === null || _a === void 0 ? void 0 : _a.find(s => {
            var _a;
            const title = (_a = s.properties) === null || _a === void 0 ? void 0 : _a.title;
            return title && title.toLowerCase() === sheetName.toLowerCase();
        });
        if (!sheet) {
            // Create new sheet
            const addSheetResponse = await sheets.spreadsheets.batchUpdate({
                spreadsheetId: googleSpreadsheetId,
                requestBody: {
                    requests: [{
                            addSheet: {
                                properties: {
                                    title: sheetName
                                }
                            }
                        }]
                }
            });
            sheet = (_c = (_b = addSheetResponse.data.replies) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.addSheet;
        }
        if (!((_d = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _d === void 0 ? void 0 : _d.title)) {
            throw new Error('Failed to get or create sheet - missing title property');
        }
        sheetTitle = sheet.properties.title;
        const range = `${sheetTitle}!A1:ZZ`;
        // Prepare headers from first row's keys
        const headers = Object.keys(data[0]);
        const rows = data.map((row) => headers.map(header => row[header]));
        // Clear existing content
        await sheets.spreadsheets.values.clear({
            spreadsheetId: googleSpreadsheetId,
            range: range,
        });
        // Write new data
        await sheets.spreadsheets.values.update({
            spreadsheetId: googleSpreadsheetId,
            range: `${sheetTitle}!A1`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [headers, ...rows],
            },
        });
        console.log(`Successfully synced ${data.length} rows to sheet: ${sheetTitle}`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('Error during PostgreSQL to Sheets sync:', errorMessage);
        process.exit(1);
    }
}
// Get SQL query and sheet name from command line args
const sqlQuery = process.argv[2] || 'SELECT * FROM products LIMIT 100';
const sheetName = process.argv[3] || 'postgres_data';
syncPostgresToSheets(sqlQuery, sheetName);
