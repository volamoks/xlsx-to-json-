import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { getGoogleSheetsClient } from '@/app/lib/googleSheetsAuth';

dotenv.config();

const HISTORY_FILE_PATH = path.join(process.cwd(), 'trigger_history.json');

interface TriggerHistory {
    sent_folder_ids: (number | string)[];
}

async function readHistory(): Promise<TriggerHistory> {
    try {
        const data = await fs.readFile(HISTORY_FILE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { sent_folder_ids: [] };
        }
        console.error("Error reading history file:", error);
        throw error;
    }
}

async function writeHistory(history: TriggerHistory): Promise<void> {
    try {
        await fs.writeFile(HISTORY_FILE_PATH, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error("Error writing history file:", error);
        throw error;
    }
}

async function triggerPowerAutomateFlow(webhookUrl: string, rowData: Record<string, string | number | null>, apiKey?: string): Promise<boolean> {
    console.info(`Triggering Power Automate flow for row with folder_id: ${rowData.request_position_folder_id}`);
    
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(rowData),
        });

        if (response.ok) {
            console.info("Successfully triggered Power Automate flow.");
            return true;
        } else {
            console.error(`Failed to trigger Power Automate flow. Status: ${response.status} ${response.statusText}`);
            return false;
        }
    } catch (error) {
        console.error("Error triggering Power Automate flow:", error);
        return false;
    }
}

export async function checkSheetAndTrigger(): Promise<{ success: boolean; message: string; triggeredCount: number }> {
    const webhookUrl = process.env.POWER_AUTOMATE_WEBHOOK_URL;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
    const apiKey = process.env.POWER_AUTOMATE_API_KEY;

    if (!webhookUrl || !spreadsheetId) {
        const message = "Missing required environment variables: POWER_AUTOMATE_WEBHOOK_URL and/or GOOGLE_SPREADSHEET_ID";
        console.error(message);
        return { success: false, message, triggeredCount: 0 };
    }

    let triggeredCount = 0;
    try {
        const sheets = getGoogleSheetsClient();
        const history = await readHistory();

        console.log(`Reading data from sheet: ${sheetName}`);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: sheetName,
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            const message = "No data found in the sheet to process.";
            console.log(message);
            return { success: true, message, triggeredCount: 0 };
        }

        const headers = rows[0];
        const folderIdIndex = headers.indexOf('request_position_folder_id');

        if (folderIdIndex === -1) {
            const message = "Required column 'request_position_folder_id' not found in the sheet.";
            console.error(message);
            return { success: false, message, triggeredCount: 0 };
        }

        console.log("Checking rows for folder_id 94...");
        console.log(`History contains: [${history.sent_folder_ids.join(', ')}]`);

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rawFolderId = row[folderIdIndex];
            
            if (!rawFolderId || isNaN(parseInt(rawFolderId, 10))) {
                continue;
            }

            const folderId = parseInt(rawFolderId, 10);

            console.log(`\n--- Checking Row ${i + 1} ---`);
            console.log(`Folder ID: '${rawFolderId}', Parsed: ${folderId}.`);

            if (folderId === 94) {
                console.log(`[CONDITION MET] Folder ID is 94.`);
                if (history.sent_folder_ids.includes(folderId)) {
                    console.log(`[HISTORY CHECK] Trigger for folder_id ${folderId} already sent. Skipping.`);
                    continue;
                }

                console.log(`Found row with folder_id 94.`);
                
                const rowData: Record<string, string | number | null> = {};
                headers.forEach((header: string, index: number) => {
                    rowData[header] = row[index];
                });

                const success = await triggerPowerAutomateFlow(webhookUrl, rowData, apiKey);
                if (success) {
                    triggeredCount++;
                    history.sent_folder_ids.push(folderId);
                    await writeHistory(history);
                    console.log(`Updated history for folder_id ${folderId}.`);
                }
            }
        }
        const finalMessage = `Finished checking sheet. Triggered ${triggeredCount} new flow(s).`;
        console.log(finalMessage);
        return { success: true, message: finalMessage, triggeredCount };

    } catch (error) {
        const message = `An error occurred during the check and trigger process: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        return { success: false, message, triggeredCount: 0 };
    }
}

// Execute main only if the script is run directly from the command line
if (require.main === module) {
    checkSheetAndTrigger();
}
