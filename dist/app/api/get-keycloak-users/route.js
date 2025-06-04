"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
async function GET() {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const keycloakRealm = process.env.KEYCLOAK_REALM;
    const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
    const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
    if (!keycloakUrl || !keycloakRealm || !keycloakAdminUser || !keycloakAdminPassword) {
        return server_1.NextResponse.json({ message: 'Missing Keycloak environment variables' }, { status: 400 });
    }
    const tokenUrl = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
    try {
        // Obtain admin token
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'password',
                username: keycloakAdminUser,
                password: keycloakAdminPassword,
                client_id: 'admin-cli', // Assuming 'admin-cli' is the correct client_id for obtaining an admin token
            }).toString(),
        });
        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            return server_1.NextResponse.json({ message: 'Failed to obtain Keycloak admin token', status: tokenResponse.status, statusText: tokenResponse.statusText, error: errorData }, { status: tokenResponse.status });
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        // Fetch users using the admin token
        const usersUrl = `${keycloakUrl}/admin/realms/${keycloakRealm}/users`;
        const usersResponse = await fetch(usersUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            return server_1.NextResponse.json(usersData);
        }
        else {
            const errorData = await usersResponse.text();
            return server_1.NextResponse.json({ message: 'Failed to fetch Keycloak users', status: usersResponse.status, statusText: usersResponse.statusText, error: errorData }, { status: usersResponse.status });
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return server_1.NextResponse.json({ message: 'An error occurred while trying to interact with Keycloak', error: errorMessage }, { status: 500 });
    }
}
