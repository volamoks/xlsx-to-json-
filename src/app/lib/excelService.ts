import * as XLSX from 'xlsx';
import { NextResponse } from 'next/server';

interface EmailOptions {
    to: string | string[]; // Можно указать один email или массив
    subject: string;
    template?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer;
    }>;
}

export interface ProductData {
    barcode: string;
    name_by_doc: string;
    name_without_brand: string;
    parent_brand_id: string;
    brand_id: string;
    icpu_code: string;
    package_code_number: string;
    package_code_name: string;
    request_position_status_id: number;
    folder_id: string;
    request_position_id: string;
    supplier_inn?: string;
    vat?: string;
    supplier_name?: string;
    contract_number?: string;
    addendum_number?: string;
}

interface ExcelGenerationOptions {
    data: ProductData[];
    fileName: string;
    emailTo?: string;
    emailSubject?: string;
    emailTemplate?: string;
    columns?: (keyof ProductData)[];
    filters?: {
        field: keyof ProductData;
        value: unknown;
    }[];
    groupBy?: keyof ProductData;
}

export class ExcelService {
    
    private static readonly FIELD_LABELS: Record<string, string> = {
        barcode: 'Штрихкод',
        name_by_doc: 'Наименование по документу',
        name_without_brand: 'Наименование без бренда',
        parent_brand_id: 'ID родительского бренда',
        brand_id: 'ID бренда',
        icpu_code: 'Код ИКПУ',
        package_code_number: 'Номер кода упаковки',
        package_code_name: 'Название кода упаковки',
        supplier_inn: 'ИНН поставщика',
        vat: 'НДС',
        supplier_name: 'Название поставщика',
        contract_number: 'Номер договора',
        addendum_number: 'Номер допсоглашения',
        request_position_id: 'ID позиции запроса',
        folder_id: 'ID папки',
        request_position_status_id: 'ID статуса позиции запроса'
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static generateExcelBuffer(data: any[], _headerOptions?: {
        backgroundColor?: string;
        fontColor?: string;
        bold?: boolean;
    }): Buffer {
        const wb = XLSX.utils.book_new();
        
        // Преобразуем данные с человекочитаемыми заголовками
        const transformedData = data.map(item => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transformed: any = {};
            Object.keys(item).forEach(key => {
                const label = this.FIELD_LABELS[key] || key;
                transformed[label] = item[key];
            });
            return transformed;
        });
        
        const ws = XLSX.utils.json_to_sheet(transformedData, { cellStyles: true });

        // Улучшенная стилизация заголовков
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
        const headerStyle = {
            font: {
                bold: true,
                color: { rgb: "FFFFFF" },
                sz: 12
            },
            fill: {
                fgColor: { rgb: "4472C4" }
            },
            border: {
                top: { style: "thin", color: { rgb: "000000" } },
                bottom: { style: "thin", color: { rgb: "000000" } },
                left: { style: "thin", color: { rgb: "000000" } },
                right: { style: "thin", color: { rgb: "000000" } }
            },
            alignment: {
                horizontal: "center",
                vertical: "center"
            }
        };

        // Стиль для обычных ячеек
        const cellStyle = {
            border: {
                top: { style: "thin", color: { rgb: "D0D0D0" } },
                bottom: { style: "thin", color: { rgb: "D0D0D0" } },
                left: { style: "thin", color: { rgb: "D0D0D0" } },
                right: { style: "thin", color: { rgb: "D0D0D0" } }
            },
            alignment: {
                vertical: "center",
                wrapText: true
            }
        };

        // Применяем стили к заголовкам
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const address = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws[address]) continue;
            ws[address].s = headerStyle;
        }

        // Применяем стили к обычным ячейкам
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const address = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[address]) continue;
                ws[address].s = cellStyle;
            }
        }

        // Устанавливаем ширину колонок
        const colWidths = [];
        for (let i = 0; i <= range.e.c; ++i) {
            colWidths.push({ width: 25 }); // Устанавливаем ширину 25 для всех колонок
        }
        ws['!cols'] = colWidths;

        // Устанавливаем высоту строк
        const rowHeights = [];
        rowHeights.push({ hpt: 30 }); // Высота заголовка
        for (let i = 1; i <= range.e.r; ++i) {
            rowHeights.push({ hpt: 20 }); // Высота обычных строк
        }
        ws['!rows'] = rowHeights;

        if (!ws['!ref']) {
            ws['!ref'] = XLSX.utils.encode_range({
                s: { r: 0, c: 0 },
                e: { r: transformedData.length, c: Object.keys(transformedData[0] || {}).length - 1 }
            });
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Данные');
        return XLSX.write(wb, {
            bookType: 'xlsx',
            type: 'buffer',
            cellStyles: true
        });
    }

    static async generateAndSendExcel(
        options: ExcelGenerationOptions & {
            headerStyle?: {
                backgroundColor?: string;
                fontColor?: string;
                fontSize?: number;
                bold?: boolean;
                italic?: boolean;
                underline?: boolean;
                border?: boolean;
                rowHeight?: number;
            };
        }
    ): Promise<NextResponse> {
        try {
            let filteredData = options.data;
            if (options.filters?.length) {
                filteredData = options.data.filter((item: ProductData) =>
                    options.filters!.every(filter =>
                        item[filter.field] === filter.value
                    )
                );
            }

            if (options.emailTo === process.env.EMAIL_TO_ICPU_CHEK) {
                filteredData = filteredData.filter((item: ProductData) => 
                    item.request_position_status_id === 7
                );
                
                options.columns = [
                    'barcode',
                    'name_by_doc', 
                    'name_without_brand',
                    'parent_brand_id',
                    'brand_id',
                    'icpu_code',
                    'package_code_number',
                    'package_code_name',
                    'supplier_inn',
                    'vat',
                    'supplier_name',
                    'contract_number',
                    'addendum_number'
                ];
                
                options.groupBy = 'folder_id';
            }

            let processedData = filteredData;
            if (options.groupBy) {
                const groups = new Map<string | number, ProductData[]>();
                filteredData.forEach((item: ProductData) => {
                    const key = item[options.groupBy!] as string | number;
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key)!.push(item);
                });
                processedData = Array.from(groups.values()).flat();
            }

            let finalData: Partial<ProductData>[] = processedData;
            if (options.columns?.length) {
                finalData = processedData.map((item: ProductData) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const result: any = {};
                    options.columns!.forEach((col: keyof ProductData) => {
                        result[col] = item[col];
                    });
                    return result as Partial<ProductData>;
                });
            }

            const excelBuffer = this.generateExcelBuffer(finalData, options.headerStyle);

            if (options.emailTo && options.emailSubject) {
                const emailOptions: EmailOptions = {
                    to: options.emailTo.includes(',')
                        ? options.emailTo.split(',').map(e => e.trim())
                        : options.emailTo,
                    subject: options.emailSubject,
                    template: options.emailTemplate || 'default_excel_template.html',
                    attachments: [{
                        filename: `${options.fileName}.xlsx`,
                        content: excelBuffer
                    }]
                };
                await this.sendEmailNotification(emailOptions);
            }

            return NextResponse.json({
                success: true,
                fileName: options.fileName,
                data: finalData,
                downloadUrl: options.emailTo ? undefined : `/api/download-excel?fileName=${options.fileName}`
            });

        } catch (error) {
            console.error('Error generating Excel:', error);
            return NextResponse.json({
                success: false,
                error: 'Failed to generate Excel file'
            }, { status: 500 });
        }
    }

    static async downloadExcel(
        fileName: string,
        data: Partial<ProductData>[],
        headerStyle?: {
            backgroundColor?: string;
            fontColor?: string;
            fontSize?: number;
            bold?: boolean;
            italic?: boolean;
            underline?: boolean;
            border?: boolean;
            rowHeight?: number;
        }
    ) {
        if (!data || data.length === 0) {
            return NextResponse.json(
                { error: 'No data available for export' },
                { status: 400 }
            );
        }

        try {
            const excelBuffer = this.generateExcelBuffer(data, headerStyle);
            return new NextResponse(excelBuffer, {
                headers: {
                    'Content-Disposition': `attachment; filename="${fileName}.xlsx"`,
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            });
        } catch (error) {
            console.error('Excel generation failed:', error);
            return NextResponse.json(
                { error: 'Failed to generate Excel file' },
                { status: 500 }
            );
        }
    }

    private static async sendEmailNotification(options: EmailOptions): Promise<void> {
        console.log('Email would be sent with options:', options);
    }
}