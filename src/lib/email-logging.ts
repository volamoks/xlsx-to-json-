import fs from 'fs';
import path from 'path';

export interface EmailLogEntry {
    date: string;
    scenario: string;
    request_ids: string[];
    recipient: string;
    subject: string;
    // Track folder change dates to detect updates
    request_change_dates?: Record<string, string>; // request_position_id -> folder_change_datetime
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

    public static logEmail(
        scenario: string, 
        requestIds: string[], 
        recipient: string, 
        subject: string,
        requestChangeDates?: Record<string, string>
    ): void {
        const log = this.loadLog();
        
        const entry: EmailLogEntry = {
            date: new Date().toISOString(),
            scenario,
            request_ids: requestIds,
            recipient,
            subject,
            request_change_dates: requestChangeDates
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

    /**
     * Get request IDs that should be excluded from email sending.
     * A request is excluded if it was already sent AND hasn't been updated since.
     */
    public static getRequestsToExclude(
        scenario: string, 
        currentRequests: Array<{id: string, changeDateTime: string}>,
        daysBack: number = 30
    ): string[] {
        const log = this.loadLog();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);

        const excludeIds: string[] = [];
        
        // Create a map of current request change dates
        const currentChangeDates = new Map(
            currentRequests.map(req => [req.id, req.changeDateTime])
        );

        for (const entry of log.entries) {
            if (entry.scenario === scenario && new Date(entry.date) >= cutoffDate) {
                // Check each logged request
                for (const requestId of entry.request_ids) {
                    const currentChangeDate = currentChangeDates.get(requestId);
                    const lastLoggedChangeDate = entry.request_change_dates?.[requestId];
                    
                    if (currentChangeDate && lastLoggedChangeDate) {
                        // If the change date hasn't changed, exclude this request
                        if (currentChangeDate === lastLoggedChangeDate) {
                            excludeIds.push(requestId);
                        }
                    } else if (!currentChangeDate) {
                        // Request no longer exists, exclude it
                        excludeIds.push(requestId);
                    }
                }
            }
        }

        return [...new Set(excludeIds)]; // Remove duplicates
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