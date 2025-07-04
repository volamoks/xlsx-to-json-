import { Client, FieldDef, QueryResult } from 'pg';
import { ClientSecretCredential } from '@azure/identity';
import { Client as GraphClient } from '@microsoft/microsoft-graph-client';
import { WorkbookTable, WorkbookRange } from 'microsoft-graph'; // Changed import source
import 'isomorphic-fetch'; // Required for Microsoft Graph client
import dotenv from 'dotenv';

dotenv.config();

const DB_QUERY = process.env.DB_SHAREPOINT_QUERY || "SELECT * FROM product_requests"; // Or your specific query

interface AppConfig {
    dbHost?: string;
    dbName?: string;
    dbUser?: string;
    dbPassword?: string;
    dbPort: number;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    userIdOrSiteId?: string; // User ID for OneDrive or Site ID for SharePoint
    driveItemId?: string;    // Excel file ID
    worksheetName: string;
    tableName: string;
    batchSize: number;
    isSharePointSite: boolean; // True if file is on SharePoint site, false if OneDrive
}

class ConfigManager {
    public config: AppConfig;

    constructor() {
        this.config = {
            dbHost: process.env.DB_HOST,
            dbName: process.env.DB_NAME,
            dbUser: process.env.DB_USER,
            dbPassword: process.env.DB_PASSWORD,
            dbPort: parseInt(process.env.DB_PORT || '5432', 10),
            tenantId: process.env.TENANT_ID,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            userIdOrSiteId: process.env.USER_ID_OR_SITE_ID, // IMPORTANT: User needs to provide this
            driveItemId: process.env.DRIVE_ITEM_ID,       // IMPORTANT: User needs to provide this
            worksheetName: process.env.WORKSHEET_NAME || 'Sheet1',
            tableName: process.env.TABLE_NAME || 'Table1',
            batchSize: parseInt(process.env.BATCH_SIZE || '100', 10),
            isSharePointSite: process.env.IS_SHAREPOINT_SITE === 'true' // IMPORTANT: User needs to clarify
        };
        this.validate();
    }

    private validate(): void {
        const requiredServerVars = [
            this.config.dbHost, this.config.dbName, this.config.dbUser, this.config.dbPassword,
            this.config.tenantId, this.config.clientId, this.config.clientSecret,
            this.config.userIdOrSiteId, this.config.driveItemId
        ];
        if (requiredServerVars.some(v => !v)) {
            console.error("Missing critical environment variables for DB or SharePoint export.");
            // Consider throwing an error or handling this more gracefully
            // For now, we'll log and let it potentially fail later to highlight missing vars.
        }
        if (!this.config.clientSecret) {
            console.warn("CLIENT_SECRET is not set. Authentication will likely fail.");
        }
    }
}

async function getDbConnection(config: AppConfig): Promise<Client | null> {
    console.info("Attempting to connect to the database");
    const client = new Client({
        host: config.dbHost,
        database: config.dbName,
        user: config.dbUser,
        password: config.dbPassword,
        port: config.dbPort,
        connectionTimeoutMillis: 10000,
    });
    try {
        await client.connect();
        console.info("Database connection established successfully");
        return client;
    } catch (error) {
        console.error("Database connection error:", error);
        return null;
    }
}

async function extractData(client: Client, query: string, limit: number = 1000): Promise<{ columns: string[], data: any[][] }> {
    console.info(`Extracting data with limit ${limit} rows`);
    console.info(`Full SQL query:\n${query}`);
    try {
        let finalQuery = query;
        if (!query.toUpperCase().includes('LIMIT')) {
            finalQuery = `${query} LIMIT ${limit}`;
        }
        console.debug(`Executing query:\n${finalQuery}`);
        const res: QueryResult<Record<string, any>> = await client.query(finalQuery);
        
        const columns: string[] = res.fields.map((field: FieldDef) => field.name);
        // ESLint might be strict about Record<string, any>. If errors persist here,
        // it might be due to rules like @typescript-eslint/no-explicit-any.
        const data: any[][] = res.rows.map((row: Record<string, any>) => 
            columns.map((col: string) => row[col])
        );

        if (data.length > 0) {
            console.info(`Extracted ${data.length} rows with ${columns.length} columns`);
            const sampleRows = Math.min(5, data.length);
            console.info(`First ${sampleRows} rows of result:`);
            for (let i = 0; i < sampleRows; i++) {
                console.info(`Row ${i + 1}: ${JSON.stringify(data[i])}`);
            }
        } else {
            console.warn("Query returned no data.");
        }
        return { columns, data };
    } catch (error) {
        console.error("Error extracting data:", error);
        throw error;
    }
}

function getGraphClient(config: AppConfig): GraphClient | null {
    console.info("Attempting to authenticate with Microsoft Graph API");
    if (!config.tenantId || !config.clientId || !config.clientSecret) {
        console.error("Missing Azure AD credentials (TENANT_ID, CLIENT_ID, CLIENT_SECRET)");
        return null;
    }
    try {
        const credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
        const client = GraphClient.initWithMiddleware({
            authProvider: {
                getAccessToken: async () => {
                    const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default');
                    if (!tokenResponse || !tokenResponse.token) {
                        throw new Error("Failed to acquire token");
                    }
                    return tokenResponse.token;
                }
            }
        });
        console.info("Microsoft Graph API client created successfully.");
        return client;
    } catch (error) {
        console.error("Error authenticating with Microsoft Graph API:", error);
        return null;
    }
}

function getWorkbookTablePath(config: AppConfig, tableId?: string): string {
    const baseDrivePath = config.isSharePointSite
        ? `/sites/${config.userIdOrSiteId}/drive/items/${config.driveItemId}`
        : `/users/${config.userIdOrSiteId}/drive/items/${config.driveItemId}`;
    
    let path = `${baseDrivePath}/workbook/worksheets('${config.worksheetName}')/tables`;
    if (tableId) {
        path += `/${tableId}`;
    } else {
        path += `('${config.tableName}')`;
    }
    return path;
}


async function loadToExcelOnline(graphClient: GraphClient, config: AppConfig, columns: string[], data: any[][]): Promise<void> {
    if (!config.userIdOrSiteId || !config.driveItemId) {
        console.error("USER_ID_OR_SITE_ID or DRIVE_ITEM_ID is not configured.");
        throw new Error("USER_ID_OR_SITE_ID or DRIVE_ITEM_ID is not configured.");
    }
    console.info(`Starting upload of ${data.length} rows to Excel Online: Item ID ${config.driveItemId}, Worksheet: ${config.worksheetName}, Table: ${config.tableName}`);

    let table: WorkbookTable | null = null;
    const tablePath = getWorkbookTablePath(config);

    try {
        table = await graphClient.api(tablePath).get() as WorkbookTable;
        console.info(`Table '${config.tableName}' found.`);
    } catch (error: unknown) {
        const graphError = error as { statusCode?: number; message?: string; }; // Added semicolon for consistency
        if (graphError.statusCode === 404) {
            console.warn(`Table '${config.tableName}' not found. Attempting to create it. Error: ${graphError.message || String(error)}`);
            const columnCount = columns.length;
            if (columnCount === 0 && data.length === 0) {
                 console.warn("No columns and no data, cannot determine table range. Skipping table creation.");
                 return;
            }
            const lastColumnLetter = String.fromCharCode('A'.charCodeAt(0) + Math.max(0, columnCount -1));
            const rangeAddress = `A1:${lastColumnLetter}${data.length + 1}`;

            const createTablePayload = {
                address: rangeAddress,
                hasHeaders: true,
                name: config.tableName, // Ensure this is unique if creating
            };
            try {
                const newTablePath = getWorkbookTablePath(config).replace(`('${config.tableName}')`, '');
                table = await graphClient.api(newTablePath).post(createTablePayload) as WorkbookTable;
                console.info(`Table '${config.tableName}' created successfully.`);
            } catch (createError: unknown) {
                const createErrorMessage = createError instanceof Error ? createError.message : String(createError);
                console.error(`Error creating table '${config.tableName}':`, createErrorMessage);
                throw createError; // Rethrow original error object
            }
        } else {
            const fetchErrorMessage = graphError.message || (error instanceof Error ? error.message : String(error));
            console.error(`Error fetching table '${config.tableName}':`, fetchErrorMessage);
            throw error; // Rethrow original error object
        }
    }

    if (!table || !table.id) {
        console.error(`Failed to find or create table '${config.tableName}'. Aborting upload.`);
        return;
    }
    const tableId = table.id;

    // Check and add headers if necessary
    try {
        const headerRowRangePath = `${getWorkbookTablePath(config, tableId)}/headerRowRange`;
        const headerRowRange = await graphClient.api(headerRowRangePath).get() as WorkbookRange;

        let headersExist = false;
        if (headerRowRange && headerRowRange.values && headerRowRange.values[0]) {
            const existingHeaders = headerRowRange.values[0].map((h: unknown) => String(h).trim());
            if (existingHeaders.length === columns.length && existingHeaders.every((h: unknown, i: number) => String(h) === columns[i])) {
                headersExist = true;
            }
        }

        if (!headersExist && columns.length > 0) {
            console.info("Headers are missing or do not match. Attempting to update/set headers.");
            // This part is tricky with existing tables. If the table was just created, it should have headers.
            // If it existed, and headers are wrong, updating them might require clearing and re-adding.
            // For simplicity, if table is newly created, it has headers. If existing, we assume headers are okay or user manages them.
            // The python script adds headers if table is new or empty.
            // Let's try to add rows for headers if the table is empty or just created.
            // A robust solution might involve checking if the table has any data rows.
            // For now, if the table was just created, it has headers. If it existed, we assume they are there.
            // The createTablePayload sets hasHeaders: true.
            // If we want to be sure, we could clear the table and add headers + data.
            // The Python script adds headers if header_range.values is empty.
            // Let's try to add header row if it's empty.
            if (!headerRowRange?.values || headerRowRange.values.length === 0 || headerRowRange.values[0]?.every((v: unknown) => String(v) === "")) {
                 console.info("Table is empty or headers are blank. Adding headers.");
                 const addHeaderPath = `${getWorkbookTablePath(config, tableId)}/rows`;
                 await graphClient.api(addHeaderPath).post({ values: [columns], index: 0 }); // Add at the beginning
                 console.info("Headers added.");
            } else {
                 console.info("Headers seem to exist. Skipping header addition.");
            }
        } else if (columns.length === 0) {
            console.warn("No columns to add as headers.");
        } else {
            console.info("Headers exist and match. Skipping header addition.");
        }
    } catch (headerError) {
        console.error("Error checking/adding headers:", headerError);
        // Continue with data upload, assuming headers might be there or table creation handled it.
    }


    // Clear existing data rows (optional, depends on whether you want to append or overwrite)
    // The Python script doesn't explicitly clear rows before adding, it seems to append.
    // If you need to clear:
    // try {
    //     const clearRowsPath = `${getWorkbookTablePath(config, tableId)}/rows`; // This might not be the right API to clear all data rows, check Graph docs
    //     // A common way is to clear the dataBodyRange
    //     const dataBodyRangePath = `${getWorkbookTablePath(config, tableId)}/dataBodyRange`;
    //     await graphClient.api(dataBodyRangePath).post({clear: "All"}); // Or use .clear() if available and appropriate
    //     console.info(`Data in table '${config.tableName}' cleared.`);
    // } catch (clearError) {
    //     console.error("Error clearing table data:", clearError);
    // }


    // Format and add data in batches
    const formattedData = data.map(row =>
        row.map(value => {
            if (value instanceof Date) {
                return value.toISOString().slice(0, 19).replace('T', ' '); // YYYY-MM-DD HH:MM:SS
            }
            return value;
        })
    );

    const addRowsPath = `${getWorkbookTablePath(config, tableId)}/rows`;
    for (let i = 0; i < formattedData.length; i += config.batchSize) {
        const batch = formattedData.slice(i, i + config.batchSize);
        try {
            await graphClient.api(addRowsPath).post({ values: batch });
            console.info(`Added ${batch.length} rows to table '${config.tableName}'.`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid API rate limits
        } catch (batchError) {
            console.error(`Error adding batch of rows to table '${config.tableName}':`, batchError);
            // Decide if you want to throw or continue with next batch
        }
    }
    console.info(`Successfully uploaded ${data.length} rows to Excel Online.`);
}


export async function exportDbToSharePoint(): Promise<{ success: boolean; message: string; rowCount?: number }> {
    console.info("Starting DB to SharePoint export process");
    const configManager = new ConfigManager();
    const config = configManager.config;

    if (!config.tenantId || !config.clientId || !config.clientSecret || !config.userIdOrSiteId || !config.driveItemId) {
        const msg = "Missing critical environment variables. Please check TENANT_ID, CLIENT_ID, CLIENT_SECRET, USER_ID_OR_SITE_ID, DRIVE_ITEM_ID, IS_SHAREPOINT_SITE.";
        console.error(msg);
        return { success: false, message: msg };
    }

    const dbClient = await getDbConnection(config);
    if (!dbClient) {
        return { success: false, message: "Failed to connect to database." };
    }

    const graphClient = getGraphClient(config);
    if (!graphClient) {
        await dbClient.end();
        return { success: false, message: "Failed to create Graph API client." };
    }

    try {
        const { columns, data } = await extractData(dbClient, DB_QUERY, 1000); // Using default limit from Python script
        
        if (data.length === 0 && columns.length === 0) {
            console.warn("No data extracted from the database. Nothing to upload.");
            return { success: true, message: "No data extracted from the database. Nothing to upload.", rowCount: 0 };
        }
        
        await loadToExcelOnline(graphClient, config, columns, data);
        console.info("DB to SharePoint export process completed successfully.");
        return { success: true, message: "Data exported successfully to SharePoint Excel.", rowCount: data.length };

    } catch (error: unknown) {
        console.error("Error during DB to SharePoint export process:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Export failed: ${errorMessage}` };
    } finally {
        if (dbClient) {
            await dbClient.end();
            console.info("Database connection closed.");
        }
    }
}

// Example of how to run this script directly (for testing)
// if (require.main === module) {
//     exportDbToSharePoint().then(result => {
//         console.log("Script execution finished:", result);
//     }).catch(error => {
//         console.error("Unhandled error in script execution:", error);
//     });
// }
