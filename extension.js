const vscode = require('vscode');
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("Export Mermaid 2 File");
    function debug(text) {
        if (outputChannel) {
            outputChannel.appendLine(text.toString());
        }
    }

    function replaceExtension(filename, extension) {
        const newFileName = path.basename(filename, path.extname(filename)) + extension;
        return path.join(path.dirname(filename), newFileName);
    }

    function handleError(error, message) {
        debug(`Error: ${error.message}`);
        debug(`Stack: ${error.stack}`);
        outputChannel.show(true);
        vscode.window.showErrorMessage(message || `Failed to export: ${error.message}`);
        status.hide();
    }

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(status);

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
            status.color = undefined;
            status.show();

            await editor.document.save();
            const sourceFile = editor.document.uri.fsPath;
            const outputType = config.get('outputType', 'svg');
            debug(`Output type from config: ${outputType}`);
            
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

            // Ask for custom filename
            const defaultOutputName = replaceExtension(sourceFile, '.' + outputType);
            const outputFilename = await vscode.window.showInputBox({
                prompt: 'Enter output filename',
                value: defaultOutputName,
                valueSelection: [0, defaultOutputName.length - (outputType.length + 1)]
            });

            if (!outputFilename) {
                status.hide();
                return; // User cancelled
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(sourceFile);

            debug('Export parameters:');
            debug(`Working directory: ${cwd}`);
            debug(`Source file: ${sourceFile}`);
            debug(`Output filename: ${outputFilename}`);
            debug(`Theme: ${config.get('theme', 'default')}`);

            // Build command without --overwrite
            let command = `npx --package=@mermaid-js/mermaid-cli@latest mmdc` +
                ` -t ${config.get('theme', 'default')}` +
                ` -i "${sourceFile}"` +
                ` -o "${outputFilename}"`;

            if (outputType === 'png') {
                const pngScale = config.get('pngScale', 1);
                const pngBackground = config.get('pngBackground', 'white');
                command += ` -b ${pngBackground}` +
                          ` -s ${pngScale}`;
            }

            debug(`Executing command: ${command}`);
            status.tooltip = `Exporting ${outputFilename}...`;
           
            const process = childProcess.exec(command, { cwd });
           
            process.stdout.on('data', (data) => {
                debug(`Output: ${data}`);
            });

            process.stderr.on('data', (error) => {
                debug(`Error: ${error}`);
                outputChannel.show(true);
            });

            process.on('close', (code) => {
                if (code === 0) {
                    // Construct the actual output filename (with -1 added)
                    const fileExt = path.extname(outputFilename);
                    const fileBase = path.basename(outputFilename, fileExt);
                    const fileDir = path.dirname(outputFilename);
                    const actualOutputFile = path.join(fileDir, `${fileBase}-1${fileExt}`);

                    debug(`Checking for output file: ${actualOutputFile}`);
                    
                    if (fs.existsSync(actualOutputFile)) {
                        debug("Export completed successfully");
                        
                        // Rename the file to remove the -1
                        try {
                            fs.renameSync(actualOutputFile, outputFilename);
                            debug(`Renamed ${actualOutputFile} to ${outputFilename}`);
                            vscode.window.showInformationMessage(`Mermaid diagram exported to ${outputFilename}`);
                        } catch (renameError) {
                            debug(`Could not rename file: ${renameError.message}`);
                            handleError(renameError, 'Failed to rename output file. See Output panel for details.');
                        }
                    } else {
                        debug("Export failed - output file not created");
                        debug(`Tried locations:\n- ${outputFilename}\n- ${actualOutputFile}`);
                        handleError(new Error("Output file not created"), 
                            'Failed to create output file. See Output panel for details.');
                    }
                    status.hide();
                } else {
                    debug(`Export failed with code ${code}`);
                    handleError(new Error(`Process exited with code ${code}`), 
                        'Failed to export Mermaid diagram. See Output panel for details.');
                }
            });

        } catch (error) {
            handleError(error, `Failed to export: ${error.message}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('em2f.showLog', function() {
        outputChannel.show(true);
    }));
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};