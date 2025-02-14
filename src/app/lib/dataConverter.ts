import * as XLSX from 'xlsx';
import Papa, { ParseResult } from 'papaparse';

const REALM_NAME = 'your-realm-name';

export interface KeycloakUserImport {
    username: string;
    enabled: boolean;
    emailVerified: boolean;
    email?: string;
    firstName?: string;
    lastName?: string;
    credentials?: { type: string; value: string; temporary: boolean }[];
    requiredActions?: string[];
    realmRoles?: string[];
    clientRoles?: Record<string, string[]>;
    groups?: string[]; // Add groups field
    attributes?: {
        supplier?: string;
        tin?: string;
        business_units?: string;
        notif_teams_destin?: string;
        notif_lang?: string;
        categories?: string;
        notif_telegram_destin?: string;
    };
}

export const parseXLSXData = (data: ArrayBuffer): Record<string, string>[] => {
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

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

    const jsonData = rawData.slice(1).map(row => {
        const item: Record<string, string> = {};
        headers.forEach((header, index) => {
            item[header] = row[index] ? String(row[index]) : '';
        });
        return item;
    });

    console.log('Processed XLSX Data:', jsonData); // Log processed jsonData for debugging
    return jsonData;
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
                newline: '\r\n',
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
        return {
            error: `An unexpected error occurred: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        };
    }
};

const convertToKeycloakJson = (
    data: Record<string, string>[],
): { realm: string; users: KeycloakUserImport[] } => {
    const users = data.map((item: Record<string, string>) => {
        const user: KeycloakUserImport = {
            username: item.username != null ? String(item.username).trim() : '',
            enabled: true,
            emailVerified: true,
            email: item.email != null ? String(item.email).trim() : '',
            firstName: item.firstName != null ? String(item.firstName).trim() : '',
            lastName: item.lastName != null ? String(item.lastName).trim() : '',
            credentials: [
                {
                    type: 'password',
                    value: 'securePassword123',
                    temporary: true,
                },
            ],
            requiredActions: [],
            realmRoles: item.role ? [String(item.role).trim()] : [],
            groups: item.Group ? [String(item.Group).trim()] : [], // Add groups from XLSX
            attributes: {
                supplier: String(item.supplier ?? 'Поставщик').trim(),
                tin: String(item.tin ?? 'SAP-код Поставщика').trim(),
                business_units: String(item.business_units ?? 'Бизнес-единица').trim(),
                notif_teams_destin: String(
                    item.notif_teams_destin ?? '${profile.attributes.notif_teams_destin}',
                ).trim(),
                notif_lang: String(item.notif_lang ?? '${profile.attributes.notif_lang}').trim(),
                categories: String(item.categories ?? 'Категория').trim(),
                notif_telegram_destin: String(item.notif_telegram_destin ?? '').trim(),
            },
        };
        return user;
    });

    return { realm: REALM_NAME, users };
};

// export const transformTableDataToKeycloakJson = (
//   tableData: string[][]
// ): KeycloakUserImport[] => {
//   const headers = [
//     'username',
//     'email',
//     'firstName',
//     'lastName',
//     'supplier',
//     'tin',
//     'business_units',
//     'notif_teams_destin',
//     'notif_lang',
//     'categories',
//     'notif_telegram_destin',
//   ];

//   return tableData.map(row => {
//     const user: KeycloakUserImport = {
//       username: row[headers.indexOf('username')],
//       enabled: true,
//       emailVerified: true,
//       email: row[headers.indexOf('email')],
//       firstName: row[headers.indexOf('firstName')],
//       lastName: row[headers.indexOf('lastName')],
//       credentials: [
//         {
//           type: 'password',
//           value: 'securePassword123',
//           temporary: false,
//         },
//       ],
//       requiredActions: [],
//       attributes: {
//         supplier: row[headers.indexOf('supplier')],
//         tin: row[headers.indexOf('tin')],
//         business_units: row[headers.indexOf('business_units')],
//         notif_teams_destin: row[headers.indexOf('notif_teams_destin')],
//         notif_lang: row[headers.indexOf('notif_lang')],
//         categories: row[headers.indexOf('categories')],
//         notif_telegram_destin: row[headers.indexOf('notif_telegram_destin')],
//       },
//     };
//     return user;
//   });
// };
