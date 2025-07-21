import { NextResponse } from 'next/server';
import { exportDbToGoogleSheet } from '../../../scripts/exportDbToGoogleSheet';

export async function POST() {
    try {
        const result = await exportDbToGoogleSheet();
        if (result.success) {
            return NextResponse.json({ message: result.message, rowCount: result.rowCount });
        } else {
            return NextResponse.json({ error: result.message }, { status: 500 });
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
