import { Client, QueryResult, FieldDef } from 'pg';
import { KeycloakClient } from '../keycloak/client';
import { CellValue } from '../sheets/exporter';

export interface DataProcessor {
  processData(queryResult: QueryResult, keycloakClient?: KeycloakClient): Promise<ProcessedData>;
}

export interface ProcessedData {
  columns: string[];
  data: CellValue[][];
  metadata?: {
    totalRows: number;
    processedRows: number;
    enrichedRows: number;
  };
}

export class StandardDataProcessor implements DataProcessor {
  async processData(queryResult: QueryResult, keycloakClient?: KeycloakClient): Promise<ProcessedData> {
    const originalColumns = queryResult.fields.map((field: FieldDef) => field.name);
    
    // Add enrichment columns if Keycloak client is provided
    const columns = keycloakClient 
      ? [...originalColumns, 'catman_email', 'catman_phone', 'kam_email_enriched', 'kam_fio_enriched']
      : originalColumns;

    const processedData: CellValue[][] = [];
    let enrichedRows = 0;

    for (const row of queryResult.rows) {
      const rowValues = originalColumns.map(col => {
        const value = row[col];
        return this.formatValue(value);
      });

      // Add Keycloak enrichment if available
      if (keycloakClient) {
        // Catman enrichment
        const fio = row.catman_fio;
        let catman_email: string | null = null;
        let catman_phone: string | null = null;

        if (fio) {
          try {
            const keycloakUser = await keycloakClient.findUserByName(fio);
            catman_email = keycloakUser.email;
            catman_phone = keycloakUser.phone;
          } catch (error) {
            console.warn(`Failed to enrich catman data for user: ${fio}`, error);
          }
        }

        // KAM enrichment - if kam_email or kam_fio is empty but folder_creator_sub exists
        let kam_email_enriched: string | null = row.kam_email || null;
        let kam_fio_enriched: string | null = row.kam_fio || null;

        if ((!kam_email_enriched || !kam_fio_enriched) && row.folder_creator_sub) {
          try {
            const keycloakUser = await keycloakClient.findUserById(row.folder_creator_sub);
            if (keycloakUser.email || keycloakUser.firstName || keycloakUser.lastName || keycloakUser.username) {
              kam_email_enriched = kam_email_enriched || keycloakUser.email;
              kam_fio_enriched = kam_fio_enriched || (keycloakUser.firstName && keycloakUser.lastName 
                ? `${keycloakUser.firstName} ${keycloakUser.lastName}` 
                : keycloakUser.username);
              enrichedRows++;
            }
          } catch (error) {
            console.warn(`Failed to enrich KAM data for user ID: ${row.folder_creator_sub}`, error);
          }
        }

        processedData.push([...rowValues, catman_email, catman_phone, kam_email_enriched, kam_fio_enriched]);
      } else {
        processedData.push(rowValues);
      }
    }

    return {
      columns,
      data: processedData,
      metadata: {
        totalRows: queryResult.rows.length,
        processedRows: processedData.length,
        enrichedRows,
      },
    };
  }

  private formatValue(value: any): CellValue {
    if (value === null || value === undefined) {
      return null;
    }
    
    if (value instanceof Date) {
      return this.toGoogleSheetsSerialNumber(value);
    }
    
    return value;
  }

  private toGoogleSheetsSerialNumber(date: Date): number {
    const unixEpochDays = date.getTime() / 86400000;
    return unixEpochDays + 25569;
  }
}

export class MinimalDataProcessor implements DataProcessor {
  async processData(queryResult: QueryResult): Promise<ProcessedData> {
    const columns = queryResult.fields.map((field: FieldDef) => field.name);
    
    const data = queryResult.rows.map(row => 
      columns.map(col => {
        const value = row[col];
        return value instanceof Date 
          ? this.toGoogleSheetsSerialNumber(value) 
          : value;
      })
    );

    return {
      columns,
      data,
      metadata: {
        totalRows: queryResult.rows.length,
        processedRows: data.length,
        enrichedRows: 0,
      },
    };
  }

  private toGoogleSheetsSerialNumber(date: Date): number {
    const unixEpochDays = date.getTime() / 86400000;
    return unixEpochDays + 25569;
  }
}