import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { getGoogleSheetsClient } from '@/app/lib/googleSheetsAuth';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import "isomorphic-fetch";

dotenv.config();

type SheetRow = Record<string, string | number | null>;

async function getRowsFromSheet(folderId: number): Promise<SheetRow[]> {
    // ... (this function remains the same)
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
    if (!spreadsheetId) {
        throw new Error("GOOGLE_SPREADSHEET_ID is not set.");
    }
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
    });
    const allRows = response.data.values;
    if (!allRows || allRows.length < 2) return [];
    const headers = allRows[0];
    const folderIdIndex = headers.indexOf('request_position_folder_id');
    if (folderIdIndex === -1) throw new Error("Column 'request_position_folder_id' not found.");
    const filteredRows = allRows.slice(1).filter((row: (string | number | boolean | Date | null)[]) => row[folderIdIndex] !== null && parseInt(String(row[folderIdIndex]), 10) === folderId);
    return filteredRows.map((row: (string | number | boolean | Date | null)[]) => {
        const rowData: SheetRow = {};
        headers.forEach((header: string, index: number) => {
            const value = row[index];
                if (typeof value === 'boolean' || value instanceof Date) {
                    rowData[header] = String(value);
                } else {
                    rowData[header] = value;
                }
        });
        return rowData;
    });
}

async function generateExcelBuffer(positions: SheetRow[]): Promise<Buffer> {
    // ... (this function remains the same)
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Request Positions');
    if (positions.length > 0) {
        worksheet.columns = Object.keys(positions[0]).map(key => ({ header: key, key: key, width: 20 }));
        const sanitizedPositions = positions.map(pos => {
            const sanitized: SheetRow = {};
            for (const key in pos) {
                sanitized[key] = pos[key] ?? '';
            }
            return sanitized;
        });
        worksheet.addRows(sanitizedPositions);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function getMicrosoftGraphClient() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error("Azure AD credentials (TENANT_ID, CLIENT_ID, CLIENT_SECRET) are not set in .env file.");
    }

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const client = Client.initWithMiddleware({
        authProvider: {
            getAccessToken: async () => {
                const token = await credential.getToken("https://graph.microsoft.com/.default");
                return token.token;
            }
        }
    });
    return client;
}

async function uploadToOneDrive(buffer: Buffer, fileName: string): Promise<string | null> {
    const client = getMicrosoftGraphClient();
    const userId = process.env.ONEDRIVE_USER_ID; // User's email or ID
    const folderPath = process.env.ONEDRIVE_FOLDER_PATH || '/'; // e.g., '/MyFolder/SubFolder'

    if (!userId) {
        throw new Error("ONEDRIVE_USER_ID is not set in .env file.");
    }

    const uploadPath = `/users/${userId}/drive/root:${folderPath}/${fileName}:/content`;
    
    console.log(`Uploading ${fileName} to OneDrive...`);
    const response = await client.api(uploadPath).put(buffer);
    console.log("File uploaded successfully.");
    
    return response.webUrl;
}

export async function generateAndUploadToOneDrive(folderId: number): Promise<{ success: boolean; message: string; fileUrl?: string }> {
    try {
        const positions = await getRowsFromSheet(folderId);
        if (positions.length === 0) {
            return { success: true, message: `No request positions found for folder_id ${folderId}.` };
        }

        const excelBuffer = await generateExcelBuffer(positions);
        const fileName = `approval_for_folder_${folderId}.xlsx`;
        
        const webUrl = await uploadToOneDrive(excelBuffer, fileName);

        if (!webUrl) {
            throw new Error("Failed to get web URL for the uploaded file.");
        }

        // Here you would send the webUrl to Power Automate
        // For now, we just return it
        const successMessage = `Successfully generated and uploaded Excel to OneDrive. URL: ${webUrl}`;
        console.log(successMessage);
        return { success: true, message: successMessage, fileUrl: webUrl };

    } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred.";
        console.error(message);
        return { success: false, message };
    }
}
