const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function activate(context) {
    // ABRIR BIBLIOTECA (GENÉRICO)
    const disposableOpenLibrary = vscode.commands.registerCommand('extension.openLibrary', function () {
    // Antes: const libraryFolderPath = vscode.workspace.getConfiguration('biblioteca').get('folder');
    const libraryFolderPath = vscode.workspace.getConfiguration().get('rl.library.folder');

    if (libraryFolderPath) {
        const libraryFolderFullPath = path.resolve(libraryFolderPath);

        if (fs.existsSync(libraryFolderFullPath)) {
            const command = process.platform === 'win32'
                ? `start "" "${libraryFolderFullPath}"`
                : `xdg-open "${libraryFolderFullPath}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) vscode.window.showErrorMessage(`Erro ao abrir a Biblioteca: ${stderr}`);
            });
        } else {
            vscode.window.showErrorMessage('O diretório da Biblioteca configurado não existe.');
        }
    } else {
        vscode.window.showErrorMessage('Configure o caminho da Biblioteca no arquivo settings.json.');
    }
});

    // Função genérica para salvar na biblioteca
    async function saveToLibrary(resource, projectType, configKey) {
    const libraryFolderPath = vscode.workspace.getConfiguration().get(`rl.library.${configKey}`);

    if (!resource || !resource.fsPath || !fs.statSync(resource.fsPath).isDirectory()) {
        vscode.window.showErrorMessage('Selecione uma pasta válida para salvar.');
        return;
    }

    if (!libraryFolderPath) {
        vscode.window.showErrorMessage(`Configure o caminho da Biblioteca (${projectType}) no arquivo settings.json.`);
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Não foi possível identificar a raiz do workspace.');
        return;
    }

    const relativePath = path.relative(workspaceRoot, resource.fsPath);
    const targetPath = path.join(libraryFolderPath, relativePath);

    try {
        copyFolderRecursive(resource.fsPath, targetPath);
        vscode.window.showInformationMessage(`Projeto ${projectType} salvo na Biblioteca em: ${targetPath}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Erro ao salvar: ${error.message}`);
    }
}


    // Comandos específicos
const disposableSaveAngularFrontend = vscode.commands.registerCommand('extension.saveAngularFrontend', (resource) => {
    saveToLibrary(resource, 'Angular Frontend', 'angular-frontend');
});

const disposableSaveAngularBackend = vscode.commands.registerCommand('extension.saveAngularBackend', (resource) => {
    saveToLibrary(resource, 'Angular Backend', 'angular-backend');
});

const disposableSaveUnity = vscode.commands.registerCommand('extension.saveUnity', (resource) => {
    saveToLibrary(resource, 'Unity', 'unity');
});

    context.subscriptions.push(
        disposableOpenLibrary,
        disposableSaveAngularFrontend,
        disposableSaveAngularBackend,
        disposableSaveUnity
    );
}

function deactivate() { }

// Função para copiar pastas recursivamente
function copyFolderRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyFolderRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

module.exports = {
    activate,
    deactivate
};
