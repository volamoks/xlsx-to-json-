import { NextResponse } from 'next/server';
export async function POST(request) {
    try {
        const body = await request.json();
        const folderId = body.folderId;
        if (typeof folderId !== 'number') {
            return NextResponse.json({ error: 'folderId must be a number.' }, { status: 400 });
        }
        // This is the new "magic link"
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const downloadUrl = `${appUrl}/api/download-excel?folderId=${folderId}`;
        // Here you would send the downloadUrl to Power Automate
        // For now, we just return it in the response for the user to see
        console.log(`Generated download link: ${downloadUrl}`);
        // This part needs to be implemented: sending the URL to Power Automate
        // For now, we simulate success
        const successMessage = `Successfully created download link for folder ${folderId}. Please use this link in Power Automate: ${downloadUrl}`;
        return NextResponse.json({ success: true, message: successMessage, downloadUrl: downloadUrl });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
