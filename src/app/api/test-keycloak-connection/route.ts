import { NextResponse } from 'next/server';

export async function GET() {
  const keycloakUrl = process.env.KEYCLOAK_URL;
  const keycloakRealm = process.env.KEYCLOAK_REALM;
  const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
  const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;

  if (!keycloakUrl || !keycloakRealm || !keycloakAdminUser || !keycloakAdminPassword) {
    return NextResponse.json({ message: 'Missing Keycloak environment variables' }, { status: 400 });
  }

  const tokenUrl = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: keycloakAdminUser,
        password: keycloakAdminPassword,
        // Depending on Keycloak setup, a client_id might be required here
        client_id: 'admin-cli',
      }).toString(),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ message: 'Keycloak connection successful', details: { token_type: data.token_type, expires_in: data.expires_in } });
    } else {
      const errorData = await response.text();
      return NextResponse.json({ message: 'Keycloak connection failed', status: response.status, statusText: response.statusText, error: errorData }, { status: response.status });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ message: 'An error occurred while trying to connect to Keycloak', error: errorMessage }, { status: 500 });
  }
}