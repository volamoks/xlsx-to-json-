export interface ParseResult<T> {
  data: T[];
  errors: string[];
  warnings: string[];
  metadata: {
    source: string;
    sourceType: 'xlsx' | 'csv' | 'postgres' | 'text';
    recordCount: number;
    parsedAt: Date;
    processingTime: number;
  };
}

export interface IParser<T> {
  parse(input: ArrayBuffer | string | { sql: string }): Promise<ParseResult<T>>;
  validate(input: ArrayBuffer | string | { sql: string }): Promise<boolean>;
  getSupportedFormats(): string[];
  getParserName(): string;
}

export interface RawUserData {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  supplier?: string;
  tin?: string;
  business_units?: string;
  notif_teams_destin?: string;
  notif_lang?: string;
  categories?: string;
  notif_telegram_destin?: string;
  Group?: string;
  role?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface PostgresUserData {
  username?: string;
  email: string;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  supplier?: string;
  tin?: string;
  categories?: string;
  telegram_id?: string;
  [key: string]: string | number | boolean | undefined;
}
