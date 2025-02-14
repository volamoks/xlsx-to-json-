import React, { useCallback } from 'react';

interface TextInputProps {
  onTextLoaded: (text: string) => void;
}

const TextInput: React.FC<TextInputProps> = ({ onTextLoaded }) => {
  const handleTextChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onTextLoaded(event.target.value);
  }, [onTextLoaded]);

  return (
    <div>
      <label htmlFor="text-input" className="block text-sm font-medium text-gray-700">
        Paste Data
      </label>
      <textarea
        id="text-input"
        onChange={handleTextChange}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        rows={5}
        placeholder="Paste your data here..."
      />
    </div>
  );
};

export default TextInput;
