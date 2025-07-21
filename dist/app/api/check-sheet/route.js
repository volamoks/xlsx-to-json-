import { NextResponse } from 'next/server';
import { checkSheetAndTrigger } from '../../../scripts/checkSheetAndTriggerFlow';
export async function POST() {
    try {
        const result = await checkSheetAndTrigger();
        if (result.success) {
            return NextResponse.json({ message: result.message, triggeredCount: result.triggeredCount });
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
