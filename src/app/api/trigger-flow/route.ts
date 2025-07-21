import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function POST(_req: NextRequest) {
  // URL для триггера Power Automate из переменных окружения
  const powerAutomateUrl = process.env.POWER_AUTOMATE_APPROVAL_WEBHOOK_URL;

  if (!powerAutomateUrl) {
    console.error('POWER_AUTOMATE_APPROVAL_WEBHOOK_URL is not set in .env file');
    return NextResponse.json({ error: 'Server configuration error: Power Automate URL is not set.' }, { status: 500 });
  }

  try {
    // В реальном сценарии, путь к файлу будет приходить в запросе
    // или определяться логикой вашего приложения.
    // Для примера, мы используем статичный файл.
    // Убедитесь, что этот файл существует в вашем проекте.
    const filePath = path.join(process.cwd(), 'public', 'temp_files', 'approval_for_folder_36.xlsx');
    const fileName = path.basename(filePath);

    // Читаем файл и кодируем его в Base64
    const fileBuffer = await fs.readFile(filePath);
    const fileContent = fileBuffer.toString('base64');

    // Формируем тело запроса для Power Automate
    const payload = {
      fileName: fileName,
      fileContent: fileContent,
    };

    // Отправляем запрос в Power Automate
    const response = await fetch(powerAutomateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Если Power Automate вернул ошибку
      const errorText = await response.text();
      console.error('Error from Power Automate:', errorText);
      return NextResponse.json({ error: 'Failed to trigger Power Automate flow.', details: errorText }, { status: response.status });
    }

    // Возвращаем успешный ответ
    return NextResponse.json({ message: 'Successfully triggered Power Automate flow.' }, { status: 200 });

  } catch (error) {
    console.error('Error processing request:', error);
    // Обработка ошибок, например, если файл не найден
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
  }
}
