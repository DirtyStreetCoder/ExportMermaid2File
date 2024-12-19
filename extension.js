const vscode = require('vscode');
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("Export Mermaid 2 File");
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(status);
    
    function debug(text) {
        if (outputChannel) {
            outputChannel.appendLine(text.toString());
        }
    }

    function handleError(error, message) {
        debug(`Error: ${error.message}`);
        debug(`Stack: ${error.stack}`);
        outputChannel.show(true);
        vscode.window.showErrorMessage(message || `Failed to export: ${error.message}`);
        status.hide();
    }

    async function convertSvgToPdf(svgPath, pdfPath) {
        debug('\nStarting SVG to PDF conversion...');
        const puppeteer = require('puppeteer-core');
        
        try {
            if (!fs.existsSync(svgPath)) {
                throw new Error(`Input SVG file not found at: ${svgPath}`);
            }
            debug(`Input SVG file verified at: ${svgPath}`);
    
            const chromePath = await findChrome();
            if (!chromePath) {
                throw new Error('Could not find Chrome installation. Please install Google Chrome.');
            }
            debug(`Using Chrome at: ${chromePath}`);
            
            const browser = await puppeteer.launch({
                executablePath: chromePath,
                headless: 'new'
            });
            const page = await browser.newPage();
            
            const svgContent = fs.readFileSync(svgPath, 'utf8');
            debug(`Read SVG content: ${svgContent.length} bytes`);
            
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                    <head>
                        <style>
                            body, html {
                                margin: 0;
                                padding: 0;
                                height: 100%;
                                overflow: hidden;
                            }
                            svg {
                                display: block;
                                max-width: 100%;
                                height: auto;
                            }
                        </style>
                    </head>
                    <body>${svgContent}</body>
                </html>
            `;
            
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            await page.waitForSelector('svg');
            
            const dimensions = await page.evaluate(() => {
                const svg = document.querySelector('svg');
                if (!svg) return null;
                return {
                    width: Math.ceil(svg.getBoundingClientRect().width),
                    height: Math.ceil(svg.getBoundingClientRect().height)
                };
            });
            
            if (!dimensions) {
                throw new Error('Failed to get SVG dimensions');
            }
            
            await page.setViewport({
                width: dimensions.width,
                height: dimensions.height,
                deviceScaleFactor: 1
            });
            
            await page.pdf({
                path: pdfPath,
                width: `${dimensions.width}px`,
                height: `${dimensions.height}px`,
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                preferCSSPageSize: true,
                pageRanges: '1'
            });
            
            if (!fs.existsSync(pdfPath)) {
                throw new Error(`PDF file was not created at: ${pdfPath}`);
            }
            
            await browser.close();
            debug('\nPDF conversion completed successfully');
            return true;
            
        } catch (error) {
            debug(`PDF conversion error: ${error.message}`);
            debug(`Stack trace: ${error.stack}`);
            throw error;
        }
    }
    
    async function findChrome() {
        const os = require('os');
        const platform = os.platform();
        
        let paths = [];
        if (platform === 'win32') {
            paths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
            ];
        } else if (platform === 'darwin') {
            paths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
            ];
        } else {
            paths = [
                '/usr/bin/google-chrome',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/microsoft-edge'
            ];
        }
    
        for (const path of paths) {
            if (fs.existsSync(path)) {
                return path;
            }
        }
        return null;
    }

    context.subscriptions.push(vscode.commands.registerCommand('em2f.export', async function exportMermaidDiagram() {
        outputChannel.clear();
        debug('Starting export process...');
        
        const config = vscode.workspace.getConfiguration('em2f');
        const editor = vscode.window.activeTextEditor;
        
        if (!editor?.document?.uri) {
            handleError(new Error('No active editor'), 'No active editor found');
            return;
        }

        try {
            debug(`File being processed: ${editor.document.fileName}`);
            debug(`File language: ${editor.document.languageId}`);
            
            status.tooltip = "Saving " + editor.document.fileName + "...";
            status.text = "$(file-media) $(sync~spin)";
            status.show();

            await editor.document.save();
            const sourceFile = editor.document.uri.fsPath;
            
            // Get the selected text or entire document
            const selection = editor.selection;
            const text = selection.isEmpty ? 
                editor.document.getText() : 
                editor.document.getText(selection);
            
            debug(`Selected/Full text length: ${text.length} characters`);
            if (!text.includes('```mermaid')) {
                handleError(new Error('No Mermaid diagram found'), 'Please select a Mermaid diagram (including the ```mermaid markers)');
                return;
            }

            // Determine output type
            const outputTypes = ['svg', 'pdf', 'png'];
            const defaultType = config.get('outputType', 'svg');
            const outputType = await vscode.window.showQuickPick(outputTypes, {
                placeHolder: 'Select output format',
                default: defaultType
            });

            if (!outputType) {
                status.hide();
                return;
            }

            // Ask for custom filename
            const defaultOutputName = path.join(
                path.dirname(sourceFile),
                `${path.basename(sourceFile, path.extname(sourceFile))}.${outputType}`
            );
            
            const outputFilename = await vscode.window.showInputBox({
                prompt: 'Enter output filename',
                value: defaultOutputName,
                valueSelection: [0, defaultOutputName.length - (outputType.length + 1)]
            });

            if (!outputFilename) {
                status.hide();
                return;
            }

            debug(`Selected output file: ${outputFilename}`);
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(sourceFile);

            // Generate SVG first (needed for both SVG and PDF output)
            const tempSvgFile = path.join(
                path.dirname(outputFilename),
                `${path.basename(outputFilename, path.extname(outputFilename))}.temp.svg`
            );

            let mermaidCommand = `npx --package=@mermaid-js/mermaid-cli@latest mmdc` +
                ` -t ${config.get('theme', 'default')}` +
                ` -i "${sourceFile}"` +
                ` -o "${tempSvgFile}"`;

            if (outputType === 'png') {
                const pngScale = config.get('pngScale', 1);
                const pngBackground = config.get('pngBackground', 'white');
                mermaidCommand = `npx --package=@mermaid-js/mermaid-cli@latest mmdc` +
                    ` -t ${config.get('theme', 'default')}` +
                    ` -i "${sourceFile}"` +
                    ` -o "${outputFilename}"` +
                    ` -b ${pngBackground}` +
                    ` -s ${pngScale}`;
            }

            debug(`Executing command: ${mermaidCommand}`);
            status.tooltip = `Exporting ${outputFilename}...`;
           
            const process = childProcess.exec(mermaidCommand, { cwd });
           
            process.stdout.on('data', (data) => debug(`Output: ${data}`));
            process.stderr.on('data', (data) => debug(`Error: ${data}`));

            await new Promise((resolve, reject) => {
                process.on('exit', async (code) => {
                    if (code === 0) {
                        try {
                            const tempSvgActual = tempSvgFile.replace('.svg', '-1.svg');
                            
                            if (outputType === 'pdf') {
                                await convertSvgToPdf(tempSvgActual, outputFilename);
                                fs.unlinkSync(tempSvgActual);
                            } else if (outputType === 'svg') {
                                fs.renameSync(tempSvgActual, outputFilename);
                            }
                            
                            debug('Export completed successfully');
                            vscode.window.showInformationMessage(`Export completed: ${outputFilename}`);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    } else {
                        reject(new Error(`Process exited with code ${code}`));
                    }
                });
            });

        } catch (error) {
            handleError(error);
        } finally {
            status.hide();
        }
    }));

    // Restore the show log command
    // context.subscriptions.push(vscode.commands.registerCommand('em2f.showLog', function() {
    //     outputChannel.show(true);
    // }));
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};