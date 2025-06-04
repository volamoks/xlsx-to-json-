"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
async function POST(request) {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
    const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
    const targetRealm = 'cde'; // The realm where users will be created
    if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword) {
        return server_1.NextResponse.json({ message: 'Missing Keycloak admin environment variables' }, { status: 400 });
    }
    const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`; // Get token from master realm with admin credentials
    try {
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'password',
                username: keycloakAdminUser,
                password: keycloakAdminPassword,
                client_id: 'admin-cli', // Use admin-cli client
            }).toString(),
        });
        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            return server_1.NextResponse.json({ message: 'Failed to obtain admin token', status: tokenResponse.status, statusText: tokenResponse.statusText, error: errorData }, { status: tokenResponse.status });
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        const userData = await request.json(); // Assuming user data is sent in the request body
        const createUserUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users`;
        try {
            const createUserResponse = await fetch(createUserUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData),
            });
            if (createUserResponse.status === 201) {
                // User created successfully. Keycloak typically returns a Location header with the user's ID.
                const location = createUserResponse.headers.get('Location');
                const userId = location ? location.substring(location.lastIndexOf('/') + 1) : 'unknown';
                return server_1.NextResponse.json({ message: 'User created successfully', userId: userId }, { status: 201 });
            }
            else {
                const errorData = await createUserResponse.text();
                return server_1.NextResponse.json({ message: 'Failed to create user in Keycloak', status: createUserResponse.status, statusText: createUserResponse.statusText, error: errorData }, { status: createUserResponse.status });
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            return server_1.NextResponse.json({ message: 'An error occurred while trying to create user', error: errorMessage }, { status: 500 });
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return server_1.NextResponse.json({ message: 'An error occurred while obtaining admin token', error: errorMessage }, { status: 500 });
    }
}
