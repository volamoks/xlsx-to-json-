import { sheets_v4 } from 'googleapis';
import { getGoogleSheetsClient } from '@/app/lib/googleSheetsAuth';

export type CellValue = string | number | boolean | Date | null;

export interface ExportOptions {
  spreadsheetId: string;
  sheetName: string;
  clearExisting?: boolean;
  createSheetIfNotExists?: boolean;
}

export class SheetsExporter {
  private sheets: sheets_v4.Sheets;

  constructor() {
    this.sheets = getGoogleSheetsClient();
  }

  async exportData(
    columns: string[],
    data: CellValue[][],
    options: ExportOptions
  ): Promise<void> {
    try {
      console.info(`Starting export of ${data.length} rows to Google Sheet: ${options.spreadsheetId}, Tab: ${options.sheetName}`);

      // Create sheet if it doesn't exist
      if (options.createSheetIfNotExists) {
        await this.ensureSheetExists(options.spreadsheetId, options.sheetName);
      }

      // Clear existing content if requested
      if (options.clearExisting) {
        await this.clearSheet(options.spreadsheetId, options.sheetName);
      }

      // Prepare data for export
      const rowsToWrite: CellValue[][] = [columns, ...data];

      if (rowsToWrite.length > 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: options.spreadsheetId,
          range: `${options.sheetName}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: rowsToWrite,
          },
        });

        console.log(`[INFO] Successfully wrote ${data.length} data rows (plus headers) to Google Sheet "${options.sheetName}".`);
      } else {
        console.log('[INFO] No data to write to the sheet.');
      }

    } catch (error) {
      console.error("Error exporting data to Google Sheet:", error);
      throw error;
    }
  }

  private async ensureSheetExists(spreadsheetId: string, sheetName: string): Promise<void> {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
      const existingSheet = spreadsheet.data.sheets?.find(
        (s: sheets_v4.Schema$Sheet) => s.properties?.title === sheetName
      );

      if (!existingSheet) {
        console.log(`Creating new sheet: ${sheetName}`);
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: sheetName }
              }
            }],
          },
        });
      }
    } catch (error) {
      console.error(`Error ensuring sheet exists: ${error}`);
      throw error;
    }
  }

  private async clearSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    try {
      const rangeToClear = `${sheetName}!A1:ZZ`;
      console.log(`[INFO] Clearing existing content from range: ${rangeToClear}`);
      
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: rangeToClear,
      });
      
      console.log('[INFO] Cleared existing sheet content.');
    } catch (error) {
      console.error(`Error clearing sheet: ${error}`);
      throw error;
    }
  }

  async formatColumns(
    spreadsheetId: string,
    sheetName: string,
    columnFormats: Array<{
      columnIndex: number;
      format: 'TEXT' | 'NUMBER' | 'DATE' | 'CURRENCY';
    }>
  ): Promise<void> {
    try {
      // Get sheet ID
      const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
      const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName);
      
      if (!sheet || sheet.properties?.sheetId === undefined) {
        console.warn(`Could not find sheet "${sheetName}" for formatting`);
        return;
      }

      const requests = columnFormats.map(({ columnIndex, format }) => ({
        repeatCell: {
          range: {
            sheetId: sheet.properties.sheetId,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
            startRowIndex: 1 // Skip header
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: format,
              },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      }));

      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });

      console.log(`[INFO] Applied formatting to ${columnFormats.length} columns`);
    } catch (error) {
      console.error("Error formatting columns:", error);
      // Don't throw - formatting is not critical
    }
  }
}