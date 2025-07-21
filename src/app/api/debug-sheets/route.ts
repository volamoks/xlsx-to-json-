import { NextResponse } from 'next/server';
import { getGoogleSpreadsheetDoc } from '@/app/lib/googleSheetsAuth';

export async function GET() {
    try {
        const doc = await getGoogleSpreadsheetDoc();
        
        // Get sheet titles
        const sheetTitles = Object.keys(doc.sheetsByTitle);
        
        // Get environment variable
        const envSheetName = process.env.GOOGLE_SHEET_TAB_NAME;
        
        return NextResponse.json({
            success: true,
            environmentSheetName: envSheetName || 'Not set',
            defaultSheetName: 'Sheet1',
            availableSheets: sheetTitles,
            spreadsheetInfo: {
                title: doc.title,
                sheetCount: doc.sheetCount
            }
        });

    } catch (error) {
        console.error('Error getting sheet info:', error);
        return NextResponse.json(
            { error: 'Failed to get sheet information' },
            { status: 500 }
        );
    }
}