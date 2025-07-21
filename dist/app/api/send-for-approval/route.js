import { NextResponse } from 'next/server';
import { sendDataForApproval } from '../../../scripts/sendDataForApproval';
export async function POST(request) {
    try {
        const body = await request.json();
        const folderId = body.folderId;
        if (typeof folderId !== 'number') {
            return NextResponse.json({ error: 'folderId must be a number.' }, { status: 400 });
        }
        const result = await sendDataForApproval(folderId);
        if (result.success) {
            return NextResponse.json({ message: result.message });
        }
        else {
            return NextResponse.json({ error: result.message }, { status: 500 });
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
