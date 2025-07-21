import { google } from 'googleapis';
import { Firestore } from '@google-cloud/firestore';
import { config } from 'dotenv';
config();
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID is not defined in .env file');
}
if (!credentialsPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not defined in .env file');
}
const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const firestore = new Firestore();
export async function loadData() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'A1:ZZ1000', // Adjust the range as needed
        });
        const values = response.data.values;
        if (!values || values.length === 0) {
            console.log('No data found.');
            return;
        }
        const headers = values[0];
        const data = values.slice(1);
        for (const row of data) {
            const docData = {};
            for (let i = 0; i < headers.length; i++) {
                docData[headers[i]] = row[i] || '';
            }
            await firestore.collection('shops').add(docData);
        }
        console.log('Data loaded successfully!');
    }
    catch (err) {
        console.error('Error loading data:', err);
    }
}
// Example usage (you can call this function from your API route)
// loadData();
