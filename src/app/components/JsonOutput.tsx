import React, { useState, useCallback } from 'react';
import { KeycloakUserImport } from '../lib/dataConverter';

interface JsonOutputProps {
  data: { realm: string; users: KeycloakUserImport[] } | null;
}

const JsonOutput: React.FC<JsonOutputProps> = ({ data }) => {
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyToClipboard = useCallback(() => {
    if (data) {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(
        () => {
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000); // Reset after 2 seconds
        },
        () => {
          setCopySuccess(false);
        }
      );
    }
  }, [data]);

  const handleDownloadJson = useCallback(() => {
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'keycloak-users.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [data]);

  if (!data) {
    return null;
  }

  return (
      <div>
          <h2 className="text-lg font-semibold mb-2">Keycloak JSON Output</h2>
          {data ? (
              <>
                  <div className="mt-4">
                      <button
                          onClick={handleCopyToClipboard}
                          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                          {copySuccess ? 'Copied!' : 'Copy to Clipboard'}
                      </button>
                      <button
                          onClick={handleDownloadJson}
                          className="ml-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400"
                      >
                          Download JSON
                      </button>
                      <pre className="bg-gray-100 p-4 rounded-md overflow-auto">
                          {JSON.stringify(data, null, 2)}
                      </pre>
                  </div>
              </>
          ) : (
              <p>
                  No JSON data available. Please upload a file, paste text, or generate JSON from
                  the table.
              </p>
          )}
      </div>
  );
};

export default JsonOutput;
