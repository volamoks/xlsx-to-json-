import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import nodemailer from 'nodemailer';
import { getSheetData, updateSheetRows } from '@/app/lib/googleSheetsAuth';
import { EmailLogger } from '@/lib/email-logging';
import { getMailConfigForProcess, MailConfig } from '@/lib/mails-config';
import { generateExcelByTemplate, ExcelTemplateData } from '@/lib/excel-templates';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { statusId, categoryId, testMode = false } = body;

    if (statusId === undefined || statusId === null || statusId === '') {
        return NextResponse.json({ error: 'statusId is required' }, { status: 400 });
    }

    // Setup SMTP
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
        return NextResponse.json({ error: 'SMTP configuration is missing' }, { status: 500 });
    }

    try {
        // Get mail configuration for this status and category
        const mailConfigs = await getMailConfigForProcess(statusId.toString(), categoryId?.toString());
        
        if (mailConfigs.length === 0) {
            return NextResponse.json({ 
                error: `No mail configuration found for status ${statusId}${categoryId ? ` and category ${categoryId}` : ''}` 
            }, { status: 400 });
        }

        const transporter = nodemailer.createTransporter(smtpConfig);
        const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
        const sheetData = await getSheetData(sheetName);

        // Filter data based on status
        let filteredPositions = sheetData.filter(item => item.request_position_status_id === statusId.toString());
        
        // Apply category filter if specified
        if (categoryId) {
            filteredPositions = filteredPositions.filter(item => 
                item.folder_category_id === (parseInt(categoryId.toString()) + 1).toString()
            );
        }

        if (filteredPositions.length === 0) {
            const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
            return NextResponse.json({
                message: `No positions with status ${statusId} found${categoryMsg}`
            }, { status: 200 });
        }

        // Check for already sent positions (exclude duplicates)
        const scenarioId = `status_${statusId}${categoryId ? `_cat_${categoryId}` : ''}`;
        const currentRequests = filteredPositions.map(pos => ({
            id: pos.request_position_id,
            changeDateTime: pos.folder_change_datetime || ''
        }));
        
        const sentIds = EmailLogger.getSentRequestIds(scenarioId, 30);
        const excludeIds = EmailLogger.getRequestsToExclude(scenarioId, currentRequests, 7);
        const allExcludeIds = [...new Set([...sentIds, ...excludeIds])];
        
        const newPositions = filteredPositions.filter(pos =>
            !allExcludeIds.includes(pos.request_position_id)
        );

        if (newPositions.length === 0) {
            const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
            return NextResponse.json({
                message: `All positions have already been sent${categoryMsg}`
            }, { status: 200 });
        }

        let emailsSent = 0;
        const results: string[] = [];

        // Process each mail configuration
        for (const mailConfig of mailConfigs) {
            const result = await sendEmailForConfig(
                mailConfig, 
                newPositions, 
                transporter, 
                testMode, 
                scenarioId, 
                statusId, 
                categoryId
            );
            results.push(result.message);
            emailsSent += result.sent ? 1 : 0;
        }

        // Update sheet if needed (for ICPU/Translation tracking)
        const hasUpdateField = mailConfigs.some(config => 
            config.xlsx_template === 'icpu' || config.xlsx_template === 'translation'
        );
        
        if (hasUpdateField) {
            const updateField = mailConfigs[0].xlsx_template === 'icpu' ? 'icpu_check_sent_at' : 'translation_sent_at';
            const updatedRows = newPositions.map(row => ({ 
                ...row, 
                [updateField]: new Date().toISOString() 
            }));
            await updateSheetRows(sheetName, updatedRows);
        }

        const testPrefix = testMode ? '[TEST MODE] ' : '';
        const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
        
        return NextResponse.json({
            message: `${testPrefix}Successfully sent ${emailsSent} email(s) for status ${statusId} with ${newPositions.length} positions${categoryMsg}. ${results.join('; ')}`
        }, { status: 200 });

    } catch (error) {
        console.error(`Error processing status ${statusId}:`, error);
        return NextResponse.json({ 
            error: 'Failed to send notification.', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        }, { status: 500 });
    }
}

async function sendEmailForConfig(
    mailConfig: MailConfig,
    positions: any[],
    transporter: nodemailer.Transporter,
    testMode: boolean,
    scenarioId: string,
    statusId: string | number,
    categoryId?: string | number
): Promise<{ message: string; sent: boolean }> {
    
    // Generate recipients
    let toRecipients: string[] = [];
    let ccRecipients: string[] = [];

    if (testMode) {
        toRecipients = ['s.komalov@korzinka.uz'];
        ccRecipients = [];
    } else {
        if (mailConfig.use_column_data) {
            // Extract emails from position data using column name from to_mail
            const columnName = mailConfig.to_mail; // e.g., "kam_email_enriched" or "kam_email"
            const uniqueEmails = [...new Set(
                positions
                    .map(pos => pos[columnName])
                    .filter(email => email && email.trim() !== '' && email.includes('@'))
            )];
            
            toRecipients = uniqueEmails.length > 0 ? uniqueEmails : ['s.komalov@korzinka.uz']; // fallback
            
            if (mailConfig.cc_mail) {
                ccRecipients = [mailConfig.cc_mail];
            }
        } else {
            // Use static email from config
            toRecipients = [mailConfig.to_mail];
            if (mailConfig.cc_mail) {
                ccRecipients = [mailConfig.cc_mail];
            }
        }
    }

    // Load email template
    const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', mailConfig.email_template);
    let htmlBody: string;
    
    try {
        htmlBody = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
        console.warn(`Template ${mailConfig.email_template} not found, using default`);
        htmlBody = `
        <h2>Уведомление по статусу ${statusId}</h2>
        <p>Количество позиций: #{positionsCount}</p>
        <table border="1">
            <thead>
                <tr><th>Заявка</th><th>SKU</th><th>Название</th><th>Поставщик</th></tr>
            </thead>
            <tbody>#{positionsTable}</tbody>
        </table>
        `;
    }

    let subject = `Уведомление по статусу ${statusId}`;

    // Generate Excel attachment if needed
    let attachments: any[] = [];
    let excelData: ExcelTemplateData | null = null;

    if (mailConfig.has_xlsx && mailConfig.xlsx_template) {
        try {
            excelData = generateExcelByTemplate(mailConfig.xlsx_template, positions);
            attachments.push({
                filename: excelData.fileName,
                content: excelData.buffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            subject += `: ${excelData.fileName}`;
        } catch (error) {
            console.error('Error generating Excel:', error);
        }
    }

    // Replace template variables
    const categoryName = positions[0]?.folder_category_name || `Категория ${categoryId}`;
    const positionsCount = positions.length.toString();

    // Generate positions table for email body
    const positionsTable = positions.map(pos => `
        <tr>
            <td>${pos.request_position_folder_id || pos.folder_id || '-'}</td>
            <td>${pos.request_position_id}</td>
            <td>${pos.name_by_doc}</td>
            <td>${pos.contractor_name || pos.supplier_name || '-'}</td>
        </tr>
    `).join('');

    htmlBody = htmlBody
        .replace(/#{categoryName}/g, categoryName)
        .replace(/#{positionsCount}/g, positionsCount)
        .replace(/#{positionsTable}/g, positionsTable)
        .replace(/#{fileName}/g, excelData?.fileName || '')
        .replace(/#{to_name}/g, mailConfig.to_name || '')
        .replace(/#{currentDate}/g, new Date().toLocaleDateString('ru-RU') + ' ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));

    subject = subject
        .replace(/#{categoryName}/g, categoryName)
        .replace(/#{positionsCount}/g, positionsCount)
        .replace(/#{fileName}/g, excelData?.fileName || '');

    // Send email
    const mailOptions: any = {
        from: process.env.SMTP_USER,
        to: toRecipients,
        cc: ccRecipients.length > 0 ? ccRecipients : undefined,
        subject: testMode ? `[TEST] ${subject}` : subject,
        html: htmlBody,
        attachments: attachments.length > 0 ? attachments : undefined
    };

    await transporter.sendMail(mailOptions);

    // Log the sent email
    const requestIds = positions.map(pos => pos.request_position_id);
    const requestChangeDates = positions.reduce((acc, pos) => {
        acc[pos.request_position_id] = pos.folder_change_datetime || '';
        return acc;
    }, {} as Record<string, string>);
    const requestSentDates = positions.reduce((acc, pos) => {
        acc[pos.request_position_id] = new Date().toISOString();
        return acc;
    }, {} as Record<string, string>);
    
    EmailLogger.logEmail(
        scenarioId,
        requestIds,
        toRecipients.join(', '),
        subject,
        requestChangeDates,
        requestSentDates
    );

    return {
        message: `Email sent to ${toRecipients.join(', ')}${ccRecipients.length > 0 ? ` (CC: ${ccRecipients.join(', ')})` : ''}`,
        sent: true
    };
}