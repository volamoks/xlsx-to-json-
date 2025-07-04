import { NextResponse } from 'next/server';
import { exportDbToGoogleSheet } from '../../../scripts/exportDbToGoogleSheet';

export async function POST() {
    console.log("API route /api/export-to-google-sheet called");
    try {
        const result = await exportDbToGoogleSheet();
        if (result.success) {
            return NextResponse.json({ message: result.message, rowCount: result.rowCount });
        } else {
            return NextResponse.json({ message: result.message || "Export to Google Sheet failed due to an unknown error." }, { status: 500 });
        }
    } catch (error) {
        console.error("Error in /api/export-to-google-sheet:", error);
        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred during export to Google Sheet.";
        return NextResponse.json({ message: `API Error: ${errorMessage}` }, { status: 500 });
    }
}

