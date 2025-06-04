import { NextResponse } from 'next/server';

// Define a type for Keycloak user representation
export interface KeycloakUserRepresentation {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  id?: string; // Add id property
  attributes?: {
    [key: string]: string[] | undefined;
  };
  // Add other standard Keycloak user properties as needed
  // emailVerified?: boolean;
  // createdTimestamp?: number;
  // ...
}

export async function POST(request: Request) {
  const keycloakUrl = process.env.KEYCLOAK_URL;
  const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
  const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
  const targetRealm = 'cde'; // The realm where users will be created

  if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword) {
    return NextResponse.json({ message: 'Missing Keycloak admin environment variables' }, { status: 400 });
  }

  try {
    const sheetData = await request.json(); // Assuming data from Google Sheets trigger is in JSON format

    // Extract data based on Google Sheet column headers
    const emailAddress = sheetData['Email Address'];
    const firstName = sheetData['Имя'];
    const lastName = sheetData['Фамилия'];
    const sapTin = sheetData['SAP код Поставщика'];
    const categories = sheetData['Название организации Выберите вашу категорию'];
    const telegramId = sheetData['телеграм id (Не username и не номер телефона) Инструкция'];

    // Use Email Address for both username and email
    const username = emailAddress;
    const email = emailAddress;

    if (!username || !email || !firstName || !lastName) {
      return NextResponse.json({ message: 'Missing required user data in sheet data (Email Address, Имя, Фамилия)' }, { status: 400 });
    }

    // Obtain admin token (similar logic from create-cde-user route)
    const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: keycloakAdminUser,
        password: keycloakAdminPassword,
        client_id: 'admin-cli',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return NextResponse.json({ message: 'Failed to obtain admin token', status: tokenResponse.status, statusText: tokenResponse.statusText, error: errorData }, { status: tokenResponse.status });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Create user in the targetRealm using the accessToken
    const createUserUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users`;

    const userData: KeycloakUserRepresentation = {
      username: username,
      email: email,
      firstName: firstName,
      lastName: lastName,
      enabled: true, // Assuming new users should be enabled
      attributes: {},
    };

    // Add attributes if they exist in the sheet data
    if (sapTin) {
      userData.attributes!.tin = [sapTin]; // Use non-null assertion as attributes is initialized
    }
    if (categories) {
      // Extract numerical values after "КМ" and store in an array
      const categoryValues = categories.match(/КМ(\d+)/g);
      if (categoryValues) {
        userData.attributes!.categories = categoryValues.map((match: string) => match.replace('КМ', ''));
      } else {
        userData.attributes!.categories = []; // Assign an empty array if no matches found
      }
    }
    if (telegramId) {
      userData.attributes!.notif_telegram_destin = [telegramId];
    }

    // Add other attributes like 'supplier' and 'business_units' if they are in your sheet and mapping is provided
    // if (sheetData['Supplier Column Header']) {
    //   userData.attributes!.supplier = [sheetData['Supplier Column Header']];
    // }
    // if (sheetData['Business Units Column Header']) {
    //   userData.attributes!.business_units = [sheetData['Business Units Column Header']];
    // }
    // Add other attributes like 'notif_teams_destin' and 'notif_lang' if they are in your sheet and mapping is provided
    // if (sheetData['Notification Teams Column Header']) {
    //   userData.attributes!.notif_teams_destin = [sheetData['Notification Teams Column Header']];
    // }
    // if (sheetData['Notification Language Column Header']) {
    //   userData.attributes!.notif_lang = [sheetData['Notification Language Column Header']];
    // }


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
      return NextResponse.json({ message: 'User created successfully in Keycloak', userId: userId }, { status: 201 });
    } else {
      const errorData = await createUserResponse.text();
      return NextResponse.json({ message: 'Failed to create user in Keycloak', status: createUserResponse.status, statusText: createUserResponse.statusText, error: errorData }, { status: createUserResponse.status });
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ message: 'An error occurred while processing webhook data', error: errorMessage }, { status: 500 });
  }
}