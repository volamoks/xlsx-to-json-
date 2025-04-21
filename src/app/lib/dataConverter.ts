import * as XLSX from 'xlsx';
import Papa, { ParseResult } from 'papaparse';

export interface KeycloakUserImport {
    username: string;
    createdTimestamp?: number;
    enabled: boolean;
    emailVerified: boolean;
    email: string; // Made required
    firstName: string; // Made required
    lastName: string; // Made required
    credentials: { type: string; value: string; temporary: boolean }[];
    requiredActions: string[];
    realmRoles: string[];
    clientRoles?: Record<string, string[]>;
    groups: string[]; // Made required
    attributes: {
        supplier: string[];
        tin: string[];
        notif_teams_destin: string[];
        notif_lang: string[];
        categories: string[];
        notif_telegram_destin: string[];
    };
}

export const parseXLSXData = (data: ArrayBuffer): Record<string, string>[] => {
    if (!data || data.byteLength === 0) {
        throw new Error('Invalid XLSX data: Empty buffer');
    }

    const workbook = XLSX.read(data, { type: 'array' });
    if (!workbook.SheetNames.length) {
        throw new Error('Invalid XLSX file: No sheets found');
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (rawData.length < 2) {
        throw new Error('Invalid XLSX file: No data rows found');
    }

    const headers = [
        'username',
        'email',
        'firstName',
        'lastName',
        'supplier',
        'tin',
        'business_units',
        'notif_teams_destin',
        'notif_lang',
        'categories',
        'notif_telegram_destin',
        'Group',
        'role',
    ];

    return rawData.slice(1).map((row, idx) => {
        const item: Record<string, string> = {};
        headers.forEach((header, index) => {
            const value = row[index];
            item[header] = value != null ? String(value).trim() : '';
        });

        // Validate required fields
        if (!item.username || !item.email) {
            throw new Error(`Row ${idx + 2}: Username and email are required`);
        }

        return item;
    });
};

export const processData = async (
    data: ArrayBuffer | string,
    sourceType: 'file' | 'text',
): Promise<{ realm: string; users: KeycloakUserImport[] } | { error: string }> => {
    try {
        if (sourceType === 'file') {
            const jsonData = parseXLSXData(data as ArrayBuffer);
            const keycloakJson = convertToKeycloakJson(jsonData);
            return keycloakJson;
        } else {
            const parseResult: ParseResult<Record<string, string>> = Papa.parse(data as string, {
                header: true,
                delimiter: '\t',
                quoteChar: '"',
                skipEmptyLines: true,
                newline: '\r',
            });

            if (!parseResult) {
                return {
                    error: 'Error during data parsing: Papa.parse returned undefined.',
                };
            }
            if (parseResult.errors && parseResult.errors.length > 0) {
                return {
                    error: `Error parsing text data: ${parseResult.errors[0].message}`,
                };
            }
            if (!parseResult.data) {
                return { error: 'Error: Parsed data is undefined.' };
            }
            // Filter out rows where required fields are empty
            const filteredData = parseResult.data.filter(
                (row: Record<string, string>) => row.username && row.email,
            );
            const keycloakJson = convertToKeycloakJson(filteredData);
            return keycloakJson;
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Data processing error:', errorMessage);
        return { error: `Data processing error: ${errorMessage}` };
    }
};

const convertToKeycloakJson = (
    data: Record<string, string>[],
): { realm: string; users: KeycloakUserImport[] } => {
    const usersMap = new Map<string, KeycloakUserImport>();

    data.forEach((item: Record<string, string>) => {
        const username = item.username.trim();
        if (!username) return;

        const existingUser = usersMap.get(username);
        const categories = item.categories
            ? item.categories
                .split(',')
                .map(cat => cat.trim())
                .filter(cat => cat)
            : [];

        if (existingUser) {
            // Merge categories for existing user
            const existingCategories = existingUser.attributes.categories || [];

            existingUser.attributes.categories = [
                ...new Set([...existingCategories, ...categories]),
            ];

            // Merge roles and groups if present
            if (item.role) {
                existingUser.realmRoles = [
                    ...new Set([...existingUser.realmRoles, item.role.trim()]),
                ];
            }
            if (item.Group) {
                existingUser.groups = [...new Set([...existingUser.groups, item.Group.trim()])];
            }
        } else {
            // Create new user
            const newUser: KeycloakUserImport = {
                username,
                createdTimestamp: Date.now(),
                enabled: true,
                emailVerified: true,
                email: item.email.trim(),
                firstName: item.firstName.trim(),
                lastName: item.lastName.trim(),
                credentials: [
                    {
                        type: 'password',
                        value: 'password123',
                        temporary: true,
                    },
                ],
                requiredActions: ["UPDATE_PASSWORD"], // Mandatory password reset on first login
                // CONFIGURE_TOTP is not added here as it was requested to be optional,
                // and this import process doesn't support per-user optional actions.
                // OTP can be configured by users within Keycloak after import.
                realmRoles: item.role ? [item.role.trim()] : [],
                groups: item.Group ? [item.Group.trim()] : [],
                attributes: {
                    supplier: item.supplier?.trim() ? [item.supplier.trim()] : [],
                    tin: item.tin?.trim() ? [item.tin.trim()] : [],
                    notif_teams_destin: item.notif_teams_destin?.trim() ? [item.notif_teams_destin.trim()] : [],
                    notif_lang: item.notif_lang?.trim() ? [item.notif_lang.trim()] : ['1'],
                    categories: categories,
                    notif_telegram_destin: item.notif_telegram_destin?.trim() ? [item.notif_telegram_destin.trim()] : [],
                },
            };
            usersMap.set(username, newUser);
        }
    });

    return {
        realm: "cde",
        users: Array.from(usersMap.values()),
    };
};
