import React, { useCallback } from 'react';

interface FileUploadProps {
  onFileLoaded: (data: ArrayBuffer) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileLoaded }) => {
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result instanceof ArrayBuffer) {
          onFileLoaded(e.target.result);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }, [onFileLoaded]);

  return (
    <div>
      <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
        Upload XLSX File
      </label>
      <input
        type="file"
        id="file-upload"
        accept=".xlsx"
        onChange={handleFileChange}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
      />
    </div>
  );
};

export default FileUpload;
