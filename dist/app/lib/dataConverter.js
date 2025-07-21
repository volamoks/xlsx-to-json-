import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { queryPostgres } from './postgresClient';
export const parseXLSXData = (data) => {
    if (!data || data.byteLength === 0) {
        throw new Error('Invalid XLSX data: Empty buffer');
    }
    const workbook = XLSX.read(data, { type: 'array' });
    if (!workbook.SheetNames.length) {
        throw new Error('Invalid XLSX file: No sheets found');
    }
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
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
        const item = {};
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
export const processData = async (data, sourceType) => {
    try {
        if (sourceType === 'file') {
            const jsonData = parseXLSXData(data);
            const keycloakJson = convertToKeycloakJson(jsonData);
            return keycloakJson;
        }
        else if (sourceType === 'text') {
            const parseResult = Papa.parse(data, {
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
            const filteredData = parseResult.data.filter((row) => row.username && row.email);
            const keycloakJson = convertToKeycloakJson(filteredData);
            return keycloakJson;
        }
        else if (sourceType === 'postgres') {
            try {
                const { sql } = data;
                const postgresData = await queryPostgres(sql);
                const keycloakJson = convertPostgresToKeycloak(postgresData);
                return keycloakJson;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return { error: `PostgreSQL query error: ${errorMessage}` };
            }
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Data processing error:', errorMessage);
        return { error: `Data processing error: ${errorMessage}` };
    }
};
const convertToKeycloakJson = (data) => {
    const usersMap = new Map();
    data.forEach((item) => {
        var _a, _b, _c, _d, _e;
        const username = item.username.trim();
        if (!username)
            return;
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
        }
        else {
            // Create new user
            const newUser = {
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
                    supplier: ((_a = item.supplier) === null || _a === void 0 ? void 0 : _a.trim()) ? [item.supplier.trim()] : [],
                    tin: ((_b = item.tin) === null || _b === void 0 ? void 0 : _b.trim()) ? [item.tin.trim()] : [],
                    notif_teams_destin: ((_c = item.notif_teams_destin) === null || _c === void 0 ? void 0 : _c.trim()) ? [item.notif_teams_destin.trim()] : [],
                    notif_lang: ((_d = item.notif_lang) === null || _d === void 0 ? void 0 : _d.trim()) ? [item.notif_lang.trim()] : ['1'],
                    categories: categories,
                    notif_telegram_destin: ((_e = item.notif_telegram_destin) === null || _e === void 0 ? void 0 : _e.trim()) ? [item.notif_telegram_destin.trim()] : [],
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
const convertPostgresToKeycloak = (data) => {
    const users = data.map(row => ({
        username: String(row.username || row.email || ''),
        createdTimestamp: Date.now(),
        enabled: true,
        emailVerified: true,
        email: String(row.email || ''),
        firstName: String(row.first_name || row.firstName || ''),
        lastName: String(row.last_name || row.lastName || ''),
        credentials: [
            {
                type: 'password',
                value: 'password123',
                temporary: true,
            },
        ],
        requiredActions: ["UPDATE_PASSWORD"],
        realmRoles: [],
        groups: [],
        attributes: {
            supplier: row.supplier ? [String(row.supplier)] : [],
            tin: row.tin ? [String(row.tin)] : [],
            notif_teams_destin: [],
            notif_lang: ['1'],
            categories: row.categories ? String(row.categories).split(',').map(c => c.trim()) : [],
            notif_telegram_destin: row.telegram_id ? [String(row.telegram_id)] : [],
        },
    }));
    return {
        realm: "cde",
        users: users.filter(u => u.username && u.email),
    };
};
