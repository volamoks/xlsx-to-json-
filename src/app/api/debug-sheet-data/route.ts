import { NextResponse } from 'next/server';
import { getSheetData } from '@/app/lib/googleSheetsAuth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '10');
        
        // Get data from Google Sheets (use environment variable or default)
        const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
        const sheetData = await getSheetData(sheetName);
        
        // Get unique values for key fields
        const statusValues = [...new Set(sheetData.map(item => item.request_position_status_id))].filter(Boolean);
        const categoryValues = [...new Set(sheetData.map(item => item.folder_category_id))].filter(Boolean);
        const categoryNames = [...new Set(sheetData.map(item => item.folder_category_name))].filter(Boolean);
        
        // Get sample data - show ALL fields for debugging
        const sampleData = sheetData.slice(0, 1).map(item => {
            const allFields: Record<string, any> = {};
            Object.keys(item).forEach(key => {
                allFields[key] = (item as any)[key];
            });
            return allFields;
        });
        
        // Get status 2 data specifically
        const status2Data = sheetData
            .filter(item => item.request_position_status_id === '2')
            .slice(0, 5)
            .map(item => ({
                request_position_id: item.request_position_id,
                request_position_folder_id: item.request_position_folder_id,
                folder_category_id: item.folder_category_id,
                folder_category_name: item.folder_category_name,
                name_by_doc: item.name_by_doc,
                contractor_name: item.contractor_name,
                supplier_name: item.supplier_name,
                catman_fio: item.catman_fio
            }));

        // Get status 5 data specifically
        const status5Data = sheetData
            .filter(item => item.request_position_status_id === '5')
            .slice(0, 10)
            .map(item => ({
                request_position_id: item.request_position_id,
                request_position_folder_id: item.request_position_folder_id,
                folder_category_id: item.folder_category_id,
                folder_category_name: item.folder_category_name,
                name_by_doc: item.name_by_doc,
                contractor_name: item.contractor_name,
                supplier_name: item.supplier_name,
                catman_fio: item.catman_fio
            }));

        return NextResponse.json({
            success: true,
            sheetName,
            totalRows: sheetData.length,
            summary: {
                availableStatuses: statusValues.sort(),
                availableCategories: categoryValues.sort(),
                availableCategoryNames: categoryNames.sort(),
                status2Count: sheetData.filter(item => item.request_position_status_id === '2').length,
                status5Count: sheetData.filter(item => item.request_position_status_id === '5').length
            },
            sampleData,
            status2Data,
            status5Data
        });

    } catch (error) {
        console.error('Error getting sheet data for debug:', error);
        return NextResponse.json(
            { error: 'Failed to get sheet data for debugging' },
            { status: 500 }
        );
    }
}