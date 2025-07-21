import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getGoogleSheetsClient } from '../app/lib/googleSheetsAuth.js';
dotenv.config();
// --- Keycloak Helper Functions ---
async function getKeycloakAdminToken() {
    const tokenUrl = `${process.env.KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`;
    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'password',
                username: process.env.PROD_KEYCLOAK_ADMIN_USER,
                password: process.env.PROD_KEYCLOAK_ADMIN_PASSWORD,
                client_id: 'admin-cli',
            }),
        });
        if (!response.ok) {
            console.error(`Failed to get Keycloak token: ${response.status} ${response.statusText}`);
            return null;
        }
        const tokenData = await response.json();
        return tokenData.access_token;
    }
    catch (error) {
        console.error("Failed to get Keycloak admin token:", error);
        return null;
    }
}
async function findUserInKeycloak(fio, token) {
    var _a, _b;
    const names = fio.split(' ').filter(Boolean);
    if (names.length === 0)
        return { email: null, phone: null };
    const lastName = names[0];
    const firstName = names.length > 1 ? names[1] : '';
    let query = `search=${encodeURIComponent(lastName)}`;
    if (firstName) {
        query += ` ${encodeURIComponent(firstName)}`;
    }
    const usersUrl = `${process.env.KEYCLOAK_URL}/admin/realms/cde/users?${query}`;
    try {
        const response = await fetch(usersUrl, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok)
            return { email: null, phone: null };
        const users = await response.json();
        if (users.length > 0) {
            const user = users[0];
            const phone = ((_b = (_a = user.attributes) === null || _a === void 0 ? void 0 : _a.phone) === null || _b === void 0 ? void 0 : _b[0]) || null;
            return { email: user.email || null, phone };
        }
    }
    catch (error) {
        console.error(`Error finding user '${fio}' in Keycloak:`, error);
    }
    return { email: null, phone: null };
}
// Query to fetch data from PostgreSQL
const DB_QUERY = process.env.DB_GOOGLE_SHEET_QUERY || `
SELECT
    pr.*,
    b.name AS brand_name,
    pb.name AS parent_brand_name,
    co.code AS produce_country_code,
    co.name AS produce_country_name,
    con."TIN" AS contractor_tin_number,
    con.code AS contractor_code,
    con.name AS contractor_name,
    rp.folder_id AS request_position_folder_id,
    rp.status_id AS request_position_status_id,
    ps.internal_name AS product_status_internal_name,
    ps.external_name AS product_status_external_name,
    rp.legal_approve AS request_position_legal_approve,
    rp.legal_req AS request_position_legal_req,
    rf.id AS folder_id,
    rf.creator_sub AS folder_creator_sub,
    rf.creation_datetime AS folder_creation_datetime,
    rt.name AS folder_type_name,
    rf.business_unit_id AS folder_business_unit_id,
    rf.category_id AS folder_category_id,
    pc.name AS folder_category_name,
    pg.code as product_group_code,
    pg.name as product_group_name,
    rf.promo_id AS folder_promo_id,
    rf.change_datetime AS folder_change_datetime
FROM
    product_requests pr
JOIN
    request_positions rp ON pr.request_position_id = rp.id
JOIN
    request_folders rf ON rp.folder_id = rf.id
LEFT JOIN brands b ON pr.brand_id = b.id
LEFT JOIN brands pb ON pr.parent_brand_id = pb.id
LEFT JOIN product_categories pc ON rf.category_id = pc.id
LEFT JOIN product_groups pg ON pr.group_id = pg.id
LEFT JOIN request_types rt ON rf.type_id = rt.id
LEFT JOIN product_statuses ps ON rp.status_id = ps.id
LEFT JOIN countries co ON pr.produce_country_id = co.id
LEFT JOIN contractors con ON pr."TIN" = con.id
`;
class ConfigManager {
    constructor() {
        var _a;
        this.config = {
            dbHost: process.env.POSTGRES_HOST,
            dbName: process.env.POSTGRES_DB,
            dbUser: process.env.POSTGRES_USER,
            dbPassword: process.env.POSTGRES_PASSWORD,
            dbPort: parseInt(process.env.POSTGRES_PORT || '5432', 10),
            googleSheetId: process.env.GOOGLE_SPREADSHEET_ID,
            googleSheetTabName: process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1',
            googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            googleServiceAccountPrivateKey: (_a = process.env.GOOGLE_PRIVATE_KEY) === null || _a === void 0 ? void 0 : _a.replace(/\\n/g, '\n'),
        };
        this.validate();
    }
    validate() {
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
async function getDbConnection(config) {
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
    }
    catch (error) {
        console.error("Database connection error:", error);
        return null;
    }
}
function loadTriggerHistory() {
    try {
        const historyPath = path.join(process.cwd(), 'trigger_history.json');
        const data = fs.readFileSync(historyPath, 'utf8');
        const history = JSON.parse(data);
        return {
            sent_folder_ids: history.sent_folder_ids || [],
            sent_for_translation: history.sent_for_translation || [],
            sent_for_icpu: history.sent_for_icpu || []
        };
    }
    catch (error) {
        console.warn('Could not load trigger history, using empty defaults:', error);
        return {
            sent_folder_ids: [],
            sent_for_translation: [],
            sent_for_icpu: []
        };
    }
}
function saveTriggerHistory(history) {
    try {
        const historyPath = path.join(process.cwd(), 'trigger_history.json');
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    }
    catch (error) {
        console.error('Failed to save trigger history:', error);
    }
}
function toGoogleSheetsSerialNumber(date) {
    const unixEpochDays = date.getTime() / 86400000;
    return unixEpochDays + 25569;
}
async function extractAndEnrichData(client, query, keycloakToken, limit = 10000, history) {
    console.info(`Extracting data with limit ${limit} rows`);
    const res = await client.query(query.includes('LIMIT') ? query : `${query} LIMIT ${limit}`);
    const originalColumns = res.fields.map((field) => field.name);
    const enrichedColumns = [...originalColumns, 'catman_email', 'catman_phone'];
    const enrichedData = [];
    const newTranslationItems = [];
    const newIcpuItems = [];
    const sentForTranslationIds = history ? history.translation.flatMap(entry => entry.request_ids) : [];
    const sentForIcpuIds = history ? history.icpu.flatMap(entry => entry.request_ids) : [];
    const catmanFioIndex = originalColumns.indexOf('catman_fio');
    if (catmanFioIndex === -1) {
        console.warn("'catman_fio' column not found in DB query. Cannot enrich data.");
        const originalData = res.rows.map(row => originalColumns.map(col => {
            const value = row[col];
            return value instanceof Date ? toGoogleSheetsSerialNumber(value) : value;
        }));
        return { columns: originalColumns, data: originalData, newTranslationItems: [], newIcpuItems: [] };
    }
    for (const row of res.rows) {
        const itemId = row.id; // Assuming 'id' is the primary key of the product
        // Skip if already sent for translation and icpu
        if (sentForTranslationIds.includes(itemId) && sentForIcpuIds.includes(itemId)) {
            continue;
        }
        // Track new items for translation
        if (!sentForTranslationIds.includes(itemId)) {
            newTranslationItems.push(itemId);
        }
        // Track new items for ICPU
        if (!sentForIcpuIds.includes(itemId)) {
            newIcpuItems.push(itemId);
        }
        const fio = row.catman_fio;
        let email = null;
        let phone = null;
        if (fio) {
            const keycloakUser = await findUserInKeycloak(fio, keycloakToken);
            email = keycloakUser.email;
            phone = keycloakUser.phone;
        }
        const rowValues = originalColumns.map(col => {
            const value = row[col];
            if (col === 'icpu_code' && value !== null) {
                return `'${value}`;
            }
            return value instanceof Date ? toGoogleSheetsSerialNumber(value) : value;
        });
        enrichedData.push([...rowValues, email, phone]);
    }
    return { columns: enrichedColumns, data: enrichedData, newTranslationItems, newIcpuItems };
}
async function loadDataToGoogleSheet(sheets, spreadsheetId, sheetName, columns, data) {
    try {
        console.info(`Starting upload of ${data.length} rows to Google Sheet: ${spreadsheetId}, Tab: ${sheetName}`);
        const rangeToClear = `${sheetName}!A1:ZZ`;
        console.log(`[INFO] Clearing existing content from range: ${rangeToClear}`);
        await sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: rangeToClear,
        });
        console.log('[INFO] Cleared existing sheet content.');
        const rowsToWrite = [columns, ...data];
        if (rowsToWrite.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: rowsToWrite,
                },
            });
            console.log(`[INFO] Successfully wrote ${data.length} data rows (plus headers) to Google Sheet "${sheetName}".`);
        }
        else {
            console.log('[INFO] No data to write to the sheet.');
        }
    }
    catch (error) {
        console.error("Error loading data to Google Sheet:", error);
        throw error;
    }
}
export async function exportDbToGoogleSheet() {
    var _a;
    console.info("Starting DB to Google Sheet export process");
    const configManager = new ConfigManager();
    const config = configManager.config;
    if (!config.googleSheetId) {
        return { success: false, message: "Critical: GOOGLE_SPREADSHEET_ID is missing." };
    }
    if (!config.dbHost || !config.dbName || !config.dbUser || !config.dbPassword) {
        return { success: false, message: "Missing critical PostgreSQL environment variables." };
    }
    const dbClient = await getDbConnection(config);
    if (!dbClient) {
        return { success: false, message: "Failed to connect to database." };
    }
    const keycloakToken = await getKeycloakAdminToken();
    if (!keycloakToken) {
        return { success: false, message: "Failed to get Keycloak token." };
    }
    try {
        const sheets = getGoogleSheetsClient();
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: config.googleSheetId });
        const existingSheet = (_a = spreadsheet.data.sheets) === null || _a === void 0 ? void 0 : _a.find((s) => { var _a; return ((_a = s.properties) === null || _a === void 0 ? void 0 : _a.title) === config.googleSheetTabName; });
        if (!existingSheet) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: config.googleSheetId,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: config.googleSheetTabName } } }],
                },
            });
        }
        const history = loadTriggerHistory();
        const { columns, data, newTranslationItems, newIcpuItems } = await extractAndEnrichData(dbClient, DB_QUERY, keycloakToken, 10000, { translation: history.sent_for_translation, icpu: history.sent_for_icpu });
        if (data.length === 0) {
            return { success: true, message: "No data extracted from the database.", rowCount: 0 };
        }
        await loadDataToGoogleSheet(sheets, config.googleSheetId, config.googleSheetTabName, columns, data);
        if (newTranslationItems.length > 0) {
            history.sent_for_translation.push({
                date: new Date().toISOString(),
                request_ids: newTranslationItems,
            });
        }
        if (newIcpuItems.length > 0) {
            history.sent_for_icpu.push({
                date: new Date().toISOString(),
                request_ids: newIcpuItems,
            });
        }
        saveTriggerHistory(history);
        return { success: true, message: "Data exported successfully to Google Sheet.", rowCount: data.length, newTranslationCount: newTranslationItems.length, newIcpuCount: newIcpuItems.length };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Export failed: ${errorMessage}` };
    }
    finally {
        if (dbClient) {
            await dbClient.end();
        }
    }
}
