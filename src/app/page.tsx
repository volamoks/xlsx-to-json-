'use client';
import React, { useState } from 'react';
import FileUpload from './components/FileUpload';
import JsonOutput from './components/JsonOutput';
import { KeycloakUserImport, processData } from './lib/dataConverter.client';
import emailConfig from '@/lib/email-config.json';

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
    const [isCheckingSheet, setIsCheckingSheet] = useState<boolean>(false);
    const [isGeneratingExcel, setIsGeneratingExcel] = useState<boolean>(false);
    const [excelFolderId, setExcelFolderId] = useState<string>('');
    const [isTriggeringFlow, setIsTriggeringFlow] = useState<boolean>(false);
    const [isSendingEmail, setIsSendingEmail] = useState<boolean>(false);
    const [selectedScenarioId, setSelectedScenarioId] = useState<string>(emailConfig[0]?.id || '');
    const [isSendingCategoryNotification, setIsSendingCategoryNotification] =
        useState<boolean>(false);
    const [categoryId, setCategoryId] = useState<string>('2');
    const [isSendingKamNotification, setIsSendingKamNotification] = useState<boolean>(false);
    const [kamCategoryId, setKamCategoryId] = useState<string>('2');

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
        setLogOutput(
            `Starting ${operationType
                .toLowerCase()
                .replace('togooglesheet', ' to Google Sheet')}...\n`,
        );

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

    const handleCheckSheet = async () => {
        setIsCheckingSheet(true);
        setLogOutput(prev => prev + '\nStarting to check sheet for triggers...\n');
        try {
            const response = await fetch('/api/check-sheet', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error! status: ${response.status}`);
            }
            setLogOutput(prev => prev + `SUCCESS: ${result.message}\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'An unknown error occurred.';
            setLogOutput(prev => prev + `ERROR: ${message}\n`);
        } finally {
            setIsCheckingSheet(false);
        }
    };

    const handleGenerateExcel = async () => {
        if (!excelFolderId || isNaN(parseInt(excelFolderId, 10))) {
            setLogOutput(prev => prev + '\nPlease enter a valid Folder ID for Excel generation.\n');
            return;
        }
        setIsGeneratingExcel(true);
        setLogOutput(
            prev => prev + `\nGenerating download link for Folder ID: ${excelFolderId}...\n`,
        );
        try {
            const response = await fetch('/api/generate-excel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderId: parseInt(excelFolderId, 10) }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error! status: ${response.status}`);
            }
            setLogOutput(prev => prev + `SUCCESS: ${result.message}\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'An unknown error occurred.';
            setLogOutput(prev => prev + `ERROR: ${message}\n`);
        } finally {
            setIsGeneratingExcel(false);
        }
    };

    const handleTriggerFlow = async () => {
        setIsTriggeringFlow(true);
        setLogOutput(prev => prev + '\nTriggering Power Automate flow with Excel file...\n');
        try {
            const response = await fetch('/api/trigger-flow', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error! status: ${response.status}`);
            }
            setLogOutput(prev => prev + `SUCCESS: ${result.message}\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'An unknown error occurred.';
            setLogOutput(prev => prev + `ERROR: ${message}\n`);
        } finally {
            setIsTriggeringFlow(false);
        }
    };

    const handleSendEmail = async (scenarioId: string) => {
        if (!scenarioId) {
            setLogOutput(prev => prev + '\nPlease provide a scenario ID.\n');
            return;
        }
        setIsSendingEmail(true);
        const scenario = emailConfig.find(s => s.id === scenarioId);
        setLogOutput(
            prev => prev + `\nSending email for scenario: "${scenario?.description}"...\n`,
        );
        try {
            const response = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenarioId }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error! status: ${response.status}`);
            }
            setLogOutput(prev => prev + `SUCCESS: ${result.message}\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'An unknown error occurred.';
            setLogOutput(prev => prev + `ERROR: ${message}\n`);
        } finally {
            setIsSendingEmail(false);
        }
    };

    const handleSendCategoryNotification = async (categoryId: string) => {
        setIsSendingCategoryNotification(true);
        setLogOutput(
            prev =>
                prev + `\nSending category manager notification for category ${categoryId}...\n`,
        );

        try {
            const response = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenarioId: 'category_manager_notification',
                    categoryId: parseInt(categoryId, 10),
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error! status: ${response.status}`);
            }
            setLogOutput(prev => prev + `SUCCESS: ${result.message}\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'An unknown error occurred.';
            setLogOutput(prev => prev + `ERROR: ${message}\n`);
        }

        setIsSendingCategoryNotification(false);
    };

    const handleSendKamNotification = async (categoryId: string) => {
        setIsSendingKamNotification(true);
        setLogOutput(prev => prev + `\nSending KAM notification for category ${categoryId}...\n`);

        try {
            const response = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenarioId: 'kam_notification',
                    categoryId: parseInt(categoryId, 10),
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error! status: ${response.status}`);
            }
            setLogOutput(prev => prev + `SUCCESS: ${result.message}\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'An unknown error occurred.';
            setLogOutput(prev => prev + `ERROR: ${message}\n`);
        }

        setIsSendingKamNotification(false);
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
                <h2 className="text-xl font-semibold mb-4">
                    DB to Google Sheet Export & Flow Trigger
                </h2>
                <div className="flex space-x-4 mt-4">
                    <button
                        onClick={() =>
                            handleStreamedOperation('/api/export-sheet', 'ExportToGoogleSheet')
                        }
                        disabled={
                            isExporting ||
                            isImporting ||
                            isExportingToGoogleSheet ||
                            isCheckingSheet
                        }
                        className="bg-teal-500 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isExportingToGoogleSheet ? 'Exporting...' : '1. Export DB to Google Sheet'}
                    </button>
                    <button
                        onClick={handleCheckSheet}
                        disabled={isCheckingSheet || isExportingToGoogleSheet}
                        className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isCheckingSheet ? 'Checking...' : '2. Check Sheet & Trigger Flow'}
                    </button>
                </div>
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Generate Excel for Approval</h2>
                <div className="flex items-center space-x-4 mt-4">
                    <input
                        type="text"
                        value={excelFolderId}
                        onChange={e => setExcelFolderId(e.target.value)}
                        placeholder="Enter Folder ID"
                        className="border border-gray-300 rounded px-3 py-2"
                    />
                    <button
                        onClick={handleGenerateExcel}
                        disabled={isGeneratingExcel || !excelFolderId}
                        className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isGeneratingExcel ? 'Generating...' : 'Generate & Send Excel'}
                    </button>
                </div>
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Direct Power Automate Operations</h2>
                <div className="flex space-x-4 mt-4">
                    <button
                        onClick={handleTriggerFlow}
                        disabled={isTriggeringFlow}
                        className="bg-cyan-500 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isTriggeringFlow ? 'Triggering...' : 'Trigger Power Automate with Excel'}
                    </button>
                </div>
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Direct Email Operations</h2>
                <div className="flex items-center space-x-4 mt-4">
                    <select
                        value={selectedScenarioId}
                        onChange={e => setSelectedScenarioId(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2"
                    >
                        {emailConfig.map(scenario => (
                            <option
                                key={scenario.id}
                                value={scenario.id}
                            >
                                {scenario.description}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => handleSendEmail(selectedScenarioId)}
                        disabled={isSendingEmail || !selectedScenarioId}
                        className="bg-emerald-500 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isSendingEmail ? 'Sending...' : 'Send Email'}
                    </button>
                    <button
                        onClick={() => handleSendEmail('icpu_check')}
                        disabled={isSendingEmail}
                        className="bg-sky-500 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isSendingEmail ? 'Sending...' : 'Send to ICPU Check'}
                    </button>
                    <button
                        onClick={() => handleSendEmail('translation_request')}
                        disabled={isSendingEmail}
                        className="bg-indigo-500 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isSendingEmail ? 'Sending...' : 'На перевод'}
                    </button>
                </div>
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Category Manager Notifications</h2>
                <p className="text-sm text-gray-600 mb-4">
                    Отправить уведомления категорийным менеджерам о позициях со статусом 2
                </p>
                <div className="flex items-center space-x-4 mt-4">
                    <select
                        value={categoryId}
                        onChange={e => setCategoryId(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2"
                        disabled={isSendingCategoryNotification}
                    >
                        <option value="2">Категория 2</option>
                        <option value="6">Категория 6</option>
                        <option value="11">Категория 11</option>
                        <option value="12">Категория 12</option>
                        <option value="15">Категория 15</option>
                        <option value="16">Категория 16</option>
                        <option value="20">Категория 20</option>
                        <option value="21">Категория 21</option>
                        <option value="28">Категория 28</option>
                    </select>
                    <button
                        onClick={() => handleSendCategoryNotification(categoryId)}
                        disabled={isSendingCategoryNotification}
                        className="bg-amber-500 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isSendingCategoryNotification ? 'Отправка...' : 'Отправить КМ'}
                    </button>
                    <button
                        onClick={async () => {
                            setLogOutput(prev => prev + '\nChecking available Google Sheets...\n');
                            try {
                                const response = await fetch('/api/debug-sheets');
                                const result = await response.json();
                                if (response.ok) {
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Available sheets: ${result.availableSheets.join(
                                                ', ',
                                            )}\n`,
                                    );
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Environment sheet name: ${result.environmentSheetName}\n`,
                                    );
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Spreadsheet title: ${result.spreadsheetInfo.title}\n`,
                                    );
                                } else {
                                    setLogOutput(prev => prev + `ERROR: ${result.error}\n`);
                                }
                            } catch (error) {
                                setLogOutput(
                                    prev =>
                                        prev +
                                        `ERROR: ${
                                            error instanceof Error ? error.message : 'Unknown error'
                                        }\n`,
                                );
                            }
                        }}
                        className="bg-slate-500 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded"
                    >
                        Отладка листов
                    </button>
                    <button
                        onClick={async () => {
                            setLogOutput(prev => prev + '\nChecking sheet data...\n');
                            try {
                                const response = await fetch('/api/debug-sheet-data');
                                const result = await response.json();
                                if (response.ok) {
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Sheet: ${result.sheetName}, Total rows: ${result.totalRows}\n`,
                                    );
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Available statuses: ${result.summary.availableStatuses.join(
                                                ', ',
                                            )}\n`,
                                    );
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Available categories: ${result.summary.availableCategories.join(
                                                ', ',
                                            )}\n`,
                                    );
                                    setLogOutput(
                                        prev =>
                                            prev +
                                            `Status 2 count: ${result.summary.status2Count}\n`,
                                    );
                                    if (result.status2Data.length > 0) {
                                        setLogOutput(prev => prev + `Status 2 samples:\n`);
                                        result.status2Data.forEach(
                                            (
                                                item: {
                                                    folder_category_id: string;
                                                    folder_category_name: string;
                                                    name_by_doc: string;
                                                },
                                                index: number,
                                            ) => {
                                                setLogOutput(
                                                    prev =>
                                                        prev +
                                                        `${index + 1}. Category ${
                                                            item.folder_category_id
                                                        } (${item.folder_category_name}): ${
                                                            item.name_by_doc
                                                        }\n`,
                                                );
                                            },
                                        );
                                    }
                                } else {
                                    setLogOutput(prev => prev + `ERROR: ${result.error}\n`);
                                }
                            } catch (error) {
                                setLogOutput(
                                    prev =>
                                        prev +
                                        `ERROR: ${
                                            error instanceof Error ? error.message : 'Unknown error'
                                        }\n`,
                                );
                            }
                        }}
                        className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
                    >
                        Отладка данных
                    </button>
                    <button
                        onClick={async () => {
                            setLogOutput(prev => prev + '\nChecking email logs...\n');
                            try {
                                const response = await fetch(
                                    '/api/email-logs?scenario=category_manager_notification',
                                );
                                const result = await response.json();
                                if (response.ok) {
                                    setLogOutput(
                                        prev => prev + `Email logs found: ${result.count}\n`,
                                    );
                                    if (result.logs.length > 0) {
                                        result.logs.forEach(
                                            (
                                                log: {
                                                    date: string;
                                                    recipient: string;
                                                    request_ids: string[];
                                                },
                                                index: number,
                                            ) => {
                                                setLogOutput(
                                                    prev =>
                                                        prev +
                                                        `${index + 1}. ${log.date}: ${
                                                            log.recipient
                                                        } (${log.request_ids.length} positions)\n`,
                                                );
                                            },
                                        );
                                    } else {
                                        setLogOutput(
                                            prev => prev + 'No category manager emails sent yet\n',
                                        );
                                    }
                                } else {
                                    setLogOutput(prev => prev + `ERROR: ${result.error}\n`);
                                }
                            } catch (error) {
                                setLogOutput(
                                    prev =>
                                        prev +
                                        `ERROR: ${
                                            error instanceof Error ? error.message : 'Unknown error'
                                        }\n`,
                                );
                            }
                        }}
                        className="bg-violet-500 hover:bg-violet-700 text-white font-bold py-2 px-4 rounded"
                    >
                        История писем КМ
                    </button>
                </div>
            </div>

            <hr className="my-8" />

            <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">KAM Notifications</h2>
                <p className="text-sm text-gray-600 mb-4">
                    Отправить уведомления КАМ о позициях со статусом 5 (требует доработки)
                </p>
                <div className="flex items-center space-x-4 mt-4">
                    <input
                        type="text"
                        value={kamCategoryId}
                        onChange={e => setKamCategoryId(e.target.value)}
                        placeholder="Введите номер категории"
                        className="border border-gray-300 rounded px-3 py-2"
                        disabled={isSendingKamNotification}
                    />
                    <button
                        onClick={() => handleSendKamNotification(kamCategoryId)}
                        disabled={isSendingKamNotification}
                        className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                        {isSendingKamNotification ? 'Отправка...' : 'Отправить КАМ'}
                    </button>
                    <button
                        onClick={async () => {
                            setLogOutput(prev => prev + '\nChecking KAM email logs...\n');
                            try {
                                const response = await fetch(
                                    '/api/email-logs?scenario=kam_notification',
                                );
                                const result = await response.json();
                                if (response.ok) {
                                    setLogOutput(
                                        prev => prev + `KAM email logs found: ${result.count}\n`,
                                    );
                                    if (result.logs.length > 0) {
                                        result.logs.forEach(
                                            (
                                                log: {
                                                    date: string;
                                                    recipient: string;
                                                    request_ids: string[];
                                                },
                                                index: number,
                                            ) => {
                                                setLogOutput(
                                                    prev =>
                                                        prev +
                                                        `${index + 1}. ${log.date}: ${
                                                            log.recipient
                                                        } (${log.request_ids.length} positions)\n`,
                                                );
                                            },
                                        );
                                    } else {
                                        setLogOutput(prev => prev + 'No KAM emails sent yet\n');
                                    }
                                } else {
                                    setLogOutput(prev => prev + `ERROR: ${result.error}\n`);
                                }
                            } catch (error) {
                                setLogOutput(
                                    prev =>
                                        prev +
                                        `ERROR: ${
                                            error instanceof Error ? error.message : 'Unknown error'
                                        }\n`,
                                );
                            }
                        }}
                        className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded"
                    >
                        История писем КАМ
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Home;
