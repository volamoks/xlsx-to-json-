import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library'; // Добавлен GoogleAuth
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Define an interface for the Keycloak user structure based on usage
interface KeycloakUser {
    id?: string;
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    createdTimestamp?: number;
    lastLogin?: number;
    attributes?: {
        [key: string]: string[] | undefined; // Attributes are typically string arrays
        tin?: string[];
        notif_lang?: string[];
        categories?: string[];
        supplier?: string[];
        notif_telegram_destin?: string[];
    };
    // Add other potential top-level fields if known
}

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });

const keycloakUrl = process.env.KEYCLOAK_URL;
const keycloakAdminUser = process.env.PROD_KEYCLOAK_ADMIN_USER; // Используем PROD-переменные
const keycloakAdminPassword = process.env.PROD_KEYCLOAK_ADMIN_PASSWORD; // Используем PROD-переменные
const googleSpreadsheetId = '1AF333V-HnymvXl4F1k4Vsqa8j7s9BnR5uV-D4MqTqS4'; // Updated Spreadsheet ID
const googleSheetGid = 1663998069; // New Sheet GID
// Удалены googleServiceAccountEmail и googlePrivateKey, так как они будут загружаться из файла

if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword) {
    console.error('Error: Missing Keycloak admin environment variables in .env file');
    process.exit(1);
}

console.log('Keycloak URL:', keycloakUrl);
console.log('Keycloak Admin User:', keycloakAdminUser);
console.log('Keycloak Admin Password (first 5 chars):', keycloakAdminPassword ? keycloakAdminPassword.substring(0, 5) + '...' : 'N/A');
console.log('Keycloak Realm for Token:', process.env.KEYCLOAK_REALM || 'master');

// Проверка только googleSpreadsheetId и googleSheetGid, так как учетные данные будут из файла
if (!googleSpreadsheetId || !googleSheetGid) {
    console.error('Error: Missing Google Sheets environment variables (Spreadsheet ID or Sheet GID) in .env file');
    process.exit(1);
}

async function syncKeycloakUsersToSheets() {
    const masterRealm = 'master'; // Всегда используем 'master' Realm для получения административного токена
    const tokenUrl = `${keycloakUrl}/realms/${masterRealm}/protocol/openid-connect/token`; // Get token from master realm

    try {
        // Obtain admin token from Keycloak
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'password',
                username: keycloakAdminUser!,
                password: keycloakAdminPassword!,
                client_id: 'admin-cli', // Возвращено на 'admin-cli'
            }).toString(),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error('Failed to obtain Keycloak admin token:', tokenResponse.status, tokenResponse.statusText, errorData);
            process.exit(1);
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        console.log('Admin token obtained successfully.');

        // Fetch ALL users from Keycloak 'cde' realm with pagination
        const cdeRealm = 'cde'; // Target realm for fetching users
        const allUsersData: KeycloakUser[] = [];
        let first = 0;
        const max = 100; // Number of users per page (adjust if needed, but 100 is common)
        let keepFetching = true;

        console.log('Fetching users from Keycloak with pagination...');

        while (keepFetching) {
            const usersUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users?first=${first}&max=${max}`;
            console.log(`Fetching users: ${usersUrl}`); // Log the URL for debugging

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
                    console.error(`Failed to fetch Keycloak users (page starting at ${first}):`, usersResponse.status, usersResponse.statusText, errorData);
                    keepFetching = false; // Stop fetching on error
                    // Consider if you want to exit(1) here or try to process partial data
                    process.exit(1); // Exit on error for now
                }

                const pageUsersData: KeycloakUser[] = await usersResponse.json();
                console.log(`Fetched ${pageUsersData.length} users on this page (started at ${first}).`);

                if (pageUsersData.length > 0) {
                    allUsersData.push(...pageUsersData); // Add fetched users to the main array
                    if (pageUsersData.length < max) {
                        // Last page reached
                        keepFetching = false;
                    } else {
                        // More users might exist, prepare for next page
                        first += max;
                    }
                } else {
                    // No users returned, must be the end
                    keepFetching = false;
                }
            } catch (fetchError) {
                console.error(`Error during fetch for page starting at ${first}:`, fetchError);
                keepFetching = false; // Stop fetching on error
                process.exit(1); // Exit on error
            }
        }

        console.log(`Total users fetched from Keycloak realm '${cdeRealm}': ${allUsersData.length}.`);

        // Prepare data structure for Google Sheets rows
        // Use a more specific type for the rows array: array of arrays containing strings, numbers, or booleans
        const rowsToWrite: (string | number | boolean)[][] = [];

        // Define headers explicitly for clarity and consistency
        // Ensure these match the order you want in the sheet
        const headers = [
            'Keycloak ID', 'Username', 'Email', 'First Name', 'Last Name',
            'Enabled', 'Email Verified', 'Created Timestamp', 'Last Login',
            'TIN', 'Notif Lang', 'Category', // Changed 'Categories' to 'Category'
            'Supplier', 'Telegram Destin', 'Roles', // Added Roles header
            'Notif Teams Destin', 'Business Units', 'Phone Number', // Added new headers
            // Add any other headers you expect based on user attributes or top-level fields
        ];
        rowsToWrite.push(headers); // Add headers as the first row

        // Define the list of all possible categories if the user's list is empty
        const allCategories = ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '013', '014', '015', '016', '017', '018', '019', '020', '021', '027', '028', '029'];

        // Process ALL fetched users to create rows with one category per row
        // Use async forEach or a for...of loop to handle async role fetching inside
        for (const user of allUsersData) { // Changed to iterate over allUsersData
            const userId = user.id;
            if (!userId) {
                console.warn(`Skipping user without ID: ${user.username || user.email}`);
                continue; // Skip user if ID is missing
            }

            // Fetch role mappings for the user
            let userRoles: string[] = [];
            try {
                const roleMappingsUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${userId}/role-mappings`;
                const roleMappingsResponse = await fetch(roleMappingsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (roleMappingsResponse.ok) {
                    const roleMappingsData = await roleMappingsResponse.json();
                    // Extract realm roles (adjust if you need client roles)
                    if (roleMappingsData.realmMappings) {
                        userRoles = roleMappingsData.realmMappings.map((role: { name: string }) => role.name);
                    }
                } else {
                    console.warn(`Failed to fetch roles for user ${userId}: ${roleMappingsResponse.status}`);
                }
            } catch (roleError) {
                console.error(`Error fetching roles for user ${userId}:`, roleError);
            }
            const rolesString = userRoles.join(', '); // Join roles into a string

            // Fetch user sessions to get last login time
            let lastLoginTimestamp: number | undefined;
            try {
                const sessionsUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${userId}/sessions`;
                const sessionsResponse = await fetch(sessionsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (sessionsResponse.ok) {
                    const sessionsData: Array<{ start: number }> = await sessionsResponse.json();
                    if (sessionsData && sessionsData.length > 0) {
                        // Find the session with the latest start time
                        const latestSession = sessionsData.reduce((latest, current) => {
                            return current.start > latest.start ? current : latest;
                        });
                        lastLoginTimestamp = latestSession.start;
                    }
                } else {
                    console.warn(`Failed to fetch sessions for user ${userId}: ${sessionsResponse.status}`);
                }
            } catch (sessionError) {
                console.error(`Error fetching sessions for user ${userId}:`, sessionError);
            }

            const baseRowData = [
                userId, // Use the validated userId
                user.username || '',
                user.email || '',
                user.firstName || '',
                user.lastName || '',
                user.enabled !== undefined ? user.enabled : '',
                user.emailVerified !== undefined ? user.emailVerified : '',
                user.createdTimestamp ? new Date(user.createdTimestamp).toISOString() : '',
                lastLoginTimestamp ? new Date(lastLoginTimestamp).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Tashkent' }).replace(',', '') : '', // Format as YYYY-MM-DD HH:mm:ss in Tashkent time zone
            ];

            const attributes = user.attributes || {};
            // Extract attributes, assuming single values for these unless specified otherwise
            const tin = attributes.tin?.[0] || '';
            const notifLang = attributes.notif_lang?.[0] || '';
            const supplier = attributes.supplier?.[0] || '';
            const telegramDestin = attributes.notif_telegram_destin?.[0] || '';
            const userCategories: string[] = attributes.categories || [];

            // Determine which list of categories to use
            const categoriesToProcess = userCategories.length > 0 ? userCategories : allCategories;

            // Add logic here if you need to extract other dynamic attributes ('otherKeys' logic from original)
            // Create a row for each category in the determined list
            categoriesToProcess.forEach((category: string) => {
                // Check if category is not empty string before pushing, just in case
                if (category) {
                    const row = [
                        ...baseRowData,
                        tin,
                        notifLang,
                        category, // Single category value
                        supplier,
                        telegramDestin,
                        rolesString, // Add the roles string
                        // Add other extracted attribute values here in the correct order
                    ];
                    rowsToWrite.push(row);
                }
            });
        } // End of for...of loop


        // Initialize Google Sheets client using googleapis
        // Используем GoogleAuth для загрузки учетных данных из файла
        const auth = new GoogleAuth({
            keyFile: path.resolve(__dirname, '../../google.json'), // Путь к файлу google.json
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // Get sheet name from GID (requires fetching spreadsheet details)
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: googleSpreadsheetId,
        });

        const sheet = spreadsheet.data.sheets?.find(s => s.properties?.sheetId === googleSheetGid);

        if (!sheet || !sheet.properties?.title) {
            console.error(`Sheet with GID ${googleSheetGid} not found`);
            process.exit(1);
        }

        const sheetTitle = sheet.properties.title;
        const range = `${sheetTitle}!A1:ZZ`; // Define range starting from A1 to include headers

        // Clear existing content
        await sheets.spreadsheets.values.clear({
            spreadsheetId: googleSpreadsheetId,
            range: range,
        });
        console.log('Cleared existing sheet content.');

        // Write the new data (headers + rows) using update starting from A1
        if (rowsToWrite.length > 1) { // Check if there's more than just the header row
            await sheets.spreadsheets.values.update({
                spreadsheetId: googleSpreadsheetId,
                range: `${sheetTitle}!A1`, // Start writing from A1
                valueInputOption: 'RAW',
                requestBody: {
                    values: rowsToWrite,
                },
            });
            console.log(`Successfully synced ${rowsToWrite.length - 1} user-category rows to Google Sheet.`);
        } else {
            // Optionally write just the headers if no users were found/processed
            await sheets.spreadsheets.values.update({
                spreadsheetId: googleSpreadsheetId,
                range: `${sheetTitle}!A1`, // Write headers to A1
                valueInputOption: 'RAW',
                requestBody: {
                    values: [headers], // Write only the headers array
                },
            });
            console.log('No user data to sync, wrote headers only.');
        }

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('Error during synchronization:', errorMessage);
        process.exit(1);
    }
}

syncKeycloakUsersToSheets();
