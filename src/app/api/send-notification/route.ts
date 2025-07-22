import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import nodemailer from 'nodemailer';
import type { MailOptions } from 'nodemailer/lib/json-transport';
import type { Attachment } from 'nodemailer/lib/mailer';
import { getSheetData, updateSheetRows, SheetRow } from '@/app/lib/googleSheetsAuth';
import { EmailLogger } from '@/lib/email-logging';
import { getMailConfigForProcess, MailConfig } from '@/lib/mails-config';
import { generateExcelByTemplate, ExcelTemplateData } from '@/lib/excel-templates';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { statusId, categoryId, testMode = false } = body;

    if (statusId === undefined || statusId === null || statusId === '') {
        return NextResponse.json({ error: 'statusId is required' }, { status: 400 });
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
        return NextResponse.json({ error: 'SMTP configuration is missing' }, { status: 500 });
    }

    try {
        const mailConfigs = await getMailConfigForProcess(statusId.toString(), categoryId?.toString());

        if (mailConfigs.length === 0) {
            return NextResponse.json({
                error: `No mail configuration found for status ${statusId}${categoryId ? ` and category ${categoryId}` : ''}`
            }, { status: 400 });
        }

        const transporter = nodemailer.createTransport(smtpConfig);
        const sheetName = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';
        const sheetData = await getSheetData(sheetName, false) as SheetRow[];

        let filteredPositions = sheetData.filter(item =>
            String(item.request_position_status_id).trim() === String(statusId).trim()
        );

        if (categoryId) {
            filteredPositions = filteredPositions.filter(item =>
                String(item.folder_category_id).trim() === (parseInt(categoryId.toString()) + 1).toString()
            );
        }

        if (filteredPositions.length === 0) {
            const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
            return NextResponse.json({
                message: `No positions with status ${statusId} found${categoryMsg}`
            }, { status: 200 });
        }

        const scenarioId = `status_${statusId}${categoryId ? `_cat_${categoryId}` : ''}`;
        const currentRequests = filteredPositions.map(pos => ({
            id: String(pos.request_position_id),
            changeDateTime: String(pos.folder_change_datetime || '')
        }));

        const sentIds = EmailLogger.getSentRequestIds(scenarioId, 30);
        const excludeIds = EmailLogger.getRequestsToExclude(scenarioId, currentRequests, 7);
        const allExcludeIds = [...new Set([...sentIds, ...excludeIds])];

        const newPositions = filteredPositions.filter(pos =>
            !allExcludeIds.includes(String(pos.request_position_id))
        );

        if (newPositions.length === 0) {
            const categoryMsg = categoryId ? ` for category ${categoryId}` : '';
            return NextResponse.json({
                message: `All positions have already been sent${categoryMsg}`
            }, { status: 200 });
        }

        let emailsSent = 0;
        const results: string[] = [];

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

        const hasUpdateField = mailConfigs.some(config =>
            config.xlsx_template === 'icpu' || config.xlsx_template === 'translation'
        );

        if (hasUpdateField && newPositions.length > 0) {
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
    positions: SheetRow[],
    transporter: nodemailer.Transporter,
    testMode: boolean,
    scenarioId: string,
    statusId: string | number,
    categoryId?: string | number
): Promise<{ message: string; sent: boolean }> {

    let toRecipients: string[] = [];
    let ccRecipients: string[] = [];

    if (testMode) {
        toRecipients = ['s.komalov@korzinka.uz'];
    } else {
        if (mailConfig.use_column_data) {
            const columnName = mailConfig.to_mail;
            const emailStrings = positions
                .map(pos => pos[columnName])
                .filter(email => typeof email === 'string' && email.trim() !== '' && email.includes('@'));

            // Обработка нескольких email через запятую
            const allEmails = emailStrings.flatMap(email =>
                email.split(',').map(e => e.trim()).filter(e => e.includes('@'))
            );

            const uniqueEmails = [...new Set(allEmails)];
            toRecipients = uniqueEmails;

            if (mailConfig.cc_mail) {
                ccRecipients = [mailConfig.cc_mail];
            }
        } else {
            // Обработка нескольких email через запятую в статичном to_mail
            toRecipients = mailConfig.to_mail.split(',').map(e => e.trim()).filter(e => e.includes('@'));
            if (mailConfig.cc_mail) {
                ccRecipients = mailConfig.cc_mail.split(',').map(e => e.trim()).filter(e => e.includes('@'));
            }
        }
    }

    if (toRecipients.length === 0) {
        return { message: 'No recipients found for this notification.', sent: false };
    }

    const templatePath = path.join(process.cwd(), 'src', 'lib', 'email-templates', 'universal_notification.html');
    let htmlBody: string;

    try {
        htmlBody = await fs.readFile(templatePath, 'utf-8');
    } catch (_error) {
        console.warn(`Template universal_notification.html not found, using default`);
        htmlBody = `
        <h2>Новая заявка</h2>
        <p>Количество позиций: #{positionsCount}</p>
        <table border="1">
            <thead>
                <tr><th>Заявка</th><th>SKU</th><th>Название</th><th>Поставщик</th></tr>
            </thead>
            <tbody>#{positionsTable}</tbody>
        </table>
        `;
    }

    let subject = `Новая заявка}`;
    const attachments: Attachment[] = [];
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

    const categoryName = positions[0]?.folder_category_name || `Категория ${categoryId}`;
    const positionsCount = positions.length.toString();
    const kamFio = String(positions[0]?.kam_fio_enriched || positions[0]?.kam_fio || 'Не указан');
    const kamEmail = String(positions[0]?.kam_email_enriched || positions[0]?.kam_email || 'Не указан');
    const catmanFio = String(positions[0]?.catman_fio || 'Не указан');
    const catmanEmail = String(positions[0]?.catman_email || 'Не указан');

    let emailTitle = `Новая заявка`;
    let alertType = 'info';
    let alertStrongText = 'Инфо:';
    let alertBodyText = mailConfig.alert_body_text || `Поступило <strong>${positionsCount}</strong> новых позиций в статусе "Требует проверки КМ" по категории <strong>${categoryName}</strong>.`;

    // Упрощенный текст для статуса 7 без упоминания категории и статуса
    if (String(statusId) === '7') {
        alertBodyText = mailConfig.alert_body_text || `Поступило <strong>${positionsCount}</strong> новых позиций.`;
    }

    let mainMessage = 'Пожалуйста, ознакомьтесь с позициями, которые требуют вашего внимания:';
    const additionalTableHeaders = '';
    let contactTitle = 'Контакты:';
    let contactFio = '';
    let contactEmail = '';
    let buttonText = 'Перейти в CDE';
    let actionItems = `
        <li>Проверьте каждую позицию в системе CDE</li>
        <li>Примите решение по каждой позиции (одобрить/отклонить)</li>
        <li>Переведите заявку в следующий статус</li>
    `;
    let headerType = 'info'; // Default header type
    let headerIcon = ''; // Default header icon
    let contactInfoBlock = `
        <div class="contact-info">
            <h4>#{contactTitle}</h4>
            <p><strong>Категория:</strong> #{categoryName}</p>
            <p><strong>ФИО:</strong> #{contactFio}</p>
            <p><strong>Email:</strong> #{contactEmail}</p>
        </div>
    `;

    // Dynamically set to_name based on mailConfig.to_name if use_column_data is true
    let dynamicToName = mailConfig.to_name;
    if (mailConfig.use_column_data && positions.length > 0) {
        const nameColumn = mailConfig.to_name; // This is now expected to be a column name like 'kam_fio_enriched'
        dynamicToName = String(positions[0]?.[nameColumn] || mailConfig.to_name);
    }


    // Customize content based on statusId
    switch (String(statusId)) {
        case '0': // Отклонена
            emailTitle = 'Заявка отклонена';
            alertType = 'danger';
            alertStrongText = '🚫 Заявка отклонена!';
            // alertBodyText is now taken from mailConfig.alert_body_text
            mainMessage = 'Пожалуйста, ознакомьтесь с причинами отклонения и подготовьте исправленную заявку.';
            contactTitle = 'Контакты КМ:';
            contactFio = catmanFio;
            contactEmail = catmanEmail;
            buttonText = 'Перейти в CDE для обработки заявок';
            actionItems = `
                <li>Проверьте каждую позицию в системе CDE</li>
                <li>Внесите необходимые изменения</li>
                <li>Обратитесь к КМ при возникновении вопросов</li>
                <li>При необходимости заполнить новую заявку/li>
            `;
            headerType = 'danger';
            headerIcon = '🚫';
            break;
        case '2': // Требует проверки КМ
            emailTitle = 'Новые заявки на проверку';
            alertType = 'info';
            alertStrongText = 'Инфо:';
            // alertBodyText is now taken from mailConfig.alert_body_text
            mainMessage = 'Пожалуйста, ознакомьтесь с позициями, которые требуют вашего внимания:';
            contactTitle = 'КАМ, ответственный за поставщика:';
            contactFio = kamFio;
            contactEmail = kamEmail;
            buttonText = 'Перейти в CDE для обработки заявок';
            actionItems = `
                <li>Проверьте каждую позицию в системе CDE</li>
                <li>Примите решение по каждой позиции (одобрить/отклонить)</li>
                <li>Переведите заявку в следующий статус</li>
            `;
            headerType = 'info';
            headerIcon = '📝';
            break;
        case '5': // Требует доработки
            emailTitle = 'Заявка требует доработки';
            alertType = 'alert'; // Yellow alert
            alertStrongText = '⚠️ Внимание!';
            // alertBodyText is now taken from mailConfig.alert_body_text
            mainMessage = 'Пожалуйста, ознакомьтесь с позициями, которые требуют вашего внимания:';
            contactTitle = 'Контакты КМ:';
            contactFio = catmanFio;
            contactEmail = catmanEmail;
            buttonText = 'Перейти в CDE для обработки заявок';
            actionItems = `
                <li>Проверьте каждую позицию в системе CDE</li>
                <li>Внесите необходимые изменения</li>
                <li>Обратитесь к КМ при возникновении вопросов</li>
                <li>Переведите заявку в следующий статус после доработки</li>
            `;
            headerType = 'alert';
            headerIcon = '🔄';
            break;
        case '7': // Уведомление по статусу 7 (аналогично листингу/ИКПУ)
            emailTitle = 'Новая заявка';
            alertType = 'info';
            alertStrongText = 'Инфо:';
            mainMessage = 'Пожалуйста, ознакомьтесь с позициями:';
            contactTitle = ''; // No contact info for status 7
            contactFio = '';
            contactEmail = '';
            buttonText = 'Перейти в CDE';
            actionItems = `
                <li>Проверьте позиции в системе CDE</li>
                <li>Выполните необходимые действия</li>
            `;
            headerType = 'info';
            headerIcon = '🔔'; // Bell icon for general notification
            contactInfoBlock = ''; // Remove contact info block for these statuses
            break;
        case 'listing': // Листинг (предполагаемый статус для листинга)
        case 'icpu': // ИКПУ код (предполагаемый статус для ИКПУ)
            contactInfoBlock = ''; // Remove contact info block for these statuses
            // alertBodyText is now taken from mailConfig.alert_body_text
            break;
        default:
            // Default values are already set above
            break;
    }

    // Conditionally remove category from contact info block if categoryName is empty or not relevant
    if (!categoryName || String(categoryName).includes('undefined') || String(categoryName).includes('null') || String(categoryName).includes('Категория undefined') || String(categoryName).includes('Категория null')) {
        contactInfoBlock = contactInfoBlock.replace(`<p><strong>Категория:</strong> #{categoryName}</p>`, '');
    }

    // Conditionally remove contact info block if mailConfig.show_contact_info is false
    if (!mailConfig.show_contact_info) {
        contactInfoBlock = '';
    }


    const positionsTable = positions.map(pos => `
        <tr>
            <td>${pos.request_position_folder_id || pos.folder_id || '-'}</td>
            <td>${pos.request_position_id}</td>
            <td>${pos.name_by_doc}</td>
            <td>${pos.contractor_name || pos.supplier_name || '-'}</td>
            <td>${pos.folder_category_name || pos.category_name || '-'}</td>
            <td>${pos.catman_fio || 'Не указан'}</td>
        </tr>
    `).join('');

    htmlBody = htmlBody
        .replace(/#{emailTitle}/g, emailTitle)
        .replace(/#{alertType}/g, alertType)
        .replace(/#{alertStrongText}/g, alertStrongText)
        .replace(/#{alertBodyText}/g, alertBodyText)
        .replace(/#{mainMessage}/g, mainMessage)
        .replace(/#{additionalTableHeaders}/g, additionalTableHeaders)
        .replace(/#{contactTitle}/g, contactTitle)
        .replace(/#{contactFio}/g, contactFio)
        .replace(/#{contactEmail}/g, contactEmail)
        .replace(/#{buttonText}/g, buttonText)
        .replace(/#{actionItems}/g, actionItems)
        .replace(/#{categoryName}/g, String(categoryName))
        .replace(/#{positionsCount}/g, positionsCount)
        .replace(/#{positionsTable}/g, positionsTable)
        .replace(/#{fileName}/g, excelData?.fileName || '')
        .replace(/#{to_name}/g, dynamicToName) // Use dynamicToName here
        .replace(/#{kam_fio}/g, String(kamFio))
        .replace(/#{kam_email}/g, String(kamEmail))
        .replace(/#{catman_fio}/g, String(catmanFio))
        .replace(/#{catman_email}/g, String(catmanEmail))
        .replace(/#{currentDate}/g, new Date().toLocaleDateString('ru-RU') + ' ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
        .replace(/#{headerType}/g, headerType)
        .replace(/#{headerIcon}/g, headerIcon)
        .replace(/#{contactInfoBlock}/g, contactInfoBlock); // Replace contact info block

    subject = subject
        .replace(/#{categoryName}/g, String(categoryName))
        .replace(/#{positionsCount}/g, positionsCount)
        .replace(/#{fileName}/g, excelData?.fileName || '');

    const mailOptions: MailOptions = {
        from: process.env.SMTP_USER,
        to: toRecipients,
        cc: ccRecipients.length > 0 ? ccRecipients : undefined,
        subject: testMode ? `[TEST] ${subject}` : subject,
        html: htmlBody,
        attachments: attachments.length > 0 ? attachments : undefined
    };

    await transporter.sendMail(mailOptions);

    const requestIds = positions.map(pos => String(pos.request_position_id));
    const requestChangeDates = positions.reduce((acc, pos) => {
        acc[String(pos.request_position_id)] = String(pos.folder_change_datetime || '');
        return acc;
    }, {} as Record<string, string>);
    const requestSentDates = positions.reduce((acc, pos) => {
        acc[String(pos.request_position_id)] = new Date().toISOString();
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