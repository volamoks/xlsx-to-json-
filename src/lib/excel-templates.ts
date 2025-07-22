import { ExcelService } from '@/app/lib/excelService';

export type ExcelTemplateType = 'icpu' | 'translation';

export interface ExcelTemplateData {
    fileName: string;
    buffer: Buffer;
}

export function generateExcelByTemplate(
    templateType: ExcelTemplateType, 
    data: any[]
): ExcelTemplateData {
    let excelData: any[];
    let fileName: string;

    switch (templateType) {
        case 'icpu':
            excelData = data.map(item => ({
                "Номер заявки": item.request_position_folder_id || item.folder_id,
                "Номер SKU": item.request_position_id,
                "Баркод": item.barcode,
                "Название по документу": item.name_by_doc,
                "Родительский бренд": item.parent_brand_name || item.parent_brand_id,
                "Бренд": item.brand_name || item.brand_id,
                "Код ICPU": item.icpu_code,
                "Номер кода упаковки": item.package_code_number,
                "Название кода упаковки": item.package_code_name,
                "ИНН поставщика": item.contractor_tin_number || item.supplier_inn || "",
                "НДС": item.input_vat === '2' ? '12' : (item.input_vat || item.vat || ""),
                "Название поставщика": item.contractor_name || item.supplier_name || "",
                "Номер договора": item.contract_number || "",
                "Дата договора": item.document_date || ""
            }));
            fileName = `icpu_check_${new Date().toISOString().split('T')[0]}.xlsx`;
            break;

        case 'translation':
            excelData = data.map(item => ({
                "Номер заявки": item.request_position_folder_id || item.folder_id,
                "Номер SKU": item.request_position_id,
                "Наименование товара (по договору)": item.name_by_doc,
                "Родительский бренд (торговая марка)": item.parent_brand_name || item.parent_brand_id,
                "Бренд": item.brand_name || item.brand_id,
                "Группа товара": item.product_group_code,
                "Наименование группы товаров": item.product_group_name,
                "Наименование товара (по требованиям)": "", // Empty for translation
                "Наименование товара на Узбекском языке": "" // Empty for translation
            }));
            fileName = `translation_request_${new Date().toISOString().split('T')[0]}.xlsx`;
            break;

        default:
            throw new Error(`Unknown Excel template type: ${templateType}`);
    }

    const buffer = ExcelService.generateExcelBuffer(excelData);

    return {
        fileName,
        buffer
    };
}

export function formatEmailDate(dateValue: string): string {
    try {
        if (dateValue.includes(' ') && dateValue.includes(':')) {
            return dateValue;
        }
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) {
            return dateValue;
        }
        return date.toLocaleDateString('ru-RU');
    } catch {
        return dateValue;
    }
}