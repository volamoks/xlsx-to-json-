'use client';
import React, { useState } from 'react';
import FileUpload from './components/FileUpload';
import JsonOutput from './components/JsonOutput';
import { KeycloakUserImport, processData } from './lib/dataConverter.client';

const Home: React.FC = () => {
    const [keycloakJson, setKeycloakJson] = useState<{
        realm: string;
        users: KeycloakUserImport[];
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [logOutput, setLogOutput] = useState<string>('');
    const [isExporting, setIsExporting] = useState<boolean>(false); // For Keycloak to Sheet
    const [isImporting, setIsImporting] = useState<boolean>(false); // For Sheet to Keycloak
    const [isExportingToGoogleSheet, setIsExportingToGoogleSheet] = useState<boolean>(false); // For DB to Google Sheet

    const handleFileLoaded = async (data: ArrayBuffer) => {
        // Ensure processData is called with the correct sourceType for client-side file processing
        const result = await processData(data, 'file');
        if ('error' in result) {
            setError(result.error || 'An unknown error occurred during file processing.');
            setKeycloakJson(null);
        } else {
            setError(null);
            setKeycloakJson(result as { realm: string; users: KeycloakUserImport[] });
        }
    };

    const handleStreamedOperation = async (
        apiEndpoint: string,
        operationType: 'Export' | 'Import' | 'ExportToGoogleSheet',
    ) => {
        if (operationType === 'Export') setIsExporting(true);
        if (operationType === 'Import') setIsImporting(true);
        if (operationType === 'ExportToGoogleSheet') setIsExportingToGoogleSheet(true);
        setLogOutput(`Starting ${operationType.toLowerCase().replace('togooglesheet', ' to Google Sheet')}...\n`);

        try {
            const response = await fetch(apiEndpoint, { method: 'POST' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            if (!response.body) {
                throw new Error('Response body is null');
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    setLogOutput(prev => prev + decoder.decode(value, { stream: true }));
                }
            }
            setLogOutput(prev => prev + `\n${operationType} process finished.\n`);
        } catch (e: unknown) {
            const message =
                e instanceof Error
                    ? e.message
                    : `An unknown error occurred during ${operationType.toLowerCase()}.`;
            setLogOutput(prev => prev + `\n${operationType.toUpperCase()}_ERROR: ${message}\n`);
        } finally {
            if (operationType === 'Export') setIsExporting(false);
            if (operationType === 'Import') setIsImporting(false);
            if (operationType === 'ExportToGoogleSheet') setIsExportingToGoogleSheet(false);
        }
    };

    return (
        <div className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Update Keycloak data</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FileUpload onFileLoaded={handleFileLoaded} />
            </div>

            {error && <div className="text-red-500 mt-4">{error}</div>}

            <div className="mt-8">
                <JsonOutput data={keycloakJson} />
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Google Sheet Operations</h2>
                {logOutput && (
                    <div className="mt-4 p-4 bg-gray-100 border border-gray-300 rounded max-h-96 overflow-y-auto">
                        <h3 className="text-lg font-medium mb-2">Operation Log:</h3>
                        <pre className="text-sm whitespace-pre-wrap">{logOutput}</pre>
                    </div>
                )}
                <div className="flex space-x-4 mt-4">
                    <button
                        onClick={() =>
                            handleStreamedOperation('/api/export-keycloak-sheet', 'Export')
                        }
                        disabled={isExporting || isImporting}
                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isExporting ? 'Exporting...' : 'Export Users from KeyCloak'}
                    </button>

                    <button
                        onClick={() =>
                            handleStreamedOperation('/api/import-keycloak-sheet', 'Import')
                        }
                        disabled={isExporting || isImporting}
                        className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isImporting ? 'Importing...' : 'Import Users to KeyCloak'}
                    </button>
                </div>
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">DB to Google Sheet Export</h2>
                <div className="flex space-x-4 mt-4">
                    <button
                        onClick={() =>
                            handleStreamedOperation('/api/export-to-google-sheet', 'ExportToGoogleSheet')
                        }
                        disabled={isExporting || isImporting || isExportingToGoogleSheet}
                        className="bg-teal-500 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isExportingToGoogleSheet ? 'Exporting to Google Sheet...' : 'Export DB to Google Sheet'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Home;
