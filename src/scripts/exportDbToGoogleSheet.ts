import { Client, FieldDef, QueryResult } from 'pg';
// GoogleSpreadsheetWorksheet is from 'google-spreadsheet', we'll use 'googleapis' directly
import dotenv from 'dotenv';
import { getGoogleSheetsClient } from '../app/lib/googleSheetsAuth'; // Import sheets client utility
import { sheets_v4 } from 'googleapis';

dotenv.config();

// Query to fetch data from PostgreSQL
const DB_QUERY = process.env.DB_GOOGLE_SHEET_QUERY || `
SELECT
    pr.*,
    b.name AS brand_name,          -- Added brand name
    pb.name AS parent_brand_name,  -- Added parent brand name
    co.code AS produce_country_code, -- Added from countries
    co.name AS produce_country_name, -- Added from countries
    con."TIN" AS contractor_tin_number, -- Changed to con."TIN"
    con.code AS contractor_code,      -- Added from contractors
    con.name AS contractor_name,      -- Added from contractors
    rp.folder_id AS request_position_folder_id, -- Added from request_positions
    rp.status_id AS request_position_status_id, -- Added request_position_status_id
    ps.internal_name AS product_status_internal_name, -- Added from product_statuses
    ps.external_name AS product_status_external_name, -- Added from product_statuses
    rp.legal_approve AS request_position_legal_approve, -- Added from request_positions
    rp.legal_req AS request_position_legal_req, -- Added from request_positions
    rf.id AS folder_id,
    rf.creator_sub AS folder_creator_sub,
    rf.creation_datetime AS folder_creation_datetime,
    rt.name AS folder_type_name, -- Added request type name
    rf.business_unit_id AS folder_business_unit_id,
    rf.category_id AS folder_category_id, -- Added folder category id
    pc.name AS folder_category_name, -- Added product category name
    rf.promo_id AS folder_promo_id,
    rf.change_datetime AS folder_change_datetime
    -- Add other columns from request_folders if needed, aliasing them with 'folder_' prefix
FROM
    product_requests pr
JOIN
    request_positions rp ON pr.request_position_id = rp.id
JOIN
    request_folders rf ON rp.folder_id = rf.id
LEFT JOIN -- Assuming 'brands' is the table name and 'id' is the primary key
    brands b ON pr.brand_id = b.id
LEFT JOIN -- Assuming 'brands' for parent brand as well, aliased as 'pb'
    brands pb ON pr.parent_brand_id = pb.id
LEFT JOIN -- Assuming 'product_categories' is the table name and 'id' is the primary key
    product_categories pc ON rf.category_id = pc.id
LEFT JOIN -- Assuming 'request_types' is the table name and 'id' is the primary key
    request_types rt ON rf.type_id = rt.id
LEFT JOIN -- Assuming 'product_statuses' is the table name and 'id' is the primary key
    product_statuses ps ON rp.status_id = ps.id
LEFT JOIN -- Assuming 'countries' is the table name and 'id' is the primary key
    countries co ON pr.produce_country_id = co.id
LEFT JOIN -- Assuming 'contractors' is the table name and 'id' is the primary key
    contractors con ON pr."TIN" = con.id -- Reverted to quoted "TIN"
`;

interface AppConfig {
    dbHost?: string;
    dbName?: string;
    dbUser?: string;
    dbPassword?: string;
    dbPort: number;
    googleSheetId?: string;
    googleSheetTabName: string;
    googleServiceAccountEmail?: string;
    googleServiceAccountPrivateKey?: string;
    // Alternatively, you can rely on GOOGLE_APPLICATION_CREDENTIALS env var for the JWT auth
}

class ConfigManager {
    public config: AppConfig;

    constructor() {
        this.config = {
            dbHost: process.env.POSTGRES_HOST, // Changed from DB_HOST
            dbName: process.env.POSTGRES_DB,   // Changed from DB_NAME
            dbUser: process.env.POSTGRES_USER, // Changed from DB_USER
            dbPassword: process.env.POSTGRES_PASSWORD, // Changed from DB_PASSWORD
            dbPort: parseInt(process.env.POSTGRES_PORT || '5432', 10), // Changed from DB_PORT
            googleSheetId: process.env.GOOGLE_SPREADSHEET_ID, // Changed from GOOGLE_SHEET_ID
            googleSheetTabName: process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1',
            googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            googleServiceAccountPrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Restored .replace(/\\n/g, '\n')
        };
        this.validate();
    }

    private validate(): void {
        const requiredDbVars = [this.config.dbHost, this.config.dbName, this.config.dbUser, this.config.dbPassword];
        if (requiredDbVars.some(v => !v)) {
            console.error("Missing critical PostgreSQL environment variables (POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD).");
        }
        if (!this.config.googleSheetId) {
            console.error("Missing GOOGLE_SPREADSHEET_ID environment variable.");
        }
        if (!this.config.googleServiceAccountEmail || !this.config.googleServiceAccountPrivateKey) {
            console.warn("GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY is not set. Authentication might rely on GOOGLE_APPLICATION_CREDENTIALS environment variable if set globally.");
        }
    }
}

async function getDbConnection(config: AppConfig): Promise<Client | null> {
    console.info("Attempting to connect to the database");
    const client = new Client({
        host: config.dbHost,
        database: config.dbName,
        user: config.dbUser,
        password: config.dbPassword,
        port: config.dbPort,
        connectionTimeoutMillis: 10000,
    });
    try {
        await client.connect();
        console.info("Database connection established successfully");
        return client;
    } catch (error) {
        console.error("Database connection error:", error);
        return null;
    }
}

type CellValue = string | number | boolean | Date | null;

// Helper function to convert JS Date to Google Sheets Serial Number
function toGoogleSheetsSerialNumber(date: Date): number {
    // Google Sheets epoch: December 30, 1899
    // JavaScript Date epoch (Unix epoch): January 1, 1970
    // Difference in days: 25569
    // Milliseconds in a day: 1000 * 60 * 60 * 24 = 86400000
    // Ensure the date is treated as UTC for calculation if it's not already
    // getTime() returns UTC milliseconds, so this should be fine.
    const unixEpochDays = date.getTime() / 86400000;
    return unixEpochDays + 25569;
}

async function extractData(client: Client, query: string, limit: number = 10000): Promise<{ columns: string[], data: CellValue[][] }> {
    console.info(`Extracting data with limit ${limit} rows`);
    console.info(`Full SQL query:\n${query}`);
    try {
        let finalQuery = query;
        // For Google Sheets, we might want to pull more data if the sheet can handle it.
        // The default limit is now 10000, adjust as needed.
        if (!query.toUpperCase().includes('LIMIT')) {
            finalQuery = `${query} LIMIT ${limit}`;
        }
        console.debug(`Executing query:\n${finalQuery}`);
        type DbRow = Record<string, CellValue>;

        const res: QueryResult<DbRow> = await client.query(finalQuery);

        const columns: string[] = res.fields.map((field: FieldDef) => field.name);
        const data: CellValue[][] = res.rows.map((row: DbRow) =>
            columns.map((col: string) => {
                const value: CellValue = row[col];
                if (value instanceof Date) {
                    // Convert to Google Sheets serial number
                    return toGoogleSheetsSerialNumber(value);
                }
                return value;
            })
        );

        if (data.length > 0) {
            console.info(`Extracted ${data.length} rows with ${columns.length} columns`);
        } else {
            console.warn("Query returned no data.");
        }
        return { columns, data };
    } catch (error) {
        console.error("Error extracting data:", error);
        throw error;
    }
}

// Removed local getGoogleSheet function, will use shared utility

async function loadDataToGoogleSheet(
    sheets: sheets_v4.Sheets, 
    spreadsheetId: string, 
    sheetName: string, 
    columns: string[], 
    data: CellValue[][]
): Promise<void> {
    try {
        console.info(`Starting upload of ${data.length} rows to Google Sheet: ${spreadsheetId}, Tab: ${sheetName}`);
        
        const rangeToClear = `${sheetName}!A1:ZZ`; // Assuming max columns ZZ
        console.log(`[INFO] Clearing existing content from range: ${rangeToClear}`);
        await sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: rangeToClear,
        });
        console.log('[INFO] Cleared existing sheet content.');

        const rowsToWrite: CellValue[][] = [];
        if (columns.length > 0) {
            rowsToWrite.push(columns); 
        } else if (data.length > 0 && data[0].length > 0) {
            const genericHeaders = data[0].map((_, i) => `Column ${i + 1}`);
            rowsToWrite.push(genericHeaders as CellValue[]);
            console.info(`Set generic headers as DB returned no column names.`);
        } else {
            console.warn("No columns or data to set as headers.");
        }

        rowsToWrite.push(...data); // Add data rows

        if (rowsToWrite.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'USER_ENTERED', // Or 'RAW'
                requestBody: {
                    values: rowsToWrite,
                },
            });
            console.log(`[INFO] Successfully wrote ${data.length} data rows (plus headers) to Google Sheet "${sheetName}".`);
        } else {
            console.log('[INFO] No data to write to the sheet.');
        }

    } catch (error) {
        console.error("Error loading data to Google Sheet:", error);
        throw error;
    }
}

export async function exportDbToGoogleSheet(): Promise<{ success: boolean; message: string; rowCount?: number }> {
    console.info("Starting DB to Google Sheet export process");
    const configManager = new ConfigManager();
    const config = configManager.config;

    // Validation for primary credentials
    if (!config.googleSheetId) {
        console.error("Critical: GOOGLE_SPREADSHEET_ID is missing.");
        return { success: false, message: "Critical: GOOGLE_SPREADSHEET_ID is missing." };
    }
    if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
        // If direct creds are missing, check for GOOGLE_APPLICATION_CREDENTIALS
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            const msg = "Missing Google Sheets authentication credentials. Set either (GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY) or GOOGLE_APPLICATION_CREDENTIALS in your .env file.";
            console.error(msg);
            return { success: false, message: msg };
        } else {
            console.info("Attempting to use GOOGLE_APPLICATION_CREDENTIALS for auth as email/key are not fully set.");
            // The JWT constructor in getGoogleSheet will attempt to use GOOGLE_APPLICATION_CREDENTIALS
            // if email/key are undefined.
        }
    }
    // Check DB creds after Google creds, as Google creds are more complex to debug if missing
    if (!config.dbHost || !config.dbName || !config.dbUser || !config.dbPassword) {
        const dbMsg = "Missing critical PostgreSQL environment variables. Please check POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD.";
        console.error(dbMsg);
        return { success: false, message: dbMsg };
    }


    const dbClient = await getDbConnection(config);
    if (!dbClient) {
        return { success: false, message: "Failed to connect to database." };
    }

    try {
        const sheets = getGoogleSheetsClient(); // Get authenticated sheets client
        
        // Ensure the sheet (tab) exists, create if not
        // This part is a bit more involved with googleapis directly compared to google-spreadsheet
        // For simplicity, we'll assume the tab exists or handle creation if needed (more complex with googleapis)
        // Let's check if the tab exists first.
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: config.googleSheetId });
        const existingSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === config.googleSheetTabName);

        if (!existingSheet) {
            console.log(`[INFO] Sheet "${config.googleSheetTabName}" does not exist. Creating it...`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: config.googleSheetId,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: config.googleSheetTabName } } }],
                },
            });
            console.log(`[INFO] Sheet "${config.googleSheetTabName}" created successfully.`);
        } else {
            console.log(`[INFO] Sheet "${config.googleSheetTabName}" already exists.`);
        }


        const { columns, data } = await extractData(dbClient, DB_QUERY);
        
        if (data.length === 0 && columns.length === 0) { 
            console.warn("No data extracted from the database. Nothing to upload.");
            return { success: true, message: "No data extracted from the database. Nothing to upload.", rowCount: 0 };
        }
        
        await loadDataToGoogleSheet(sheets, config.googleSheetId!, config.googleSheetTabName, columns, data);
        console.info("DB to Google Sheet export process completed successfully.");
        return { success: true, message: "Data exported successfully to Google Sheet.", rowCount: data.length };

    } catch (error: unknown) {
        console.error("Error during DB to Google Sheet export process:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Export failed: ${errorMessage}` };
    } finally {
        if (dbClient) {
            await dbClient.end();
            console.info("Database connection closed.");
        }
    }
}
