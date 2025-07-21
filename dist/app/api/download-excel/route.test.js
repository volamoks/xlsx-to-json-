import { GET } from './route';
import * as googleSheets from '@/app/lib/googleSheetsAuth';
import * as excelService from '@/app/lib/excelService';
import { NextResponse } from 'next/server';
/// <reference types="@types/jest" />
jest.mock('@/app/lib/googleSheetsAuth');
jest.mock('@/app/lib/excelService');
describe('GET /api/download-excel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 400 if folder_id is missing', async () => {
        const response = await GET(new Request('http://localhost/api/download-excel'));
        expect(response.status).toBe(400);
    });
    it('should fetch data from Google Sheets', async () => {
        const mockSheetData = [
            {
                request_position_status_id: '7',
                folder_id: '1',
                barcode: '123',
                name_by_doc: 'Test',
                name_without_brand: 'Test',
                parent_brand_id: '1',
                brand_name: 'Brand',
                request_position_id: '1',
                request_id: '1',
                request_position_name: 'Position'
            },
            {
                request_position_status_id: '5',
                folder_id: '1',
                barcode: '456',
                name_by_doc: 'Test 2',
                name_without_brand: 'Test 2',
                parent_brand_id: '2',
                brand_name: 'Brand 2',
                request_position_id: '2',
                request_id: '2',
                request_position_name: 'Position 2'
            }
        ];
        googleSheets.getSheetData.mockResolvedValue(mockSheetData);
        excelService.ExcelService.downloadExcel.mockResolvedValue(new NextResponse(Buffer.from('test'), {
            headers: new Headers({
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="products_folder_1.xlsx"'
            })
        }));
        const response = await GET(new Request('http://localhost/api/download-excel?folder_id=1'));
        expect(googleSheets.getSheetData).toHaveBeenCalled();
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });
    it('should filter by status_id=7', async () => {
        const mockSheetData = [
            {
                request_position_status_id: '7',
                folder_id: '1',
                barcode: '123',
                name_by_doc: 'Test',
                name_without_brand: 'Test',
                parent_brand_id: '1',
                brand_name: 'Brand',
                request_position_id: '1',
                request_id: '1',
                request_position_name: 'Position'
            },
            {
                request_position_status_id: '5',
                folder_id: '1',
                barcode: '456',
                name_by_doc: 'Test 2',
                name_without_brand: 'Test 2',
                parent_brand_id: '2',
                brand_name: 'Brand 2',
                request_position_id: '2',
                request_id: '2',
                request_position_name: 'Position 2'
            }
        ];
        googleSheets.getSheetData.mockResolvedValue(mockSheetData);
        await GET(new Request('http://localhost/api/download-excel?folder_id=1'));
        const filteredData = excelService.ExcelService.downloadExcel.mock.calls[0][1];
        expect(filteredData.length).toBe(1);
        expect(filteredData[0].request_position_status_id).toBe('7');
    });
    it('should group by folder_id', async () => {
        const mockSheetData = [
            { request_position_status_id: '7', folder_id: '1' },
            { request_position_status_id: '7', folder_id: '2' }
        ];
        googleSheets.getSheetData.mockResolvedValue(mockSheetData);
        await GET(new Request('http://localhost/api/download-excel?folder_id=1,2'));
        const excelData = excelService.ExcelService.downloadExcel.mock.calls[0][1];
        expect(excelData).toEqual(expect.arrayContaining([
            expect.objectContaining({ folder_id: '1' }),
            expect.objectContaining({ folder_id: '2' })
        ]));
    });
});
