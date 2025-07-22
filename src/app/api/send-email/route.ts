import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import nodemailer from 'nodemailer';
import emailConfig from '@/lib/email-config.json';

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
    attachment?: string;
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { scenarioId } = body;

    if (!scenarioId) {
        return NextResponse.json({ error: 'scenarioId is required' }, { status: 400 });
    }

    // Redirect to new unified API for supported notification types
    const unifiedNotificationTypes = [
        'category_manager_notification',
        'kam_notification',
        'listing_notification',
        'icpu_check',
        'translation_request'
    ];

    if (unifiedNotificationTypes.includes(scenarioId)) {
        // Forward the request to the new unified API
        const unifiedRequest = await fetch(new URL('/api/send-notification', req.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                notificationType: scenarioId,
                categoryId: body.categoryId,
                testMode: body.testMode || false
            })
        });

        const result = await unifiedRequest.json();
        return NextResponse.json(result, { status: unifiedRequest.status });
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

        // Handle remaining scenarios that are not yet migrated to unified API
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
        const attachmentContent = await fs.readFile(attachmentPath);
        const attachmentName = path.basename(attachmentPath);

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

    } catch (error) {
        console.error(`Error processing scenario '${scenarioId}':`, error);
        return NextResponse.json({ error: 'Failed to send email.', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}