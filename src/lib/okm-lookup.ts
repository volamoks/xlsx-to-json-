import { getGoogleSpreadsheetDoc } from '@/app/lib/googleSheetsAuth';

export interface OKMData {
    categoryId: string;
    categoryName: string;
    kmEmail: string;        // Column M
    kmName: string;         // Column N  
    supervisorEmail: string; // Column J
    supervisorName: string;  // Column H
}

/**
 * Get OKM (Category Manager) data from the ОКМ sheet
 */
export async function getOKMData(): Promise<OKMData[]> {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
        throw new Error('GOOGLE_SPREADSHEET_ID is not defined');
    }

    const doc = await getGoogleSpreadsheetDoc(spreadsheetId);
    if (!doc) {
        throw new Error('Failed to access Google Spreadsheet');
    }

    const sheet = doc.sheetsByTitle['ОКМ'];
    if (!sheet) {
        throw new Error('Sheet "ОКМ" not found');
    }

    const rows = await sheet.getRows();
    const okmData: OKMData[] = [];

    for (const row of rows) {
        const categoryData = row.get('Группа закуп'); // Category field
        const supervisorName = row.get('H') || ''; // Column H - supervisor name
        const supervisorEmail = row.get('J') || ''; // Column J - supervisor email
        const kmEmail = row.get('M') || ''; // Column M - KM email
        const kmName = row.get('N') || ''; // Column N - KM name

        if (categoryData && kmEmail) {
            // Parse category data to extract ID and name
            const categoryMatch = categoryData.match(/^(\d+)\s*-?\s*(.*)/);
            if (categoryMatch) {
                const categoryId = categoryMatch[1];
                const categoryName = categoryMatch[2] || categoryData;
                
                okmData.push({
                    categoryId,
                    categoryName,
                    kmEmail: kmEmail.trim(),
                    kmName: kmName.trim(),
                    supervisorEmail: supervisorEmail.trim(),
                    supervisorName: supervisorName.trim()
                });
            }
        }
    }

    console.log(`Loaded ${okmData.length} OKM entries from Google Sheets`);
    return okmData;
}

/**
 * Get OKM data for a specific category
 */
export async function getOKMForCategory(categoryId: string): Promise<OKMData | null> {
    try {
        const allOkmData = await getOKMData();
        return allOkmData.find(okm => okm.categoryId === categoryId) || null;
    } catch (error) {
        console.error(`Error getting OKM data for category ${categoryId}:`, error);
        return null;
    }
}