import React, { useState, forwardRef, useImperativeHandle } from 'react';

interface DataTableProps {
  onGenerateJson: () => void;
}

interface DataTableRef {
  getTableData: () => string[][];
}

const DataTable = forwardRef<DataTableRef, DataTableProps>(({ onGenerateJson }, ref) => {
    const headers = [
        'username',
        'email',
    'firstName',
    'lastName',
    'supplier',
    'tin',
    'business_units',
    'notif_teams_destin',
    'notif_lang',
    'categories',
    'notif_telegram_destin',
  ];

  const [tableData, setTableData] = useState<string[][]>(
    Array(1)
      .fill(null)
      .map(() => Array(headers.length).fill(''))
  );

  useImperativeHandle(ref, () => ({
    getTableData: () => {
      return tableData;
    }
  }));


  const handlePaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    const rows = text.split(/\r?\n/); // Split by newline

    // Function to split cells by various delimiters
    const splitCells = (row: string) => {
      for (const delimiter of ['\t', ',', ' ']) {
        if (row.includes(delimiter)) {
          return row.split(delimiter).map(cell => cell.trim());
        }
      }
      return [row.trim()]; // If no delimiters found, return the whole row as a single cell
    };

    const parsedData = rows.map(row => splitCells(row));

    // Update tableData
    setTableData(prevData => {
      const newData = [...prevData];
      parsedData.forEach((rowData, rowIndex) => {
        if (newData[rowIndex]) {
          rowData.forEach((cellData, cellIndex) => {
            if (newData[rowIndex][cellIndex] !== undefined) {
              newData[rowIndex][cellIndex] = cellData;
            }
          });
        }
      });
      return newData;
    });
  };

  const handleInputChange = (rowIndex: number, cellIndex: number, value: string) => {
    setTableData(prevData => {
      const newData = [...prevData];
      newData[rowIndex][cellIndex] = value;
      return newData;
    });
  };

  const addRow = () => {
    setTableData(prevData => [...prevData, Array(headers.length).fill('')]);
  }


  return (
    <div className="overflow-x-auto" onPaste={handlePaste}>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {tableData.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-6 py-4 whitespace-nowrap">
                  <input
                    type="text"
                    value={cell}
                    onChange={(e) => handleInputChange(rowIndex, cellIndex, e.target.value)}
                    className="w-full border border-gray-300 rounded px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={addRow}
        className="mt-4 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      >
        Add Row
      </button>
      <button
        onClick={() => onGenerateJson()}
        className="ml-4 mt-4 bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
      >
        Generate JSON
      </button>
    </div>
  );
});

DataTable.displayName = 'DataTable';

export default DataTable;
