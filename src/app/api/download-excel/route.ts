import { NextResponse } from 'next/server';
import { ExcelService } from '@/app/lib/excelService';
import { getSheetData } from '@/app/lib/googleSheetsAuth';
import type { SheetRow } from '@/app/lib/googleSheetsAuth';

interface ExcelDataItem {
  barcode: string;
  name_by_doc: string;
  name_without_brand: string;
  parent_brand_id: string;
  brand_id: string;
  icpu_code: string;
  package_code_number: string;
  package_code_name: string;
  request_position_id: string;
  folder_id: string;
  request_position_status_id?: number;
  supplier_inn?: string;
  vat?: string;
  supplier_name?: string;
  contract_number?: string;
  addendum_number?: string;
}

async function getDataForExcel(folderId: string): Promise<ExcelDataItem[]> {
  try {
    const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
    const sheetData = await getSheetData(sheetName);

    // Фильтруем по folder_id и преобразуем типы
    return sheetData
      .filter((item: SheetRow) => item.folder_id === folderId)
      .map((item: SheetRow) => ({
        ...item,
        request_position_status_id: item.request_position_status_id
          ? parseInt(item.request_position_status_id)
          : undefined
      }));
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error);
    throw new Error('Failed to fetch data from Google Sheets');
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get('folderId');
    const statusId = searchParams.get('statusId') || '7';

    if (!folderId) {
      return NextResponse.json(
        { error: 'folderId parameter is required' },
        { status: 400 }
      );
    }

    // Получаем данные
    const rawData = await getDataForExcel(folderId);

    // Фильтруем по statusId = 7
    const filteredData = rawData.filter(
      (item) => item.request_position_status_id?.toString() === statusId
    );

    // Группируем по folder_id
    const groupedData = filteredData.reduce((acc: Record<string, ExcelDataItem[]>, item) => {
      const key = item.folder_id;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});

    // Формируем итоговые данные
    const excelData = Object.values(groupedData).flat().map((item) => ({
      barcode: item.barcode,
      name_by_doc: item.name_by_doc,
      name_without_brand: item.name_without_brand,
      parent_brand_id: item.parent_brand_id,
      brand_id: item.brand_id,
      icpu_code: item.icpu_code,
      package_code_number: item.package_code_number,
      package_code_name: item.package_code_name,
      request_position_id: item.request_position_id,
      folder_id: item.folder_id,
      request_position_status_id: item.request_position_status_id,
      supplier_inn: item.supplier_inn,
      vat: item.vat,
      supplier_name: item.supplier_name,
      contract_number: item.contract_number,
      addendum_number: item.addendum_number
    }));

    // Генерируем Excel файл
    const fileName = `products_folder_${folderId}`;
    return ExcelService.downloadExcel(fileName, excelData);

  } catch (error) {
    console.error('Error generating Excel file:', error);
    return NextResponse.json(
      { error: 'Failed to generate Excel file' },
      { status: 500 }
    );
  }
}