import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
// Correctly resolve path from /src/app/lib to project root for .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../../.env') }); // Adjusted path

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

    // Resolve the keyFilePath relative to the project root if it's a relative path like './google.json'
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
        throw error; // Rethrow to indicate failure
    }
}

export { getGoogleSheetsClient };

// Function to get a specific sheet (document) using google-spreadsheet for easier row operations
// This part is different from your exportUsersToKeycloakUserEditSheet.ts but aligns with exportDbToGoogleSheet.ts
import { GoogleSpreadsheet } from 'google-spreadsheet'; // Removed GoogleSpreadsheetWorksheet
import { JWT } from 'google-auth-library';

async function getGoogleSpreadsheetDoc(spreadsheetId: string): Promise<GoogleSpreadsheet | null> {
    const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!spreadsheetId) {
        console.error("GOOGLE_SPREADSHEET_ID is not defined.");
        return null;
    }

    try {
        let auth: JWT;
        if (serviceAccountEmail && privateKey) {
            // console.info("Using GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY for google-spreadsheet auth.");
            auth = new JWT({
                email: serviceAccountEmail,
                key: privateKey,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
        } else if (keyFilePath) {
            // console.info("Using GOOGLE_APPLICATION_CREDENTIALS for google-spreadsheet auth.");
            const absoluteKeyFilePath = path.resolve(path.join(__dirname, '../../../'), keyFilePath);
            auth = new JWT({
                keyFile: absoluteKeyFilePath,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
        } else {
            console.error("No valid Google Service Account credentials found for google-spreadsheet. Set email/key or GOOGLE_APPLICATION_CREDENTIALS.");
            return null;
        }
        
        const doc = new GoogleSpreadsheet(spreadsheetId, auth);
        await doc.loadInfo();
        return doc;
    } catch (error) {
        console.error("Error accessing Google Spreadsheet document:", error);
        return null;
    }
}

export { getGoogleSpreadsheetDoc };
