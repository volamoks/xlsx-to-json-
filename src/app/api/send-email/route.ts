import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import nodemailer from 'nodemailer';
import emailConfig from '@/lib/email-config.json';
import { getSheetData, updateSheetRows } from '@/app/lib/googleSheetsAuth';
import { ExcelService } from '@/app/lib/excelService';
import { EmailLogger } from '@/lib/email-logging';

interface EmailScenario {
    id: string;
    description: string;
    recipients: {
        to: string[];
        cc: string[];
        bcc: string[];
    };
    subject: string;
    template: string;
    attachment?: string; // Make attachment optional
}

function formatEmailDate(dateValue: string): string {
    try {
        // If it's already formatted (contains space and time), return as is
        if (dateValue.includes(' ') && dateValue.includes(':')) {
            return dateValue;
        }

        // Otherwise, try to parse and format
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) {
            return dateValue;
        }

        return date.toLocaleDateString('ru-RU');
    } catch {
        return dateValue;
    }
}

async function getTaxData(icpuCode: string, packageCodeNumber?: string) {
    if (!icpuCode) {
        return { mxikName: "", packageName: "" };
    }

    // Clean the icpuCode - remove any leading/trailing spaces
    const cleanIcpuCode = icpuCode.trim();
    console.log(`Original icpuCode: "${icpuCode}" (length: ${icpuCode.length})`);
    console.log(`Cleaned icpuCode: "${cleanIcpuCode}" (length: ${cleanIcpuCode.length})`);

    try {
        const url = `https://tasnif.soliq.uz/api/cls-api/mxik/get/by-mxik?mxikCode=${cleanIcpuCode}&lang=ru`;
        console.log(`Fetching tax data from: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            console.error(`API response not ok: ${response.status} ${response.statusText}`);
            return { mxikName: "", packageName: "" };
        }

        const data = await response.json();
        console.log(`API response for ${icpuCode}:`, JSON.stringify(data, null, 2));

        let mxikName = "";
        let packageName = "";

        // Extract mxikName from the response
        if (data && data.mxikName) {
            mxikName = data.mxikName;
            console.log(`Found mxikName: ${mxikName}`);
        } else {
            console.log('No mxikName found in response. Available keys:', Object.keys(data || {}));
        }

        // Extract package name from packages array by matching code with packageCodeNumber
        if (data && data.packages && Array.isArray(data.packages)) {
            console.log(`Found ${data.packages.length} packages`);

            if (packageCodeNumber) {
                console.log(`Looking for package with code: ${packageCodeNumber}`);
                // Find package by code matching the "Номер кода упаковки" field
                const packageItem = data.packages.find((pkg: any) => pkg.code === packageCodeNumber);
                if (packageItem && packageItem.name) {
                    packageName = packageItem.name;
                    console.log(`Found matching package: ${packageName}`);
                } else {
                    console.log(`No package found with code: ${packageCodeNumber}`);
                }
            } else {
                // If no package code number provided, take the first package
                const packageItem = data.packages[0];
                if (packageItem && packageItem.name) {
                    packageName = packageItem.name;
                    console.log(`Using first package: ${packageName}`);
                }
            }
        } else {
            console.log('No packages array found in response');
        }

        console.log(`Final result - mxikName: ${mxikName}, packageName: ${packageName}`);
        return { mxikName, packageName };
    } catch (error) {
        console.error(`Failed to fetch tax data for ICPU ${icpuCode}:`, error);
        return { mxikName: "", packageName: "" };
    }
}


export async function POST(req: NextRequest) {
    const body = await req.json();
    const { scenarioId } = body;

    if (!scenarioId) {
        return NextResponse.json({ error: 'scenarioId is required' }, { status: 400 });
    }

    const scenario: EmailScenario | undefined = (emailConfig as EmailScenario[]).find(s => s.id === scenarioId);

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

        let attachmentContent: Buffer;
        let attachmentName: string;

        if (scenarioId === 'icpu_check') {
            const toRecipients = scenario.recipients.to.filter(email => email && email.trim() !== '');
            const ccRecipients = scenario.recipients.cc.filter(email => email && email.trim() !== '');
            const bccRecipients = scenario.recipients.bcc.filter(email => email && email.trim() !== '');

            if (toRecipients.length === 0) {
                return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
            }

            const productsData = await getSheetData('Sheet1');

            // Get previously sent request IDs to avoid duplicates
            const sentRequestIds = EmailLogger.getSentRequestIds('icpu_check', 30);

            const dataToSend = productsData.filter(row =>
                row.request_position_status_id === '7' &&
                !row.icpu_check_sent_at &&
                !sentRequestIds.includes(row.request_position_id)
            );

            if (dataToSend.length === 0) {
                return NextResponse.json({ message: 'No new data to send for ICPU check.' }, { status: 200 });
            }

            console.log(`Processing ${dataToSend.length} items for ICPU check`);
            console.log('First few items from dataToSend:');
            dataToSend.slice(0, 3).forEach((item, index) => {
                console.log(`Item ${index + 1}:`, {
                    request_position_id: item.request_position_id,
                    icpu_code: item.icpu_code,
                    package_code_number: item.package_code_number,
                    name_by_doc: item.name_by_doc,
                    folder_id: item.folder_id
                });
            });

            const enrichedData = await Promise.all(dataToSend.map(async (item, index) => {
                console.log(`Processing item ${index + 1}/${dataToSend.length}: request_position_id=${item.request_position_id}, icpu_code="${item.icpu_code}", package_code_number="${item.package_code_number}"`);

                const taxData = await getTaxData(item.icpu_code, item.package_code_number);

                let mxikName = taxData.mxikName;
                let packageName = taxData.packageName;

                // Keep empty values as they are

                const result = {
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
                    "Дата договора": item.document_date ? formatEmailDate(item.document_date) : "",
                };

                console.log(`Result for item ${index + 1}:`, result);
                return result;
            }));

            console.log(`Final enriched data (${enrichedData.length} items):`, enrichedData);

            attachmentName = `icpu_check_${new Date().toISOString().split('T')[0]}.xlsx`;
            attachmentContent = ExcelService.generateExcelBuffer(enrichedData);

            const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', scenario.template);
            let htmlBody = await fs.readFile(templatePath, 'utf-8');
            htmlBody = htmlBody.replace(/#{fileName}/g, attachmentName);
            const subject = scenario.subject.replace(/#{fileName}/g, attachmentName);

            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to: toRecipients.join(', '),
                cc: ccRecipients.length > 0 ? ccRecipients.join(', ') : undefined,
                bcc: bccRecipients.length > 0 ? bccRecipients.join(', ') : undefined,
                subject: subject,
                html: htmlBody,
                attachments: [{
                    filename: attachmentName,
                    content: attachmentContent,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                }],
            };

            await transporter.sendMail(mailOptions);

            // Log the sent email
            const requestIds = dataToSend.map(row => row.request_position_id);
            EmailLogger.logEmail('icpu_check', requestIds, toRecipients.join(', '), subject);

            const updatedRows = dataToSend.map(row => ({ ...row, icpu_check_sent_at: new Date().toISOString() }));
            await updateSheetRows('Sheet1', updatedRows);

            return NextResponse.json({ message: `Email for scenario '${scenarioId}' sent successfully with ${dataToSend.length} items.` }, { status: 200 });

        } else if (scenarioId === 'translation_request') {
            console.log("Processing 'translation_request' scenario...");

            const toRecipients = scenario.recipients.to.filter(email => email && email.trim() !== '');
            const ccRecipients = scenario.recipients.cc.filter(email => email && email.trim() !== '');
            const bccRecipients = scenario.recipients.bcc.filter(email => email && email.trim() !== '');

            if (toRecipients.length === 0) {
                return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
            }

            const productsData = await getSheetData('Sheet1');
            console.log(`Found ${productsData.length} total rows in Sheet1.`);

            // Get previously sent request IDs to avoid duplicates
            const sentRequestIds = EmailLogger.getSentRequestIds('translation_request', 30);

            const dataToSend = productsData.filter(row =>
                row.request_position_status_id === '7' &&
                !row.translation_sent_at &&
                !sentRequestIds.includes(row.request_position_id)
            );
            console.log(`Found ${dataToSend.length} rows to send for translation (status 7 and not already sent).`);

            if (dataToSend.length === 0) {
                console.log("No new data to send for translation. Exiting.");
                return NextResponse.json({ message: 'No new data to send for translation.' }, { status: 200 });
            }

            const excelData = dataToSend.map(item => ({
                "Номер заявки": item.request_position_folder_id || item.folder_id,
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
                to: toRecipients.join(', '),
                cc: ccRecipients.length > 0 ? ccRecipients.join(', ') : undefined,
                bcc: bccRecipients.length > 0 ? bccRecipients.join(', ') : undefined,
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

            // Log the sent email
            const requestIds = dataToSend.map(row => row.request_position_id);
            EmailLogger.logEmail('translation_request', requestIds, toRecipients.join(', '), subject);

            const updatedRows = dataToSend.map(row => ({ ...row, translation_sent_at: new Date().toISOString() }));
            await updateSheetRows('Sheet1', updatedRows);
            console.log(`Updated ${updatedRows.length} rows in Sheet1 with translation_sent_at timestamp.`);

            return NextResponse.json({ message: `Email for scenario '${scenarioId}' sent successfully with ${dataToSend.length} items.` }, { status: 200 });

        } else if (scenarioId === 'category_manager_notification') {
            const { categoryId } = body;

            if (!categoryId) {
                return NextResponse.json({ error: 'categoryId is required for category manager notification' }, { status: 400 });
            }

            const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
            const sheetData = await getSheetData(sheetName);

            // Filter data: status = 2 and specific folder_category_id
            const filteredPositions = sheetData.filter(item =>
                item.request_position_status_id === '2' &&
                item.folder_category_id === categoryId.toString()
            );

            if (filteredPositions.length === 0) {
                return NextResponse.json({
                    message: `No positions with status 2 found for category ${categoryId}`
                }, { status: 200 });
            }

            // Check which positions should be excluded (already sent AND not updated)
            const currentRequests = filteredPositions.map(pos => ({
                id: pos.request_position_id,
                changeDateTime: pos.folder_change_datetime || ''
            }));
            
            const excludeIds = EmailLogger.getRequestsToExclude('category_manager_notification', currentRequests, 7);
            const newPositions = filteredPositions.filter(pos =>
                !excludeIds.includes(pos.request_position_id)
            );

            if (newPositions.length === 0) {
                return NextResponse.json({
                    message: `All positions for category ${categoryId} have already been sent`
                }, { status: 200 });
            }

            // Get OKM (Category Manager) data from ОКМ sheet
            const { getOKMForCategory } = await import('@/lib/okm-lookup');
            const okmData = await getOKMForCategory(categoryId.toString());
            
            if (!okmData || !okmData.kmEmail) {
                return NextResponse.json({
                    error: `No Category Manager email found for category ${categoryId} in ОКМ sheet`
                }, { status: 400 });
            }

            // Generate positions table
            const positionsTable = newPositions.map(pos => `
            <tr>
                <td>${pos.request_position_folder_id || pos.folder_id || '-'}</td>
                <td>${pos.request_position_id}</td>
                <td>${pos.name_by_doc}</td>
                <td>${pos.contractor_name || pos.supplier_name || '-'}</td>
                <td>-</td>
            </tr>
        `).join('');

            // Load email template
            const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', scenario.template);
            let htmlBody = await fs.readFile(templatePath, 'utf-8');

            // Get category name (first position should have it)
            const categoryName = newPositions[0]?.folder_category_name || `Категория ${categoryId}`;

            // Replace template variables
            htmlBody = htmlBody
                .replace(/#{categoryName}/g, categoryName)
                .replace(/#{positionsCount}/g, newPositions.length.toString())
                .replace(/#{positionsTable}/g, positionsTable);

            const subject = scenario.subject.replace(/#{categoryName}/g, categoryName);

            // Use OKM data for email recipients
            const toRecipients = [okmData.kmEmail].filter(email => email && email.trim() !== '');
            const ccRecipients = okmData.supervisorEmail ? [okmData.supervisorEmail] : [];
            const bccRecipients: string[] = [];

            if (toRecipients.length === 0) {
                return NextResponse.json({ error: 'No valid KM email found in ОКМ data' }, { status: 400 });
            }

            const mailOptions = {
                from: process.env.SMTP_USER,
                to: toRecipients,
                cc: ccRecipients.length > 0 ? ccRecipients : undefined,
                bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
                subject: subject,
                html: htmlBody,
            };

            await transporter.sendMail(mailOptions);

            // Log the sent email with change dates for future comparison
            const requestIds = newPositions.map(pos => pos.request_position_id);
            const requestChangeDates = newPositions.reduce((acc, pos) => {
                acc[pos.request_position_id] = pos.folder_change_datetime || '';
                return acc;
            }, {} as Record<string, string>);
            
            EmailLogger.logEmail(
                'category_manager_notification',
                requestIds,
                toRecipients.join(', '),
                subject,
                requestChangeDates
            );

            return NextResponse.json({
                message: `Successfully sent category manager notification for category ${categoryId} with ${newPositions.length} positions`
            }, { status: 200 });

        } else if (scenarioId === 'kam_notification') {
            const { categoryId } = body;

            const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
            const sheetData = await getSheetData(sheetName);

            // Filter data: status = 5 (требует доработки) and specific category if provided
            // Note: category mapping is categoryId + 1 = folder_category_id (category is stored as category + 1 in DB)
            const filteredPositions = sheetData.filter(item => {
                const statusMatch = item.request_position_status_id === '5';
                const categoryMatch = categoryId ? item.folder_category_id === (parseInt(categoryId.toString()) + 1).toString() : true;
                return statusMatch && categoryMatch;
            });

            if (filteredPositions.length === 0) {
                const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
                return NextResponse.json({
                    message: `No positions with status 5 found for KAM notification${categoryMsg}`
                }, { status: 200 });
            }

            // Check which positions should be excluded (already sent AND not updated)
            const currentRequests = filteredPositions.map(pos => ({
                id: pos.request_position_id,
                changeDateTime: pos.folder_change_datetime || ''
            }));
            
            const excludeIds = EmailLogger.getRequestsToExclude('kam_notification', currentRequests, 7);
            const newPositions = filteredPositions.filter(pos =>
                !excludeIds.includes(pos.request_position_id)
            );

            if (newPositions.length === 0) {
                const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
                return NextResponse.json({
                    message: `All positions with status 5 have already been sent${categoryMsg}`
                }, { status: 200 });
            }

            // Generate positions table
            const positionsTable = newPositions.map(pos => `
            <tr>
                <td>${pos.request_position_folder_id || pos.folder_id || '-'}</td>
                <td>${pos.request_position_id}</td>
                <td>${pos.name_by_doc}</td>
                <td>${pos.contractor_name || pos.supplier_name || '-'}</td>
                <td>${pos.folder_category_name || pos.folder_category_id || '-'}</td>
                <td>${pos.catman_fio || '-'}</td>
            </tr>
        `).join('');

            // Load email template
            const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', scenario.template);
            let htmlBody = await fs.readFile(templatePath, 'utf-8');

            // Get catman email from enriched data or fallback
            const catmanEmail = newPositions[0]?.catman_email || 'km@korzinka.uz';

            // Replace template variables
            htmlBody = htmlBody
                .replace(/#{positionsCount}/g, newPositions.length.toString())
                .replace(/#{positionsTable}/g, positionsTable)
                .replace(/#{catmanEmail}/g, catmanEmail)
                .replace(/#{currentDate}/g, new Date().toLocaleDateString('ru-RU') + ' ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));

            const subject = scenario.subject.replace(/#{positionsCount}/g, newPositions.length.toString());

            // PRODUCTION MODE: Send to real KAM emails from enriched data
            const kamEmails = [...new Set(
                newPositions
                    .map(pos => pos.kam_email_enriched || pos.kam_email)
                    .filter(email => email && email.trim() !== '')
            )];
            const toRecipients = kamEmails.length > 0 ? kamEmails : scenario.recipients.to.filter((email: string) => email && email.trim() !== '');
                
            const ccRecipients = scenario.recipients.cc.filter((email: string) => email && email.trim() !== '');
            // Add user to BCC as requested
            const bccRecipients = ['s.komalov@korzinka.uz', ...scenario.recipients.bcc.filter((email: string) => email && email.trim() !== '')];

            if (toRecipients.length === 0) {
                return NextResponse.json({ error: 'No valid recipients found for KAM notification' }, { status: 400 });
            }

            const mailOptions = {
                from: process.env.SMTP_USER,
                to: toRecipients,
                cc: ccRecipients.length > 0 ? ccRecipients : undefined,
                bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
                subject: subject,
                html: htmlBody,
            };

            await transporter.sendMail(mailOptions);

            // Log the sent email with change dates for future comparison
            const requestIds = newPositions.map(pos => pos.request_position_id);
            const requestChangeDates = newPositions.reduce((acc, pos) => {
                acc[pos.request_position_id] = pos.folder_change_datetime || '';
                return acc;
            }, {} as Record<string, string>);
            
            EmailLogger.logEmail(
                'kam_notification',
                requestIds,
                toRecipients.join(', '),
                subject,
                requestChangeDates
            );

            const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
            return NextResponse.json({
                message: `Successfully sent KAM notification with ${newPositions.length} positions requiring revision${categoryMsg}`
            }, { status: 200 });

        } else {
            // --- Original logic for other scenarios ---
            const toRecipients = scenario.recipients.to.filter(email => email && email.trim() !== '');
            const ccRecipients = scenario.recipients.cc.filter(email => email && email.trim() !== '');
            const bccRecipients = scenario.recipients.bcc.filter(email => email && email.trim() !== '');

            if (toRecipients.length === 0) {
                return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
            }

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
                to: toRecipients.join(', '),
                cc: ccRecipients.length > 0 ? ccRecipients.join(', ') : undefined,
                bcc: bccRecipients.length > 0 ? bccRecipients.join(', ') : undefined,
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
    } catch (error) {
        console.error(`Error processing scenario '${scenarioId}':`, error);
        return NextResponse.json({ error: 'Failed to send email.', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}
