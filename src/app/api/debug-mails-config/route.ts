import { NextRequest, NextResponse } from 'next/server';
import { getMailsConfig } from '@/lib/mails-config';

export async function GET(req: NextRequest) {
    try {
        const configs = await getMailsConfig();
        
        return NextResponse.json({
            totalConfigs: configs.length,
            configs: configs.map(config => ({
                process_id: config.process_id,
                category_id: config.category_id || '(empty)',
                to_mail: config.to_mail,
                use_column_data: config.use_column_data,
                email_template: config.email_template
            }))
        }, { status: 200 });

    } catch (error) {
        console.error('Error fetching mails config:', error);
        return NextResponse.json({
            error: 'Failed to fetch mails config',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}