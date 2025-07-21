import fs from 'fs';
import path from 'path';

export interface EmailLogEntry {
    date: string;
    scenario: string;
    request_ids: string[];
    recipient: string;
    subject: string;
}

export interface EmailLog {
    entries: EmailLogEntry[];
}

const EMAIL_LOG_FILE = path.join(process.cwd(), 'email_log.json');

export class EmailLogger {
    private static loadLog(): EmailLog {
        try {
            if (fs.existsSync(EMAIL_LOG_FILE)) {
                const data = fs.readFileSync(EMAIL_LOG_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn('Could not load email log, using empty log:', error);
        }
        return { entries: [] };
    }

    private static saveLog(log: EmailLog): void {
        try {
            fs.writeFileSync(EMAIL_LOG_FILE, JSON.stringify(log, null, 2));
        } catch (error) {
            console.error('Failed to save email log:', error);
        }
    }

    public static logEmail(scenario: string, requestIds: string[], recipient: string, subject: string): void {
        const log = this.loadLog();
        
        const entry: EmailLogEntry = {
            date: new Date().toISOString(),
            scenario,
            request_ids: requestIds,
            recipient,
            subject
        };

        log.entries.push(entry);
        this.saveLog(log);
    }

    public static getSentRequestIds(scenario: string, daysBack: number = 30): string[] {
        const log = this.loadLog();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);

        const sentIds: string[] = [];
        
        for (const entry of log.entries) {
            if (entry.scenario === scenario && new Date(entry.date) >= cutoffDate) {
                sentIds.push(...entry.request_ids);
            }
        }

        return [...new Set(sentIds)]; // Remove duplicates
    }

    public static getLogHistory(scenario?: string, limit: number = 50): EmailLogEntry[] {
        const log = this.loadLog();
        let entries = log.entries;

        if (scenario) {
            entries = entries.filter(entry => entry.scenario === scenario);
        }

        return entries
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, limit);
    }

    public static clearOldLogs(daysToKeep: number = 90): void {
        const log = this.loadLog();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        log.entries = log.entries.filter(entry => new Date(entry.date) >= cutoffDate);
        this.saveLog(log);
    }
}