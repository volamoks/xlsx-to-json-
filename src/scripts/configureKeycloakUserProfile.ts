import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });

const keycloakUrl = process.env.KEYCLOAK_URL;
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN_USER;
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const targetRealm = 'cde'; // The realm to configure

if (!keycloakUrl || !keycloakAdminUser || !keycloakAdminPassword) {
  console.error('Error: Missing Keycloak admin environment variables in .env file');
  process.exit(1);
}

async function configureUserProfile() {
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

    // Define the User Profile configuration payload
    const userProfilePayload = {
      attributes: [
        {
          name: "firstName",
          displayName: "First Name",
          validations: {
            "required": {
              "errorMessage": "First name is required."
            }
          },
          annotations: {
            "localizedDisplayName": {
              "en": "First Name",
              "ru": "Имя"
            }
          }
        },
        {
          name: "lastName",
          displayName: "Last Name",
          validations: {
            "required": {
              "errorMessage": "Last name is required."
            }
          },
          annotations: {
            "localizedDisplayName": {
              "en": "Last Name",
              "ru": "Фамилия"
            }
          }
        }
        // Add other attributes and their translations/validations here
        // Example for a custom attribute 'tin':
        // {
        //   name: "tin",
        //   displayName: "SAP TIN",
        //   validations: {
        //     "required": {
        //       "errorMessage": "SAP TIN is required."
        //     }
        //   },
        //   annotations: {
        //     "localizedDisplayName": {
        //       "en": "SAP TIN",
        //       "ru": "SAP код Поставщика"
        //     }
        //   }
        // }
      ]
    };

    // Send PUT request to update User Profile configuration
    const updateUserProfileUrl = `${keycloakUrl}/admin/realms/${targetRealm}/users/profile`;

    console.log('Updating User Profile configuration...');

    const updateResponse = await fetch(updateUserProfileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userProfilePayload),
    });

    if (updateResponse.ok) {
      console.log('User Profile configuration updated successfully.');
    } else {
      const errorData = await updateResponse.text();
      console.error('Error updating User Profile configuration:', updateResponse.status, updateResponse.statusText, errorData);
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Error during User Profile configuration:', errorMessage);
    process.exit(1);
  }
}

configureUserProfile();