import 'dotenv/config';
import { URLSearchParams } from 'url';

async function getAdminToken(): Promise<string> {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const keycloakRealm = process.env.KEYCLOAK_REALM;
    const keycloakAdminUser = process.env.PROD_KEYCLOAK_ADMIN_USER; // Используем PROD_KEYCLOAK_ADMIN_USER
    const keycloakAdminPassword = process.env.PROD_KEYCLOAK_ADMIN_PASSWORD; // Используем PROD_KEYCLOAK_ADMIN_PASSWORD

    if (!keycloakUrl || !keycloakRealm || !keycloakAdminUser || !keycloakAdminPassword) {
        throw new Error('Missing Keycloak environment variables');
    }

    // Для получения админского токена часто используется master Realm
    const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`;

    console.log(`Attempting to get admin token from: ${tokenUrl}`);

    const response = await fetch(tokenUrl, {
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

    if (response.ok) {
        const data = await response.json();
        console.log('Successfully obtained admin token.');
        return data.access_token;
    } else {
        const errorData = await response.text();
        throw new Error(`Failed to get admin token: ${response.status} ${response.statusText} - ${errorData}`);
    }
}

async function getRoleDetails(accessToken: string, roleName: string): Promise<{ id: string; name: string; composite: boolean; clientRole: boolean; containerId: string; defaultRole?: boolean; }> {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const keycloakRealm = process.env.KEYCLOAK_REALM;

    if (!keycloakUrl || !keycloakRealm) {
        throw new Error('Missing Keycloak environment variables');
    }

    const roleUrl = `${keycloakUrl}/admin/realms/${keycloakRealm}/roles/${roleName}`;
    console.log(`Attempting to get details for role "${roleName}" from: ${roleUrl}`);

    const response = await fetch(roleUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (response.ok) {
        const role = await response.json();
        console.log(`Successfully retrieved details for role "${roleName}".`);
        return role;
    } else {
        const errorData = await response.text();
        throw new Error(`Failed to get details for role "${roleName}": ${response.status} ${response.statusText} - ${errorData}`);
    }
}


async function getCompositeRoles(accessToken: string, roleName: string): Promise<Array<{ id: string; name: string; composite: boolean; clientRole: boolean; containerId: string; }>> {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const keycloakRealm = process.env.KEYCLOAK_REALM;

    if (!keycloakUrl || !keycloakRealm) {
        throw new Error('Missing Keycloak environment variables');
    }

    const compositeRolesUrl = `${keycloakUrl}/admin/realms/${keycloakRealm}/roles/${roleName}/composites`;
    console.log(`Attempting to get composite roles for "${roleName}" from: ${compositeRolesUrl}`);

    const response = await fetch(compositeRolesUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (response.ok) {
        const composites = await response.json();
        console.log(`Current composite roles for "${roleName}":`, composites.map((r: { name: string }) => r.name));
        return composites;
    } else {
        const errorData = await response.text();
        throw new Error(`Failed to get composite roles for "${roleName}": ${response.status} ${response.statusText} - ${errorData}`);
    }
}

async function removeRoleFromComposite(accessToken: string, parentRoleName: string, childRoleId: string) {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const keycloakRealm = process.env.KEYCLOAK_REALM;

    if (!keycloakUrl || !keycloakRealm) {
        throw new Error('Missing Keycloak environment variables');
    }

    const removeCompositeUrl = `${keycloakUrl}/admin/realms/${keycloakRealm}/roles/${parentRoleName}/composites`;
    console.log(`Attempting to remove composite role from "${parentRoleName}" at: ${removeCompositeUrl}`);

    const response = await fetch(removeCompositeUrl, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ id: childRoleId }]),
    });

    if (response.ok) {
        console.log(`Successfully removed role with ID ${childRoleId} from composite role "${parentRoleName}".`);
    } else {
        const errorData = await response.text();
        throw new Error(`Failed to remove role from composite "${parentRoleName}": ${response.status} ${response.statusText} - ${errorData}`);
    }
}

async function main() {
    try {
        const accessToken = await getAdminToken();
        console.log('Admin token obtained.');

        // Получаем детали роли default-roles-master
        // Получаем текущие настройки Realm
        const keycloakUrl = process.env.KEYCLOAK_URL;
        const keycloakRealm = process.env.KEYCLOAK_REALM;

        if (!keycloakUrl || !keycloakRealm) {
            throw new Error('Missing Keycloak environment variables');
        }

        const realmSettingsUrl = `${keycloakUrl}/admin/realms/${keycloakRealm}`;
        console.log(`Attempting to get realm settings from: ${realmSettingsUrl}`);
        const realmResponse = await fetch(realmSettingsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!realmResponse.ok) {
            const errorData = await realmResponse.text();
            throw new Error(`Failed to get realm settings: ${realmResponse.status} ${realmResponse.statusText} - ${errorData}`);
        }
        const realmSettings = await realmResponse.json();
        console.log('Successfully retrieved realm settings.');

        // Получаем ID роли contractor
        const contractorDetails = await getRoleDetails(accessToken, 'contractor');
        const contractorRoleId = contractorDetails.id;

        // Обновляем defaultRoles Realm'а
        const currentDefaultRoles = realmSettings.defaultRoles || [];
        const contractorRoleName = contractorDetails.name;

        if (!currentDefaultRoles.includes(contractorRoleName)) {
            console.log(`Adding "${contractorRoleName}" to realm default roles...`);
            currentDefaultRoles.push(contractorRoleName);
            realmSettings.defaultRoles = currentDefaultRoles;

            const updateRealmResponse = await fetch(realmSettingsUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(realmSettings),
            });

            if (updateRealmResponse.ok) {
                console.log(`Successfully added "${contractorRoleName}" to realm default roles.`);
            } else {
                const errorData = await updateRealmResponse.text();
                throw new Error(`Failed to update realm default roles: ${updateRealmResponse.status} ${updateRealmResponse.statusText} - ${errorData}`);
            }
        } else {
            console.log(`Role "${contractorRoleName}" is already in realm default roles. No action needed.`);
        }

        // Проверяем и удаляем default-roles-master из defaultRoles Realm'а, если она там есть
        if (currentDefaultRoles.includes('default-roles-master')) {
            console.log('Role "default-roles-master" found in realm default roles. Attempting to remove...');
            realmSettings.defaultRoles = currentDefaultRoles.filter((role: string) => role !== 'default-roles-master');

            const updateRealmResponse = await fetch(realmSettingsUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(realmSettings),
            });

            if (updateRealmResponse.ok) {
                console.log('Successfully removed "default-roles-master" from realm default roles.');
            } else {
                const errorData = await updateRealmResponse.text();
                throw new Error(`Failed to remove "default-roles-master" from realm default roles: ${updateRealmResponse.status} ${updateRealmResponse.statusText} - ${errorData}`);
            }
        } else {
            console.log('Role "default-roles-master" is not in realm default roles. No action needed.');
        }

        // Проверяем и удаляем contractor из композиции default-roles-master (если это не было сделано ранее)
        const defaultRolesMasterComposites = await getCompositeRoles(accessToken, 'default-roles-master');
        const isContractorInComposites = defaultRolesMasterComposites.some((role: { id: string }) => role.id === contractorRoleId);

        if (isContractorInComposites) {
            console.log('Role "contractor" found in "default-roles-master" composites. Attempting to remove...');
            await removeRoleFromComposite(accessToken, 'default-roles-master', contractorRoleId);
            console.log('Successfully removed "contractor" from "default-roles-master" composites.');
        } else {
            console.log('Role "contractor" is not found in "default-roles-master" composites. No action needed.');
        }

        console.log('Script finished successfully.');

    } catch (error: unknown) {
        console.error('Script failed:', error instanceof Error ? error.message : 'An unknown error occurred');
        process.exit(1);
    }
}

main();