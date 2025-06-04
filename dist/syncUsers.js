import { google } from 'googleapis';
import { config } from 'dotenv';
import path from 'path';
// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const keycloakUrl = process.env.KEYCLOAK_URL;
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const targetRealm = 'cde'; // The realm where users will be synchronized
if (!spreadsheetId) {
    console.error('Error: GOOGLE_SPREADSHEET_ID is not defined in .env file');
    process.exit(1);
}
if (!credentialsPath) {
    console.error('Error: GOOGLE_APPLICATION_CREDENTIALS is not defined in .env file');
    process.exit(1);
}
if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword) {
    console.error('Error: Missing Keycloak admin environment variables in .env file');
    process.exit(1);
}
async function syncUsers() {
    try {
        // Authenticate with Google Sheets API
        const auth = new google.auth.GoogleAuth({
            keyFile: path.resolve(__dirname, `../../${credentialsPath}`),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        // Read data from Google Sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'A1:ZZ1000', // Adjust the range as needed
        });
        const values = response.data.values;
        if (!values || values.length === 0) {
            console.log('No data found in the spreadsheet.');
            return;
        }
        const headers = values[0];
        const sheetDataRows = values.slice(1);
        console.log(`Found ${sheetDataRows.length} rows in the spreadsheet.`);
        // Obtain admin token from Keycloak
        const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`;
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'password',
                username: keycloakAdminUser, // Use non-null assertion
                password: keycloakAdminPassword, // Use non-null assertion
                client_id: 'admin-cli',
            }).toString(),
        });
        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error('Error obtaining admin token:', tokenResponse.status, tokenResponse.statusText, errorData);
            process.exit(1);
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        console.log('Admin token obtained successfully.');
        // Fetch existing users from Keycloak 'cde' realm
        const getUsersUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users?max=1000`; // Fetch up to 1000 users
        const getUsersResponse = await fetch(getUsersUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!getUsersResponse.ok) {
            const errorData = await getUsersResponse.text();
            console.error('Error fetching Keycloak users:', getUsersResponse.status, getUsersResponse.statusText, errorData);
            process.exit(1);
        }
        const existingKeycloakUsers = await getUsersResponse.json();
        console.log(`Found ${existingKeycloakUsers.length} existing Keycloak users in realm '${targetRealm}'.`);
        // Create a map of existing Keycloak users for easier lookup (e.g., by email)
        const keycloakUsersByEmail = new Map();
        existingKeycloakUsers.forEach(user => {
            if (user.email) {
                keycloakUsersByEmail.set(user.email, user);
            }
        });
        console.log('Starting synchronization...');
        for (const row of sheetDataRows) {
            // Map sheet row data to an object using headers
            const sheetRowData = {};
            headers.forEach((header, index) => {
                if (typeof header === 'string') {
                    sheetRowData[header] = row[index] || '';
                }
            });
            // Extract data based on Google Sheet column headers and mapping
            const emailAddress = sheetRowData['Email Address'];
            const firstName = sheetRowData['Имя'];
            const lastName = sheetRowData['Фамилия'];
            const sapTin = sheetRowData['SAP код Поставщика'];
            const categories = sheetRowData['Название организации Выберите вашу категорию'];
            const telegramId = sheetRowData['телеграм id (Не username и не номер телефона) Инструкция'];
            // Use Email Address for both username and email
            const username = emailAddress;
            const email = emailAddress;
            if (!username || !email || !firstName || !lastName) {
                console.warn('Skipping row due to missing required data:', sheetRowData);
                continue; // Skip rows with missing required data
            }
            // Prepare user data for Keycloak
            const userData = {
                username: username,
                email: email,
                firstName: firstName,
                lastName: lastName,
                enabled: true, // Assuming users from sheet should be enabled
                attributes: {},
            };
            // Add attributes if they exist in the sheet data
            if (sapTin) {
                userData.attributes.tin = [sapTin];
            }
            if (categories) {
                // Extract numerical values after "КМ" and store in an array
                const categoryValues = categories.match(/КМ(\d+)/g);
                if (categoryValues) {
                    userData.attributes.categories = categoryValues.map((match) => match.replace('КМ', ''));
                }
                else {
                    userData.attributes.categories = [];
                }
            }
            if (telegramId) {
                userData.attributes.notif_telegram_destin = [telegramId];
            }
            // TODO: Add logic for other attributes like 'supplier' and 'business_units' if needed
            // Check if user already exists in Keycloak (using email as the identifier for lookup)
            const existingUser = keycloakUsersByEmail.get(email);
            if (existingUser) {
                // User exists, perform update
                console.log(`Updating user with email: ${email}`);
                const updateUsersUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users/${existingUser.id}`; // Assuming existingUser has an 'id' property
                const updateUserResponse = await fetch(updateUsersUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(userData),
                });
                if (!updateUserResponse.ok) {
                    const errorData = await updateUserResponse.text();
                    console.error(`Error updating user ${email}:`, updateUserResponse.status, updateUserResponse.statusText, errorData);
                }
                else {
                    console.log(`User updated successfully: ${email}`);
                }
            }
            else {
                // User does not exist, perform creation
                console.log(`Creating user with email: ${email}`);
                const createUserUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users`;
                const createUserResponse = await fetch(createUserUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(userData),
                });
                if (createUserResponse.status === 201) {
                    const location = createUserResponse.headers.get('Location');
                    const userId = location ? location.substring(location.lastIndexOf('/') + 1) : 'unknown';
                    console.log(`User created successfully: ${email} (ID: ${userId})`);
                }
                else {
                    const errorData = await createUserResponse.text();
                    console.error(`Error creating user ${email}:`, createUserResponse.status, createUserResponse.statusText, errorData);
                }
            }
        }
        console.log('Synchronization process finished.');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('Error during synchronization:', errorMessage);
        process.exit(1);
    }
}
syncUsers();
