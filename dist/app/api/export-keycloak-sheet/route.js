import { spawn } from 'child_process';
export async function POST() {
    console.log('API endpoint /api/export-keycloak-sheet (streaming) called');
    const stream = new ReadableStream({
        start(controller) {
            try {
                console.log('Executing command for streaming: npm run export-users-to-sheet');
                const scriptProcess = spawn('npm', ['run', 'export-users-to-sheet'], {
                    shell: true, // Use shell for npm commands, especially on Windows
                    stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin, pipe stdout/stderr
                });
                const encoder = new TextEncoder();
                const send = (data) => {
                    controller.enqueue(encoder.encode(data));
                };
                scriptProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    console.log('stdout chunk:', output);
                    send(output);
                });
                scriptProcess.stderr.on('data', (data) => {
                    const errorOutput = data.toString();
                    console.error('stderr chunk:', errorOutput);
                    send(`STDERR: ${errorOutput}`); // Prefix stderr to distinguish
                });
                scriptProcess.on('error', (error) => {
                    console.error('Spawn error:', error);
                    send(`SPAWN_ERROR: ${error.message}\n`);
                    controller.close();
                });
                scriptProcess.on('close', (code) => {
                    console.log(`Script process exited with code ${code}`);
                    if (code === 0) {
                        send('\nSCRIPT_SUCCESS: Export script completed successfully.\n');
                    }
                    else {
                        send(`\nSCRIPT_ERROR: Export script exited with code ${code}.\n`);
                    }
                    controller.close();
                });
            }
            catch (error) {
                console.error('Error setting up stream:', error);
                const message = error instanceof Error ? error.message : 'Unknown error during stream setup';
                controller.enqueue(new TextEncoder().encode(`STREAM_SETUP_ERROR: ${message}\n`));
                controller.close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff', // Prevent browser from interpreting content as HTML
        },
    });
}
