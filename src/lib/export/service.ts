import { DatabaseConnection, createDatabaseConfig } from '../database/connection';
import { KeycloakClient } from '../keycloak/client';
import { SheetsExporter } from '../sheets/exporter';
import { StandardDataProcessor, MinimalDataProcessor, DataProcessor } from '../data/processor';
import { getQuery, QueryType } from '../database/queries';

export interface ExportConfig {
  // Google Sheets config
  spreadsheetId: string;
  sheetName: string;
  
  // Data processing options
  queryType?: QueryType;
  enableKeycloakEnrichment?: boolean;
  rowLimit?: number;
  
  // Export options
  clearExisting?: boolean;
  createSheetIfNotExists?: boolean;
  formatColumns?: boolean;
}

export interface ExportResult {
  success: boolean;
  message: string;
  rowCount?: number;
  enrichedRows?: number;
  metadata?: any;
}

export class DatabaseToSheetsExportService {
  private database: DatabaseConnection;
  private keycloak?: KeycloakClient;
  private sheets: SheetsExporter;

  constructor() {
    const dbConfig = createDatabaseConfig();
    this.database = new DatabaseConnection(dbConfig);
    this.sheets = new SheetsExporter();
    
    // Initialize Keycloak client if environment variables are available
    try {
      this.keycloak = new KeycloakClient();
    } catch (error) {
      console.warn('Keycloak client initialization failed. Data enrichment will be disabled.', error);
    }
  }

  async export(config: ExportConfig): Promise<ExportResult> {
    console.info("Starting database to Google Sheets export");

    try {
      // Validate configuration
      this.validateConfig(config);

      // Connect to database
      const client = await this.database.connect();
      
      // Execute query
      const query = getQuery(config.queryType);
      const finalQuery = config.rowLimit 
        ? `${query} LIMIT ${config.rowLimit}` 
        : query;
      
      console.info(`Executing query with ${config.rowLimit || 'no'} row limit`);
      const queryResult = await client.query(finalQuery);

      if (queryResult.rows.length === 0) {
        return { 
          success: true, 
          message: "No data found in database", 
          rowCount: 0 
        };
      }

      // Process data
      const processor = this.getDataProcessor(config);
      const processedData = await processor.processData(
        queryResult, 
        config.enableKeycloakEnrichment ? this.keycloak : undefined
      );

      // Export to Google Sheets
      await this.sheets.exportData(
        processedData.columns,
        processedData.data,
        {
          spreadsheetId: config.spreadsheetId,
          sheetName: config.sheetName,
          clearExisting: config.clearExisting ?? true,
          createSheetIfNotExists: config.createSheetIfNotExists ?? true,
        }
      );

      // Apply column formatting if requested
      if (config.formatColumns) {
        await this.applyColumnFormatting(config, processedData.columns);
      }

      return {
        success: true,
        message: "Data exported successfully to Google Sheets",
        rowCount: processedData.data.length,
        enrichedRows: processedData.metadata?.enrichedRows,
        metadata: processedData.metadata,
      };

    } catch (error) {
      console.error("Export failed:", error);
      return {
        success: false,
        message: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      await this.database.disconnect();
    }
  }

  private validateConfig(config: ExportConfig): void {
    if (!config.spreadsheetId) {
      throw new Error("spreadsheetId is required");
    }
    if (!config.sheetName) {
      throw new Error("sheetName is required");
    }
  }

  private getDataProcessor(config: ExportConfig): DataProcessor {
    if (config.enableKeycloakEnrichment && this.keycloak) {
      return new StandardDataProcessor();
    }
    return new MinimalDataProcessor();
  }

  private async applyColumnFormatting(config: ExportConfig, columns: string[]): Promise<void> {
    // Define column formatting rules
    const formatRules = [
      { columnName: 'icpu_code', format: 'TEXT' as const },
      { columnName: 'barcode', format: 'TEXT' as const },
      { columnName: 'contractor_tin_number', format: 'TEXT' as const },
      { columnName: 'document_date', format: 'DATE' as const },
      { columnName: 'folder_creation_datetime', format: 'DATE' as const },
      { columnName: 'folder_change_datetime', format: 'DATE' as const },
    ];

    const columnFormats = formatRules
      .map(rule => {
        const columnIndex = columns.indexOf(rule.columnName);
        return columnIndex !== -1 
          ? { columnIndex, format: rule.format }
          : null;
      })
      .filter(Boolean) as Array<{ columnIndex: number; format: 'TEXT' | 'DATE' }>;

    if (columnFormats.length > 0) {
      await this.sheets.formatColumns(
        config.spreadsheetId,
        config.sheetName,
        columnFormats
      );
    }
  }
}

// Convenience function for backward compatibility
export async function exportDbToGoogleSheet(): Promise<ExportResult> {
  const service = new DatabaseToSheetsExportService();
  
  const config: ExportConfig = {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID!,
    sheetName: process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1',
    queryType: 'FULL_EXPORT',
    enableKeycloakEnrichment: true,
    rowLimit: 10000,
    clearExisting: true,
    createSheetIfNotExists: true,
    formatColumns: true,
  };

  if (!config.spreadsheetId) {
    return {
      success: false,
      message: "GOOGLE_SPREADSHEET_ID environment variable is required",
    };
  }

  return service.export(config);
}