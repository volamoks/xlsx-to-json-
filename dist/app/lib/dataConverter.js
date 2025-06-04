"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processData = exports.parseXLSXData = void 0;
const XLSX = __importStar(require("xlsx"));
const papaparse_1 = __importDefault(require("papaparse"));
const parseXLSXData = (data) => {
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
exports.parseXLSXData = parseXLSXData;
const processData = async (data, sourceType) => {
    try {
        if (sourceType === 'file') {
            const jsonData = (0, exports.parseXLSXData)(data);
            const keycloakJson = convertToKeycloakJson(jsonData);
            return keycloakJson;
        }
        else {
            const parseResult = papaparse_1.default.parse(data, {
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Data processing error:', errorMessage);
        return { error: `Data processing error: ${errorMessage}` };
    }
};
exports.processData = processData;
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
