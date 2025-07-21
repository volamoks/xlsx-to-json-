import { NextRequest, NextResponse } from 'next/server';
import { EmailLogger } from '@/lib/email-logging';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const scenario = searchParams.get('scenario');
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        
        const logs = EmailLogger.getLogHistory(scenario || undefined, limit);
        
        return NextResponse.json({ 
            logs,
            total: logs.length,
            scenario: scenario || 'all'
        }, { status: 200 });
    } catch (error) {
        console.error('Error fetching email logs:', error);
        return NextResponse.json({ error: 'Failed to fetch email logs' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const daysToKeep = parseInt(searchParams.get('days') || '90', 10);
        
        EmailLogger.clearOldLogs(daysToKeep);
        
        return NextResponse.json({ 
            message: `Cleared email logs older than ${daysToKeep} days` 
        }, { status: 200 });
    } catch (error) {
        console.error('Error clearing email logs:', error);
        return NextResponse.json({ error: 'Failed to clear email logs' }, { status: 500 });
    }
}