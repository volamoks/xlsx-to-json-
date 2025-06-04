import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Define an interface for the Keycloak user update/create payload
interface KeycloakUserPayload {
    username?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    credentials?: { type: string; value: string; temporary: boolean }[];
    requiredActions?: string[];
    attributes?: {
        [key: string]: string[] | undefined;
    };
    // Roles are handled separately via role-mappings endpoint
}

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });

const keycloakUrl = process.env.KEYCLOAK_URL;
const keycloakAdminUser = process.env.PROD_KEYCLOAK_ADMIN_USER;
const keycloakAdminPassword = process.env.PROD_KEYCLOAK_ADMIN_PASSWORD;
const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const sourceSheetName = 'KeycloakUserEdit';

if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword || !googleSpreadsheetId) {
    console.error('Error: Missing Keycloak or Google Spreadsheet environment variables in .env file');
    process.exit(1);
}

const EXPECTED_HEADERS = [
    'Keycloak ID', 'Username', 'Email', 'First Name', 'Last Name',
    'Enabled', 'Email Verified', 'Created Timestamp', 'Last Login',
    'Roles', 'TIN', 'Supplier', 'Phone Number', 'Categories',
    'Business Units', 'Notification Language', 'Notification Telegram Destination', 'Notification Teams Destination',
    'To Create?', 'To Update?', 'To Delete?'
];

const parseBoolean = (value: string | undefined): boolean | undefined => {
    if (value === undefined || value === null || value.trim() === '') return undefined;
    const lowerVal = value.toLowerCase();
    if (lowerVal === 'true' || lowerVal === 'yes' || lowerVal === '1') return true;
    if (lowerVal === 'false' || lowerVal === 'no' || lowerVal === '0') return false;
    return undefined;
};

const parseCommaSeparatedString = (value: string | undefined): string[] => {
    if (!value || value.trim() === '') return [];
    return value.split(',').map(item => item.trim()).filter(item => item !== '');
};

const formatPhoneNumber = (phoneNumber: string | undefined): string | undefined => {
    if (!phoneNumber || phoneNumber.trim() === '') return undefined;
    const num = phoneNumber.replace(/\s+/g, '').replace(/-/g, ''); // Remove spaces and hyphens

    // If it starts with +998 and is 13 characters long, strip the +
    if (num.startsWith('+998') && num.length === 13) {
        return num.substring(1); // Returns 998XXXXXXXXX
    }
    // If it's just 9 digits, prefix with 998
    if (num.length === 9 && /^\d+$/.test(num)) {
        return `998${num}`; // Returns 998XXXXXXXXX
    }
    // If it's already 998XXXXXXXXX (12 digits), return as is
    if (num.startsWith('998') && num.length === 12) {
        return num;
    }
    // Otherwise, return the original string for Keycloak to validate (or fail)
    // This allows numbers that might already be in the correct format but don't match above conditions,
    // or completely different formats that should fail Keycloak's validation.
    return phoneNumber;
};


async function importUsersFromSheetToKeycloak() {
    const masterRealm = 'master';
    const tokenUrl = `${keycloakUrl}/realms/${masterRealm}/protocol/openid-connect/token`;
    const cdeRealm = 'cde';

    try {
        console.log('Obtaining Keycloak admin token...');
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
        console.log('Admin token obtained successfully.');

        console.log(`Reading data from Google Sheet: "${sourceSheetName}"...`);
        const auth = new GoogleAuth({
            keyFile: path.resolve(__dirname, '../../google.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const sheetDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: googleSpreadsheetId,
            range: `${sourceSheetName}!A:U`,
        });

        const rows = sheetDataResponse.data.values;
        if (!rows || rows.length === 0) {
            console.log('No data found in the sheet.');
            return;
        }

        const headerRow = rows[0];
        if (JSON.stringify(headerRow) !== JSON.stringify(EXPECTED_HEADERS)) {
            console.error('Sheet headers do not match expected headers.');
            console.log('Expected:', EXPECTED_HEADERS);
            console.log('Found:   ', headerRow);
        }

        const usersToProcess = rows.slice(1);
        console.log(`Found ${usersToProcess.length} user rows to process.`);

        for (const row of usersToProcess) {
            const userData: { [key: string]: string } = {};
            headerRow.forEach((header: string, index: number) => {
                userData[header] = row[index];
            });

            const userIdFromSheet = userData['Keycloak ID']?.trim();
            const toCreateFlag = userData['To Create?']?.trim().toLowerCase();
            const toUpdateFlag = userData['To Update?']?.trim().toLowerCase();
            const toDeleteFlag = userData['To Delete?']?.trim().toLowerCase();
            const formattedPhoneNumber = formatPhoneNumber(userData['Phone Number']);


            if (!userIdFromSheet && (toCreateFlag === 'true' || toCreateFlag === 'yes' || toCreateFlag === 'x')) {
                console.log(`Attempting to create new user from row:`, row.slice(0, EXPECTED_HEADERS.indexOf('Roles')));
                const createUserPayload: KeycloakUserPayload = {
                    username: userData['Username']?.trim(),
                    email: userData['Email']?.trim(),
                    firstName: userData['First Name']?.trim(),
                    lastName: userData['Last Name']?.trim(),
                    enabled: parseBoolean(userData['Enabled']) ?? true,
                    emailVerified: parseBoolean(userData['Email Verified']) ?? false,
                    credentials: [{ type: 'password', value: 'Password123!', temporary: true }],
                    requiredActions: ['UPDATE_PASSWORD'],
                    attributes: {},
                };

                if (!createUserPayload.username || !createUserPayload.email) {
                    console.error('Skipping creation: Username and Email are required for new user.', row.slice(0, 3));
                    console.log('--- Next Row ---');
                    continue;
                }

                if (userData['TIN']) createUserPayload.attributes!.tin = [userData['TIN']];
                if (userData['Supplier']) createUserPayload.attributes!.supplier = [userData['Supplier']];
                if (formattedPhoneNumber) createUserPayload.attributes!.phoneNumber = [formattedPhoneNumber];
                if (userData['Notification Language']) createUserPayload.attributes!.notif_lang = [userData['Notification Language']];
                if (userData['Notification Telegram Destination']) createUserPayload.attributes!.notif_telegram_destin = [userData['Notification Telegram Destination']];
                if (userData['Notification Teams Destination']) createUserPayload.attributes!.notif_teams_destin = [userData['Notification Teams Destination']];
                createUserPayload.attributes!.categories = parseCommaSeparatedString(userData['Categories']);
                createUserPayload.attributes!.business_units = parseCommaSeparatedString(userData['Business Units']);

                for (const key in createUserPayload.attributes) {
                    if (Array.isArray(createUserPayload.attributes[key]) && createUserPayload.attributes[key]!.length === 0) {
                        delete createUserPayload.attributes[key];
                    }
                }
                if (Object.keys(createUserPayload.attributes!).length === 0) {
                    delete createUserPayload.attributes;
                }

                const createUserUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users`;
                console.log('Creating new user with payload:', JSON.stringify(createUserPayload, null, 2));
                const createUserResponse = await fetch(createUserUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(createUserPayload),
                });

                if (createUserResponse.ok) {
                    console.log(`Successfully created new user: ${createUserPayload.username}`);
                    const locationHeader = createUserResponse.headers.get('Location');
                    if (locationHeader) {
                        const newUserId = locationHeader.substring(locationHeader.lastIndexOf('/') + 1);
                        console.log(`New user ID: ${newUserId}. Assigning roles...`);
                        const rolesFromSheet = parseCommaSeparatedString(userData['Roles']);
                        const finalRolesToAssign = new Set(rolesFromSheet);
                        finalRolesToAssign.add('default-roles-master');

                        const availableRolesUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/roles`;
                        const availableRolesResponse = await fetch(availableRolesUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                        if (availableRolesResponse.ok) {
                            const availableRoles: Array<{ id: string, name: string }> = await availableRolesResponse.json();
                            const roleRepresentationsToAssign = Array.from(finalRolesToAssign)
                                .map(roleName => availableRoles.find(r => r.name === roleName))
                                .filter(r => r !== undefined) as Array<{ id: string, name: string }>;

                            if (roleRepresentationsToAssign.length > 0) {
                                const assignRolesUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${newUserId}/role-mappings/realm`;
                                const assignRolesResponse = await fetch(assignRolesUrl, {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(roleRepresentationsToAssign),
                                });
                                if (assignRolesResponse.ok) console.log(`Successfully assigned roles to new user ${newUserId}.`);
                                else console.error(`Failed to assign roles to new user ${newUserId}: ${await assignRolesResponse.text()}`);
                            }
                        } else console.error(`Failed to fetch available roles for new user ${newUserId}. Roles not assigned.`);
                    } else console.warn(`Could not determine new user ID for ${createUserPayload.username}. Roles not assigned.`);
                } else console.error(`Failed to create new user ${createUserPayload.username}: ${createUserResponse.status} - ${await createUserResponse.text()}`);
                console.log('--- Next Row ---');
                continue;
            }

            if (!userIdFromSheet) {
                console.warn('Skipping row: Keycloak ID is missing and not marked for creation.', row.slice(0, 3));
                console.log('--- Next Row ---');
                continue;
            }

            console.log(`Processing user ID: ${userIdFromSheet}`);

            if (toDeleteFlag === 'true' || toDeleteFlag === 'yes' || toDeleteFlag === 'x') {
                console.log(`User ${userIdFromSheet} marked for deletion.`);
                const deleteUserUrlEndpoint = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${userIdFromSheet}`;
                const deleteResponse = await fetch(deleteUserUrlEndpoint, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                if (deleteResponse.ok) console.log(`Successfully deleted user ${userIdFromSheet}.`);
                else console.error(`Failed to delete user ${userIdFromSheet}: ${deleteResponse.status} - ${await deleteResponse.text()}`);
                console.log('--- Next Row ---');
                continue;
            }

            if (!(toUpdateFlag === 'true' || toUpdateFlag === 'yes' || toUpdateFlag === 'x')) {
                console.log(`User ${userIdFromSheet} not explicitly marked for update (To Update? is '${userData['To Update?'] || ''}'). Skipping update.`);
                console.log('--- Next Row ---');
                continue;
            }

            console.log(`User ${userIdFromSheet} explicitly marked for update. Proceeding...`);
            const updateUserPayload: KeycloakUserPayload = {
                email: userData['Email'] !== undefined ? userData['Email'] : undefined,
                firstName: userData['First Name'] !== undefined ? userData['First Name'] : undefined,
                lastName: userData['Last Name'] !== undefined ? userData['Last Name'] : undefined,
                enabled: parseBoolean(userData['Enabled']),
                emailVerified: parseBoolean(userData['Email Verified']),
                attributes: {},
            };

            if (userData['TIN']) updateUserPayload.attributes!.tin = [userData['TIN']];
            if (userData['Supplier']) updateUserPayload.attributes!.supplier = [userData['Supplier']];
            if (formattedPhoneNumber) updateUserPayload.attributes!.phoneNumber = [formattedPhoneNumber];
            if (userData['Notification Language']) updateUserPayload.attributes!.notif_lang = [userData['Notification Language']];
            if (userData['Notification Telegram Destination']) updateUserPayload.attributes!.notif_telegram_destin = [userData['Notification Telegram Destination']];
            if (userData['Notification Teams Destination']) updateUserPayload.attributes!.notif_teams_destin = [userData['Notification Teams Destination']];
            updateUserPayload.attributes!.categories = parseCommaSeparatedString(userData['Categories']);
            updateUserPayload.attributes!.business_units = parseCommaSeparatedString(userData['Business Units']);

            for (const key in updateUserPayload.attributes) {
                if (Array.isArray(updateUserPayload.attributes[key]) && updateUserPayload.attributes[key]!.length === 0) {
                    delete updateUserPayload.attributes[key];
                }
            }
            if (Object.keys(updateUserPayload.attributes!).length === 0) {
                delete updateUserPayload.attributes;
            }

            const updateUserUrlEndpoint = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${userIdFromSheet}`;
            console.log(`Updating user ${userIdFromSheet} with payload:`, JSON.stringify(updateUserPayload, null, 2));
            const updateUserResponse = await fetch(updateUserUrlEndpoint, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(updateUserPayload),
            });

            if (updateUserResponse.ok) console.log(`Successfully updated user ${userIdFromSheet}.`);
            else console.error(`Failed to update user ${userIdFromSheet}: ${updateUserResponse.status} - ${await updateUserResponse.text()}`);

            const rolesFromSheet = parseCommaSeparatedString(userData['Roles']);
            const finalRolesToAssign = new Set(rolesFromSheet);
            finalRolesToAssign.add('default-roles-master');

            const availableRolesUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/roles`;
            const availableRolesResponse = await fetch(availableRolesUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });

            if (!availableRolesResponse.ok) {
                console.error(`Failed to fetch available realm roles for user ${userIdFromSheet}. Skipping role update.`);
            } else {
                const availableRoles: Array<{ id: string, name: string }> = await availableRolesResponse.json();
                const roleRepresentationsToAssign = Array.from(finalRolesToAssign)
                    .map(roleName => availableRoles.find(r => r.name === roleName))
                    .filter(r => r !== undefined) as Array<{ id: string, name: string }>;

                if (!roleRepresentationsToAssign.some(r => r.name === 'default-roles-master') && !availableRoles.find(r => r.name === 'default-roles-master')) {
                    console.warn(`User ${userIdFromSheet}: 'default-roles-master' not found in realm. Cannot add it by default.`);
                }

                if (roleRepresentationsToAssign.length > 0) {
                    const setRolesUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users/${userIdFromSheet}/role-mappings/realm`;
                    console.log(`Setting roles for user ${userIdFromSheet}:`, JSON.stringify(roleRepresentationsToAssign.map(r => ({ id: r.id, name: r.name })), null, 2));

                    const currentRolesResponse = await fetch(setRolesUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                    let currentRoleObjects: Array<{ id: string, name: string }> = [];
                    if (currentRolesResponse.ok) currentRoleObjects = await currentRolesResponse.json();

                    if (currentRoleObjects.length > 0) {
                        const removeRolesResponse = await fetch(setRolesUrl, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify(currentRoleObjects),
                        });
                        if (!removeRolesResponse.ok) console.error(`Failed to remove current roles for user ${userIdFromSheet}: ${await removeRolesResponse.text()}`);
                        else console.log(`Removed current roles for user ${userIdFromSheet}.`);
                    }

                    const addRolesResponse = await fetch(setRolesUrl, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(roleRepresentationsToAssign),
                    });
                    if (addRolesResponse.ok) console.log(`Successfully set roles for user ${userIdFromSheet}.`);
                    else console.error(`Failed to set roles for user ${userIdFromSheet}: ${await addRolesResponse.text()}`);
                } else if (finalRolesToAssign.size > 0) {
                    console.log(`No valid role representations found to assign for user ${userIdFromSheet} from roles: ${Array.from(finalRolesToAssign).join(', ')}`);
                }
            }
            console.log('--- Next Row ---');
        }
        console.log('Finished processing all users from the sheet.');

        console.log('Automatically re-exporting sheet to reflect changes...');
        const exportScriptPath = path.resolve(__dirname, './exportUsersToKeycloakUserEditSheet.ts');
        const { exec } = await import('child_process');
        const util = await import('util');
        const execPromise = util.promisify(exec);
        try {
            const { stdout: exportStdout, stderr: exportStderr } = await execPromise(`node --loader ts-node/esm ${exportScriptPath}`);
            console.log('Re-export stdout:', exportStdout);
            if (exportStderr) console.error('Re-export stderr:', exportStderr);
            console.log('Sheet automatically re-exported successfully.');
        } catch (reExportError) {
            console.error('Error during automatic re-export:', reExportError);
        }

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('Error during import from sheet to Keycloak:', errorMessage);
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

importUsersFromSheetToKeycloak();
