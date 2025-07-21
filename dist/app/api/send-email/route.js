import { NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import nodemailer from 'nodemailer';
import emailConfig from '@/lib/email-config.json';
import { getSheetData, updateSheetRows } from '@/app/lib/googleSheetsAuth';
import { ExcelService } from '@/app/lib/excelService';
async function getTaxData(icpuCode) {
    if (!icpuCode) {
        return { taxCode: "нет данных", taxNameRu: "нет данных" };
    }
    try {
        const url = `https://tasnif.soliq.uz/api/cl-api/integration-mxik/get/package?pageNo=0&pagesize=10&mxikCode=${icpuCode}&check_user=0`;
        const response = await fetch(url);
        if (!response.ok) {
            return { taxCode: "в налоговой таких данных нет", taxNameRu: "в налоговой таких данных нет" };
        }
        const data = await response.json();
        if (data && data.data && data.data.length > 0) {
            const firstItem = data.data[0];
            return { taxCode: firstItem.code, taxNameRu: firstItem.nameRu };
        }
        return { taxCode: "в налоговой таких данных нет", taxNameRu: "в налоговой таких данных нет" };
    }
    catch (error) {
        console.error(`Failed to fetch tax data for ICPU ${icpuCode}:`, error);
        return { taxCode: "ошибка при запросе", taxNameRu: "ошибка при запросе" };
    }
}
export async function POST(req) {
    const { scenarioId } = await req.json();
    if (!scenarioId) {
        return NextResponse.json({ error: 'scenarioId is required' }, { status: 400 });
    }
    const scenario = emailConfig.find(s => s.id === scenarioId);
    if (!scenario) {
        return NextResponse.json({ error: `Scenario with id '${scenarioId}' not found.` }, { status: 404 });
    }
    const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        requireTLS: true,
    };
    if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
        console.error('SMTP configuration is missing in .env file');
        return NextResponse.json({ error: 'Server configuration error: SMTP settings are incomplete.' }, { status: 500 });
    }
    try {
        const transporter = nodemailer.createTransport(smtpConfig);
        let recipient = scenario.recipient;
        const envVarMatch = recipient.match(/\${(.*?)}/);
        if (envVarMatch) {
            const envVarName = envVarMatch[1];
            recipient = process.env[envVarName] || recipient;
        }
        let attachmentContent;
        let attachmentName;
        if (scenarioId === 'icpu_check') {
            const productsData = await getSheetData('Sheet1');
            const dataToSend = productsData.filter(row => row.request_position_status_id === '7' && !row.icpu_check_sent_at);
            if (dataToSend.length === 0) {
                return NextResponse.json({ message: 'No new data to send for ICPU check.' }, { status: 200 });
            }
            const enrichedData = await Promise.all(dataToSend.map(async (item) => {
                const taxData = await getTaxData(item.icpu_code);
                let taxCode = taxData.taxCode;
                let taxNameRu = taxData.taxNameRu;
                if (taxCode === "в налоговой таких данных нет") {
                    taxCode = "ошибка";
                    taxNameRu = "";
                }
                return {
                    "Номер заявки": item.folder_id,
                    "Номер SKU": item.request_position_id,
                    "Баркод": item.barcode,
                    "Название по документу": item.name_by_doc,
                    "Родительский бренд": item.parent_brand_name || item.parent_brand_id,
                    "Бренд": item.brand_name || item.brand_id,
                    "Код ICPU": item.icpu_code,
                    "Номер кода упаковки": item.package_code_number,
                    "Название кода упаковки": item.package_code_name,
                    "Проверка ИКПУ через tasnif": taxCode,
                    "Название из налоговой": taxNameRu,
                };
            }));
            attachmentName = `icpu_check_${new Date().toISOString().split('T')[0]}.xlsx`;
            attachmentContent = ExcelService.generateExcelBuffer(enrichedData);
            const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', scenario.template);
            let htmlBody = await fs.readFile(templatePath, 'utf-8');
            htmlBody = htmlBody.replace(/#{fileName}/g, attachmentName);
            const subject = scenario.subject.replace(/#{fileName}/g, attachmentName);
            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to: recipient,
                subject: subject,
                html: htmlBody,
                attachments: [{
                        filename: attachmentName,
                        content: attachmentContent,
                        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    }],
            };
            await transporter.sendMail(mailOptions);
            const updatedRows = dataToSend.map(row => (Object.assign(Object.assign({}, row), { icpu_check_sent_at: new Date().toISOString() })));
            await updateSheetRows('Sheet1', updatedRows);
            return NextResponse.json({ message: `Email for scenario '${scenarioId}' sent successfully with ${dataToSend.length} items.` }, { status: 200 });
        }
        else if (scenarioId === 'translation_request') {
            console.log("Processing 'translation_request' scenario...");
            const productsData = await getSheetData('Sheet1');
            console.log(`Found ${productsData.length} total rows in Sheet1.`);
            const dataToSend = productsData.filter(row => row.request_position_status_id === '7' && !row.translation_sent_at);
            console.log(`Found ${dataToSend.length} rows to send for translation (status 7 and not already sent).`);
            if (dataToSend.length === 0) {
                console.log("No new data to send for translation. Exiting.");
                return NextResponse.json({ message: 'No new data to send for translation.' }, { status: 200 });
            }
            const excelData = dataToSend.map(item => ({
                "Номер заявки": item.folder_id,
                "Номер SKU": item.request_position_id,
                "Наименование товара (по договору)": item.name_by_doc,
                "Родительский бренд (торговая марка)": item.parent_brand_name || item.parent_brand_id,
                "Бренд": item.brand_name || item.brand_id,
                "Группа товара": item.product_group_code,
                "Наименование группы товаров": item.product_group_name,
                "Наименование товара (по требованиям)": "", // Empty as requested
                "Наименование товара на Узбекском языке": "", // Empty for translation
            }));
            attachmentName = `translation_request_${new Date().toISOString().split('T')[0]}.xlsx`;
            attachmentContent = ExcelService.generateExcelBuffer(excelData);
            const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', scenario.template);
            let htmlBody = await fs.readFile(templatePath, 'utf-8');
            htmlBody = htmlBody.replace(/#{fileName}/g, attachmentName);
            const subject = scenario.subject.replace(/#{fileName}/g, attachmentName);
            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to: recipient,
                subject: subject,
                html: htmlBody,
                attachments: [{
                        filename: attachmentName,
                        content: attachmentContent,
                        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    }],
            };
            await transporter.sendMail(mailOptions);
            console.log(`Email sent for translation with ${dataToSend.length} items.`);
            const updatedRows = dataToSend.map(row => (Object.assign(Object.assign({}, row), { translation_sent_at: new Date().toISOString() })));
            await updateSheetRows('Sheet1', updatedRows);
            console.log(`Updated ${updatedRows.length} rows in Sheet1 with translation_sent_at timestamp.`);
            return NextResponse.json({ message: `Email for scenario '${scenarioId}' sent successfully with ${dataToSend.length} items.` }, { status: 200 });
        }
        else {
            // --- Original logic for other scenarios ---
            if (!scenario.attachment) {
                throw new Error(`Attachment is required for scenario '${scenarioId}'`);
            }
            const attachmentPath = path.join(process.cwd(), scenario.attachment);
            attachmentContent = await fs.readFile(attachmentPath);
            attachmentName = path.basename(attachmentPath);
            const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', scenario.template);
            let htmlBody = await fs.readFile(templatePath, 'utf-8');
            htmlBody = htmlBody.replace(/#{fileName}/g, attachmentName);
            const subject = scenario.subject.replace(/#{fileName}/g, attachmentName);
            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to: recipient,
                subject: subject,
                html: htmlBody,
                attachments: [{
                        filename: attachmentName,
                        content: attachmentContent,
                        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    }],
            };
            await transporter.sendMail(mailOptions);
            return NextResponse.json({ message: `Email for scenario '${scenarioId}' sent successfully.` }, { status: 200 });
        }
    }
    catch (error) {
        console.error(`Error processing scenario '${scenarioId}':`, error);
        return NextResponse.json({ error: 'Failed to send email.', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
