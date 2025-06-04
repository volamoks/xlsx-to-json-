import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

export async function GET() {
  const keycloakUrl = process.env.KEYCLOAK_URL;
  const keycloakRealm = 'cde'; // Use 'cde' realm as requested
  const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
  const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
  const googleSpreadsheetId = '1AF333V-HnymvXl4F1k4Vsqa8j7s9BnR5uV-D4MqTqS4'; // Updated Spreadsheet ID
  const googleSheetGid = 1663998069; // New Sheet GID
  const googleServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!keycloakUrl || !keycloakRealm || !keycloakAdminUser || !keycloakAdminPassword) {
    return NextResponse.json({ message: 'Missing Keycloak environment variables' }, { status: 400 });
  }

  if (!googleSpreadsheetId || !googleSheetGid || !googleServiceAccountEmail || !googlePrivateKey) {
    return NextResponse.json({ message: 'Missing Google Sheets environment variables' }, { status: 400 });
  }

  const masterRealm = process.env.KEYCLOAK_REALM || 'master'; // Get master realm from env or default
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
        username: keycloakAdminUser,
        password: keycloakAdminPassword,
        client_id: 'admin-cli', // Assuming 'admin-cli' is the correct client_id for obtaining an admin token
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return NextResponse.json({ message: 'Failed to obtain Keycloak admin token', status: tokenResponse.status, statusText: tokenResponse.statusText, error: errorData }, { status: tokenResponse.status });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Fetch users from Keycloak
    const cdeRealm = 'cde'; // Target realm for fetching users
    const usersUrl = `${keycloakUrl}/admin/realms/${cdeRealm}/users`; // Fetch users from cde realm
    const usersResponse = await fetch(usersUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!usersResponse.ok) {
      const errorData = await usersResponse.text();
      return NextResponse.json({ message: 'Failed to fetch Keycloak users', status: usersResponse.status, statusText: usersResponse.statusText, error: errorData }, { status: usersResponse.status });
    }

    const usersData = await usersResponse.json();

    // Initialize Google Sheets client using googleapis
    const auth = new JWT({
      email: googleServiceAccountEmail,
      key: googlePrivateKey.replace(/\\n/g, '\n'), // Replace escaped newlines
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get sheet name from GID (requires fetching spreadsheet details)
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: googleSpreadsheetId,
    });

    const sheet = spreadsheet.data.sheets?.find(s => s.properties?.sheetId === googleSheetGid);

    if (!sheet || !sheet.properties?.title) {
      return NextResponse.json({ message: `Sheet with GID ${googleSheetGid} not found` }, { status: 404 });
    }

    const sheetTitle = sheet.properties.title;
    const range = `${sheetTitle}!A:ZZ`; // Define a broad range to clear and append

    // Clear existing content
    await sheets.spreadsheets.values.clear({
      spreadsheetId: googleSpreadsheetId,
      range: range,
    });

    // Prepare data for writing - extract all fields dynamically
    const rows = usersData.map((user: any) => {
      const row: any[] = [];

      // Add common top-level fields
      row.push(user.id || '');
      row.push(user.username || '');
      row.push(user.email || '');
      row.push(user.firstName || '');
      row.push(user.lastName || '');
      row.push(user.enabled !== undefined ? user.enabled : '');
      row.push(user.emailVerified !== undefined ? user.emailVerified : '');
      row.push(user.createdTimestamp ? new Date(user.createdTimestamp).toISOString() : '');
      row.push(user.lastLogin ? new Date(user.lastLogin).toISOString() : '');

      // Extract specific fields from attributes
      const attributes = user.attributes || {};
      const requestedAttributes = ['tin', 'notif_lang', 'categories', 'supplier', 'notif_telegram_destin'];

      requestedAttributes.forEach(attrKey => {
        const value = attributes[attrKey];
        if (Array.isArray(value)) {
          row.push(value.join(', ')); // Join array values with comma
        } else if (value !== undefined) {
          row.push(value);
        } else {
          row.push(''); // Add empty string if attribute is missing
        }
      });

      // Add other top-level fields that were not explicitly added, excluding 'attributes'
      const otherKeys = Object.keys(user).filter(key =>
        ![
          'id', 'username', 'email', 'firstName', 'lastName', 'enabled',
          'emailVerified', 'createdTimestamp', 'lastLogin', 'attributes',
          'groups', 'realmRoles', 'clientRoles' // Exclude complex objects for simplicity, can be added if needed
        ].includes(key) && typeof user[key] !== 'object' && !Array.isArray(user[key])
      );

      otherKeys.forEach(key => {
        row.push(user[key] !== undefined ? user[key] : '');
      });


      return row;
    });

    // Add user data rows starting from the second row (row index 1)
    // We need to append starting from row 2 (A2) since row 1 is for headers.
    // The append method adds data after the last row with data.
    // Since we cleared, the sheet is empty. Appending to A2 will start writing from A2.
    if (rows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: googleSpreadsheetId,
        range: `${sheetTitle}!A2`, // Start appending from A2
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows,
        },
      });
    }

    return NextResponse.json({ message: 'Keycloak users successfully synced to Google Sheet' });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ message: 'An error occurred while trying to sync users to Google Sheets', error: errorMessage }, { status: 500 });
  }
}