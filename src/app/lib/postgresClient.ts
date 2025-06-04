import { Pool, PoolConfig } from 'pg';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env file
config({ path: path.resolve(__dirname, '../../.env') });

interface PostgresConfig extends PoolConfig {
    ssl?: boolean | { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string };
}

/**
 * Get PostgreSQL configuration with environment detection and PROD_ fallback chain
 */
function getPostgresConfig(): PostgresConfig {
    const isProduction = process.env.NODE_ENV === 'production';

    // Use PROD_ variables in production, fallback to regular variables
    const prefix = isProduction ? 'PROD_' : '';
    const host = process.env[`${prefix}POSTGRES_HOST`] || process.env.POSTGRES_HOST;
    const port = (process.env[`${prefix}POSTGRES_PORT`] || process.env.POSTGRES_PORT)
        ? parseInt(process.env[`${prefix}POSTGRES_PORT`] || process.env.POSTGRES_PORT || '5432')
        : 5432;
    const db = process.env[`${prefix}POSTGRES_DB`] || process.env.POSTGRES_DB;
    const user = process.env[`${prefix}POSTGRES_USER`] || process.env.POSTGRES_USER;
    const password = process.env[`${prefix}POSTGRES_PASSWORD`] || process.env.POSTGRES_PASSWORD;
    const sslEnabled = process.env[`${prefix}POSTGRES_SSL`] === 'true' || process.env.POSTGRES_SSL === 'true';

    if (!host || !db || !user || !password) {
        throw new Error(`Missing PostgreSQL environment variables for ${isProduction ? 'production' : 'development'} environment`);
    }

    // Enhanced SSL configuration
    let sslConfig: boolean | { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } = false;
    if (sslEnabled) {
        sslConfig = {
            rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false',
            ca: process.env.POSTGRES_SSL_CA,
            cert: process.env.POSTGRES_SSL_CERT,
            key: process.env.POSTGRES_SSL_KEY
        };
    }

    return {
        host,
        port,
        database: db,
        user,
        password,
        ssl: sslConfig,
        // Connection pool settings
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        allowExitOnIdle: true
    };
}

const pool = new Pool(getPostgresConfig());

/**
 * Execute a PostgreSQL query with enhanced error handling
 * @param sql The SQL query to execute
 * @param params Optional query parameters
 * @returns Promise with query results
 * @throws Error with detailed PostgreSQL error information
 */
export async function queryPostgres(sql: string, params?: unknown[]) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows;
    } catch (error: unknown) {
        if (error instanceof Error) {
            throw new Error(`PostgreSQL query failed: ${error.message}\nQuery: ${sql}`);
        }
        throw new Error(`Unknown PostgreSQL error executing query: ${sql}`);
    } finally {
        client.release();
    }
}

/**
 * Test PostgreSQL connection with detailed diagnostics
 * @returns Connection test result with detailed information
 */
export async function testPostgresConnection() {
    try {
        const start = Date.now();
        await queryPostgres('SELECT 1');
        const duration = Date.now() - start;

        return {
            success: true,
            message: 'PostgreSQL connection successful',
            details: {
                environment: process.env.NODE_ENV || 'development',
                host: pool.options.host,
                port: pool.options.port,
                database: pool.options.database,
                connectionTimeMs: duration
            }
        };
    } catch (error: unknown) {
        return {
            success: false,
            message: 'PostgreSQL connection failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            details: {
                environment: process.env.NODE_ENV || 'development',
                host: pool.options.host,
                port: pool.options.port,
                database: pool.options.database
            }
        };
    }
}