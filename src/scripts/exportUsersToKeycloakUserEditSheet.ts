import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Define an interface for the Keycloak user structure
interface KeycloakUser {
    id?: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    createdTimestamp?: number;
    attributes?: {
        [key: string]: string[] | undefined;
        tin?: string[];
        notif_lang?: string[];
        categories?: string[];
        supplier?: string[];
        notif_telegram_destin?: string[];
        phoneNumber?: string[];
        business_units?: string[];
        notif_teams_destin?: string[];
        // Add other expected attributes here
    };
    // Add other potential top-level fields if known
}

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });


const keycloakUrl = process.env.KEYCLOAK_URL;
const keycloakAdminUser = process.env.PROD_KEYCLOAK_ADMIN_USER;
const keycloakAdminPassword = process.env.PROD_KEYCLOAK_ADMIN_PASSWORD;
const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID; // Ensure this is in your .env
const targetSheetName = 'KeycloakUserEdit'; // The new sheet name

if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword || !googleSpreadsheetId) {
    console.error('Error: Missing Keycloak or Google Spreadsheet environment variables in .env file');
    process.exit(1);
}

console.log('[INFO] Keycloak URL Host:', new URL(keycloakUrl).hostname);
console.log('[INFO] Keycloak Admin User: Configured');
// console.log('Keycloak Admin Password (first 5 chars):', keycloakAdminPassword ? keycloakAdminPassword.substring(0, 5) + '...' : 'N/A');
console.log('[INFO] Google Spreadsheet ID:', googleSpreadsheetId);
console.log('[INFO] Target Sheet Name for Export:', targetSheetName);
console.log('---'); // Separator

async function exportKeycloakUsersToSheet() {
    const masterRealm = 'master';
    const tokenUrl = `${keycloakUrl}/realms/${masterRealm}/protocol/openid-connect/token`;

    try {
        // 1. Obtain admin token from Keycloak
        console.log('[INFO] Obtaining Keycloak admin token...');
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'password',
                username: keycloakAdminUser!,
                password: keycloakAdminPassword!,
                client_id: 'admin-cli',
            }).toString(),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error('Failed to obtain Keycloak admin token:', tokenResponse.status, tokenResponse.statusText, errorData);
            process.exit(1);
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        console.log('[INFO] Admin token obtained successfully.');
        console.log('---');

        // 2. Fetch ALL users from Keycloak 'cde' realm with pagination
        const cdeRealm = 'cde';
        const allUsersData: KeycloakUser[] = [];
        let first = 0;
        const max = 100;
        let currentPage = 1;
        let keepFetching = true;
        console.log(`[INFO] Fetching users from Keycloak realm '${cdeRealm}' with pagination (max ${max} per page)...`);

        while (keepFetching) {
            const usersUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users?first=${first}&max=${max}&briefRepresentation=false`;
            // console.log(`[DEBUG] Fetching users page ${currentPage}: ${usersUrl}`); // Optional: for more detailed debugging

            try {
                const usersResponse = await fetch(usersUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (!usersResponse.ok) {
                    const errorData = await usersResponse.text();
                    console.error(`[ERROR] Failed to fetch Keycloak users (page ${currentPage}, starting at ${first}):`, usersResponse.status, usersResponse.statusText, errorData);
                    process.exit(1);
                }

                const pageUsersData: KeycloakUser[] = await usersResponse.json();
                console.log(`[INFO] Page ${currentPage}: Fetched ${pageUsersData.length} users.`);

                if (pageUsersData.length > 0) {
                    allUsersData.push(...pageUsersData);
                    if (pageUsersData.length < max) {
                        keepFetching = false; // Last page
                    } else {
                        first += max;
                        currentPage++;
                    }
                } else {
                    keepFetching = false; // No users returned, end of list
                }
            } catch (fetchError) {
                console.error(`[ERROR] Error during fetch for page ${currentPage} (starting at ${first}):`, fetchError);
                process.exit(1);
            }
        }
        console.log(`[INFO] Total users fetched from Keycloak realm '${cdeRealm}': ${allUsersData.length}.`);
        console.log('---');

        // 3. Prepare data for Google Sheets (one row per user)
        const rowsToWrite: (string | number | boolean)[][] = [];
        const headers = [
            'Keycloak ID', 'Username', 'Email', 'First Name', 'Last Name',
            'Enabled', 'Email Verified', 'Created Timestamp', 'Last Login', 'ICPU Code', 'Mxik Name', 'Package Name',
            'Roles', // Consolidated roles
            'TIN', 'Supplier', 'Phone Number', 'Categories', // Consolidated categories
            'Business Units', // Consolidated business units
            'Notification Language', 'Notification Telegram Destination', 'Notification Teams Destination',
            'To Create?', // New column for creation flag
            'To Update?', // New column for update flag
            'To Delete?' // New column for deletion flag
            // Add other attribute headers as needed
        ];
        rowsToWrite.push(headers);

        console.log('[INFO] Processing fetched users for sheet export...');
        for (const user of allUsersData) {
            const userId = user.id;
            if (!userId) {
                console.warn(`[WARN] Skipping user without ID: ${user.username || user.email}`);
                continue;
            }

            // Fetch role mappings
            let userRoles: string[] = [];
            try {
                const roleMappingsUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${userId}/role-mappings`;
                const roleMappingsResponse = await fetch(roleMappingsUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                });
                if (roleMappingsResponse.ok) {
                    const roleMappingsData = await roleMappingsResponse.json();
                    if (roleMappingsData.realmMappings) {
                        userRoles = roleMappingsData.realmMappings
                            .map((role: { name: string }) => role.name)
                            .filter((roleName: string) => roleName !== 'default-roles-master'); // Filter out default-roles-master
                    }
                    // Add client roles if needed:
                    // if (roleMappingsData.clientMappings) {
                    //     for (const client in roleMappingsData.clientMappings) {
                    //         roleMappingsData.clientMappings[client].mappings.forEach((role: { name: string }) => {
                    //             userRoles.push(`${client}/${role.name}`); // Prefix with client ID
                    //         });
                    //     }
                    // }
                } else {
                    console.warn(`[WARN] Failed to fetch roles for user ${userId}: ${roleMappingsResponse.status}`);
                }
            } catch (roleError) {
                console.error(`[ERROR] Error fetching roles for user ${userId}:`, roleError);
            }

            // Fetch last login time from user events
            let lastLoginTimestamp: number | undefined;
            try {
                // Query for the most recent LOGIN event for the user
                const eventsUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/events?type=LOGIN&user=${userId}&max=1&first=0`;
                const eventsResponse = await fetch(eventsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (eventsResponse.ok) {
                    const eventsData: Array<{ time: number; type: string; userId?: string }> = await eventsResponse.json();
                    if (eventsData && eventsData.length > 0) {
                        // The first event (max=1) should be the latest LOGIN event
                        lastLoginTimestamp = eventsData[0].time;
                    }
                } else {
                    console.warn(`[WARN] Failed to fetch LOGIN events for user ${userId}: ${eventsResponse.status} ${await eventsResponse.text()}`);
                }
            } catch (eventError) {
                console.error(`[ERROR] Error fetching LOGIN events for user ${userId}:`, eventError);
            }

            const attributes = user.attributes || {};
            const row = [
                userId,
                user.username || '',
                user.email || '',
                user.firstName || '',
                user.lastName || '',
                user.enabled !== undefined ? user.enabled : '',
                user.emailVerified !== undefined ? user.emailVerified : '',
                user.createdTimestamp ? new Date(user.createdTimestamp).toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', 'T').slice(0, 16).replace('T', ' ') : '',
                lastLoginTimestamp ? new Date(lastLoginTimestamp).toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', 'T').slice(0, 16).replace('T', ' ') : '',
                userRoles.join(', '), // Comma-separated roles
                attributes.tin?.[0] || '',
                attributes.supplier?.[0] || '',
                attributes.phoneNumber?.[0] || '',
                (attributes.categories || []).join(', '), // Comma-separated categories
                (attributes.business_units || []).join(', '), // Comma-separated business units
                attributes.notif_lang?.[0] || '',
                attributes.notif_telegram_destin?.[0] || '',
                attributes.notif_teams_destin?.[0] || '',
                '', // Default value for "To Create?"
                '', // Default value for "To Update?"
                '', // Default value for "To Delete?"
            ];
            rowsToWrite.push(row);
        }

        console.log('---');
        // 4. Initialize Google Sheets client and write data
        console.log(`[INFO] Preparing to write ${rowsToWrite.length -1} user rows to sheet: ${targetSheetName}`);
        const auth = new GoogleAuth({
            keyFile: path.resolve(__dirname, '../../google.json'), // Path to your service account key file
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // Ensure the sheet exists, create if not
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: googleSpreadsheetId });
        const existingSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === targetSheetName);

        if (existingSheet) {
            console.log(`[INFO] Sheet "${targetSheetName}" already exists.`);
        } else {
            console.log(`[INFO] Sheet "${targetSheetName}" does not exist. Creating it...`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: googleSpreadsheetId,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: targetSheetName } } }],
                },
            });
            console.log(`[INFO] Sheet "${targetSheetName}" created successfully.`);
        }
        console.log('---');
        // Clear existing content from the target sheet
        const rangeToClear = `${targetSheetName}!A1:ZZ`;
        console.log(`[INFO] Clearing existing content from range: ${rangeToClear}`);
        await sheets.spreadsheets.values.clear({
            spreadsheetId: googleSpreadsheetId,
            range: rangeToClear,
        });
        console.log('[INFO] Cleared existing sheet content.');

        // Write the new data
        if (rowsToWrite.length > 0) { // Always write headers, even if no users
            await sheets.spreadsheets.values.update({
                spreadsheetId: googleSpreadsheetId,
                range: `${targetSheetName}!A1`,
                valueInputOption: 'RAW', // Or 'RAW', USER_ENTERED tries to interpret types
                requestBody: {
                    values: rowsToWrite,
                },
            });
            console.log(`[INFO] Successfully exported ${rowsToWrite.length - 1} users to Google Sheet "${targetSheetName}".`);
        } else {
            console.log('[INFO] No user data to export (only headers would be written).');
        }
        console.log('---');
        console.log('[SUCCESS] Export script completed successfully.');

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('[FATAL] Error during export to KeycloakUserEdit sheet:', errorMessage);
        if (error instanceof Error && error.stack) {
            console.error('[STACK] ', error.stack);
        }
        process.exit(1);
    }
}

exportKeycloakUsersToSheet();
