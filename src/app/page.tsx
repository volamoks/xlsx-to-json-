'use client';
'use client';
import React, { useState } from 'react';
import FileUpload from './components/FileUpload';
// import TextInput from './components/TextInput';
import JsonOutput from './components/JsonOutput';
import { KeycloakUserImport, processData } from './lib/dataConverter';

const Home: React.FC = () => {
    const [keycloakJson, setKeycloakJson] = useState<{
        realm: string;
        users: KeycloakUserImport[];
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleFileLoaded = async (data: ArrayBuffer) => {
        const result = await processData(data, 'file');
        if ('error' in result) {
            setError(result.error || null);
            setKeycloakJson(null);
        } else {
            setError(null);
            setKeycloakJson((result as { realm: string; users: KeycloakUserImport[] }) || null);
        }
    };

    const handleTextLoaded = async (text: string) => {
        const result = await processData(text, 'text');
        if ('error' in result) {
            setError(result.error || null);
            setKeycloakJson(null);
        } else {
            setError(null);
            setKeycloakJson((result as { realm: string; users: KeycloakUserImport[] }) || null);
        }
    };

    return (
        <div className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">XLSX/Text to Keycloak JSON Converter</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FileUpload onFileLoaded={handleFileLoaded} />
                {/* <TextInput onTextLoaded={handleTextLoaded} /> */}
            </div>

            {error && <div className="text-red-500 mt-4">{error}</div>}

            <div className="mt-8">
                <JsonOutput data={keycloakJson} />
            </div>
        </div>
    );
};

export default Home;
