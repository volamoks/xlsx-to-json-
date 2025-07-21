import * as XLSX from 'xlsx';
import { NextResponse } from 'next/server';
export class ExcelService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static generateExcelBuffer(data, headerOptions) {
        var _a;
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data, { cellStyles: true });
        // Simple header styling that works reliably
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
        const headerStyle = {
            font: {
                bold: (_a = headerOptions === null || headerOptions === void 0 ? void 0 : headerOptions.bold) !== null && _a !== void 0 ? _a : true,
                color: { rgb: (headerOptions === null || headerOptions === void 0 ? void 0 : headerOptions.fontColor) || "000000" }
            },
            fill: {
                fgColor: { rgb: (headerOptions === null || headerOptions === void 0 ? void 0 : headerOptions.backgroundColor) || "E0E0E0" }
            }
        };
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const address = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws[address])
                continue;
            ws[address].s = headerStyle;
        }
        if (!ws['!ref']) {
            ws['!ref'] = XLSX.utils.encode_range({
                s: { r: 0, c: 0 },
                e: { r: data.length, c: Object.keys(data[0] || {}).length - 1 }
            });
        }
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        return XLSX.write(wb, {
            bookType: 'xlsx',
            type: 'buffer',
            cellStyles: true
        });
    }
    static async generateAndSendExcel(options) {
        var _a, _b;
        try {
            let filteredData = options.data;
            if ((_a = options.filters) === null || _a === void 0 ? void 0 : _a.length) {
                filteredData = options.data.filter((item) => options.filters.every(filter => item[filter.field] === filter.value));
            }
            if (options.emailTo === process.env.EMAIL_TO_ICPU_CHEK) {
                filteredData = filteredData.filter((item) => item.request_position_status_id === 7);
                options.columns = [
                    'barcode',
                    'name_by_doc',
                    'name_without_brand',
                    'parent_brand_id',
                    'brand_id',
                    'icpu_code',
                    'package_code_number',
                    'package_code_name'
                ];
                options.groupBy = 'folder_id';
            }
            let processedData = filteredData;
            if (options.groupBy) {
                const groups = new Map();
                filteredData.forEach((item) => {
                    const key = item[options.groupBy];
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key).push(item);
                });
                processedData = Array.from(groups.values()).flat();
            }
            let finalData = processedData;
            if ((_b = options.columns) === null || _b === void 0 ? void 0 : _b.length) {
                finalData = processedData.map((item) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const result = {};
                    options.columns.forEach((col) => {
                        result[col] = item[col];
                    });
                    return result;
                });
            }
            const excelBuffer = this.generateExcelBuffer(finalData, options.headerStyle);
            if (options.emailTo && options.emailSubject) {
                const emailOptions = {
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
        }
        catch (error) {
            console.error('Error generating Excel:', error);
            return NextResponse.json({
                success: false,
                error: 'Failed to generate Excel file'
            }, { status: 500 });
        }
    }
    static async downloadExcel(fileName, data, headerStyle) {
        if (!data || data.length === 0) {
            return NextResponse.json({ error: 'No data available for export' }, { status: 400 });
        }
        try {
            const excelBuffer = this.generateExcelBuffer(data, headerStyle);
            return new NextResponse(excelBuffer, {
                headers: {
                    'Content-Disposition': `attachment; filename="${fileName}.xlsx"`,
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            });
        }
        catch (error) {
            console.error('Excel generation failed:', error);
            return NextResponse.json({ error: 'Failed to generate Excel file' }, { status: 500 });
        }
    }
    static async sendEmailNotification(options) {
        console.log('Email would be sent with options:', options);
    }
}
