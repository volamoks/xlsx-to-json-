import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { KeycloakUserRepresentation } from '../app/api/sheets-webhook/route';

// Define __filename and __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });

const keycloakUrl = process.env.KEYCLOAK_URL;
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const targetRealm = 'cde'; // The realm where users will be synchronized

if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword) {
    console.error('Error: Missing Keycloak admin environment variables in .env file');
    process.exit(1);
}

async function removeDefaultMasterRole() {
    try {
        // Obtain admin token from Keycloak
        const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`;
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'password',
                username: keycloakAdminUser!,
                password: keycloakAdminPassword!,
                client_id: 'admin-cli',
            }),
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

        const users: KeycloakUserRepresentation[] = await getUsersResponse.json();
        console.log(`Found ${users.length} users in realm '${targetRealm}'.`);

        for (const user of users) {
            const userId = user.id;

            if (!userId) {
                console.warn('User without id found, skipping');
                continue;
            }
            // Get user's roles
            const getRolesUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users/${userId}/role-mappings/realm`;
            const getRolesResponse = await fetch(getRolesUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!getRolesResponse.ok) {
                console.warn(`Error fetching roles for user ${userId}: ${getRolesResponse.status} - ${getRolesResponse.statusText}`);
                continue;
            }

            const roles: { id: string, name: string }[] = await getRolesResponse.json();

            // Find the default-roles-master role
            const defaultMasterRole = roles.find((role) => role.name === 'default-roles-master');

            if (defaultMasterRole) {
                // Remove the default-roles-master role
                const deleteRolesUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users/${userId}/role-mappings/realm`;
                const deleteRolesResponse = await fetch(deleteRolesUrl, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify([defaultMasterRole]),
                });

                if (!deleteRolesResponse.ok) {
                    console.error(`Error deleting default-roles-master for user ${userId}: ${deleteRolesResponse.status} - ${deleteRolesResponse.statusText}`);
                } else {
                    console.log(`Successfully removed default-roles-master for user ${userId}`);
                }
            } else {
                console.log(`User ${userId} does not have default-roles-master role.`);
            }
        }

        console.log('Script completed.');

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('An error occurred:', errorMessage);
        process.exit(1);
    }
}

removeDefaultMasterRole();
