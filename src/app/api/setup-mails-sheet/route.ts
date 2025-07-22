import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSpreadsheetDoc } from '@/app/lib/googleSheetsAuth';

export async function POST(req: NextRequest) {
    try {
        const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
        if (!spreadsheetId) {
            return NextResponse.json({ error: 'GOOGLE_SPREADSHEET_ID not configured' }, { status: 500 });
        }

        const doc = await getGoogleSpreadsheetDoc(spreadsheetId);
        if (!doc) {
            return NextResponse.json({ error: 'Unable to connect to Google Sheets' }, { status: 500 });
        }

        // Check if Mails sheet already exists
        let mailsSheet = doc.sheetsByTitle['Mails'];
        
        if (!mailsSheet) {
            // Create new Mails sheet
            mailsSheet = await doc.addSheet({ 
                title: 'Mails',
                headerValues: [
                    'Process_id',
                    'Category_id', 
                    'To_mail',
                    'To_name',
                    'CC_mail',
                    'CC_name',
                    'Has_xlsx',
                    'Xlsx_template',
                    'Email_template',
                    'Use_column_data'
                ]
            });
            
            console.log('Created new Mails sheet with headers');
        } else {
            // Clear existing data and set headers
            await mailsSheet.clear();
            await mailsSheet.setHeaderRow([
                'Process_id',
                'Category_id', 
                'To_mail',
                'To_name',
                'CC_mail',
                'CC_name',
                'Has_xlsx',
                'Xlsx_template',
                'Email_template',
                'Use_column_data'
            ]);
            
            console.log('Cleared and reset Mails sheet headers');
        }

        // Sample configuration data
        const sampleData = [
            // Status 0 - Rejection notification to KAM (dynamic from data) - for category 30 only (testing)
            {
                Process_id: '0',
                Category_id: '30',
                To_mail: 'kam_email_enriched', // column name in Sheet1 data
                To_name: 'КАМ',
                CC_mail: '',
                CC_name: '',
                Has_xlsx: 'false',
                Xlsx_template: '',
                Email_template: 'rejection_notification.html',
                Use_column_data: 'true'
            },
            
            // Status 2 - Category Manager notifications (examples for different categories)
            {
                Process_id: '2',
                Category_id: '30',
                To_mail: 's.komalov@korzinka.uz',
                To_name: 'КМ Категория 30 (тестовый)',
                CC_mail: 'supervisor@korzinka.uz',
                CC_name: 'Супервайзер',
                Has_xlsx: 'false',
                Xlsx_template: '',
                Email_template: 'category_manager_notification.html',
                Use_column_data: 'false'
            },
            {
                Process_id: '2',
                Category_id: '6',
                To_mail: 's.komalov@korzinka.uz', 
                To_name: 'КМ Категория 6 (тестовый)',
                CC_mail: 'supervisor@korzinka.uz',
                CC_name: 'Супервайзер',
                Has_xlsx: 'false',
                Xlsx_template: '',
                Email_template: 'category_manager_notification.html',
                Use_column_data: 'false'
            },
            
            // Status 5 - KAM rework notification (dynamic from data) - for category 30 only (testing)
            {
                Process_id: '5',
                Category_id: '30',
                To_mail: 'kam_email_enriched', // column name in Sheet1 data
                To_name: 'КАМ',
                CC_mail: '',
                CC_name: '',
                Has_xlsx: 'false',
                Xlsx_template: '',
                Email_template: 'kam_notification.html',
                Use_column_data: 'true'
            },
            
            // Status 7 - Listing notification - for category 30 only (testing)
            {
                Process_id: '7',
                Category_id: '30',
                To_mail: 's.komalov@korzinka.uz',
                To_name: 'Отдел листинга (тестовый)',
                CC_mail: '',
                CC_name: '',
                Has_xlsx: 'false',
                Xlsx_template: '',
                Email_template: 'listing_notification.html',
                Use_column_data: 'false'
            },
            
            // Status 7 - ICPU Check (with Excel)
            {
                Process_id: '7',
                Category_id: '',
                To_mail: 's.komalov@korzinka.uz',
                To_name: 'ICPU отдел (тестовый)',
                CC_mail: '',
                CC_name: '',
                Has_xlsx: 'true',
                Xlsx_template: 'icpu',
                Email_template: 'icpu_check.html',
                Use_column_data: 'false'
            },
            
            // Status 7 - Translation Request (with Excel)
            {
                Process_id: '7',
                Category_id: '',
                To_mail: 's.komalov@korzinka.uz',
                To_name: 'Отдел переводов (тестовый)',
                CC_mail: '',
                CC_name: '',
                Has_xlsx: 'true',
                Xlsx_template: 'translation',
                Email_template: 'translation_request.html',
                Use_column_data: 'false'
            }
        ];

        // Add sample data to sheet
        await mailsSheet.addRows(sampleData);
        
        console.log(`Added ${sampleData.length} sample configuration records to Mails sheet`);

        return NextResponse.json({
            message: `Successfully set up Mails sheet with ${sampleData.length} sample configuration records`,
            sheetUrl: `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/edit#gid=${mailsSheet.sheetId}`,
            sampleData: sampleData.length
        }, { status: 200 });

    } catch (error) {
        console.error('Error setting up Mails sheet:', error);
        return NextResponse.json({
            error: 'Failed to setup Mails sheet',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}