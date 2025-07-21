import { testPostgresConnection } from '../app/lib/postgresClient.js';

async function runTest() {
    console.log('Testing PostgreSQL connection...');
    const result = await testPostgresConnection();
    console.log('Connection result:', result);
}

runTest().catch(console.error);