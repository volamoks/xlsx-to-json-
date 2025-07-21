import { Client } from 'pg';

export interface DatabaseConfig {
  host: string;
  database: string;
  user: string;
  password: string;
  port: number;
}

export class DatabaseConnection {
  private config: DatabaseConfig;
  private client: Client | null = null;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    console.info("Attempting to connect to the database");
    
    this.client = new Client({
      host: this.config.host,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      port: this.config.port,
      connectionTimeoutMillis: 10000,
    });

    try {
      await this.client.connect();
      console.info("Database connection established successfully");
      return this.client;
    } catch (error) {
      console.error("Database connection error:", error);
      this.client = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
      console.info("Database connection closed");
    }
  }

  getClient(): Client | null {
    return this.client;
  }
}

export function createDatabaseConfig(): DatabaseConfig {
  const requiredVars = {
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([, value]) => !value)
    .map(([key]) => `POSTGRES_${key.toUpperCase()}`);

  if (missingVars.length > 0) {
    throw new Error(`Missing database environment variables: ${missingVars.join(', ')}`);
  }

  return {
    host: requiredVars.host!,
    database: requiredVars.database!,
    user: requiredVars.user!,
    password: requiredVars.password!,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  };
}