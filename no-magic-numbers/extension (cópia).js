const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('noMagicNumbers');

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDiagnostics(editor.document);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            updateDiagnostics(e.document);
        }),
        diagnosticsCollection
    );
}

function deactivate() {
    if (diagnosticsCollection) {
        diagnosticsCollection.dispose();
    }
}

function updateDiagnostics(document) {
    // Ignorar arquivos em node_modules
    if (document.uri.fsPath.includes('/node_modules/') || document.uri.fsPath.includes('\\node_modules\\')) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];


    if (!langs.includes(document.languageId)) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const diagnostics = [];
    const text = document.getText();
    const lines = text.split('\n');

    const enumLines = new Set();
    let insideEnum = false;
    let insideString = false;

    // Pré-processar para ignorar enums e strings
    lines.forEach((line, index) => {
        const trimmed = line.trim();

        // Verificar enums
        if (/^\s*(export\s+)?enum\s+\w+/.test(trimmed)) {
            insideEnum = true;
        }
        if (insideEnum) {
            enumLines.add(index);
            if (trimmed.endsWith('}')) {
                insideEnum = false;
            }
        }

        // Verificar strings (simplificado - pode precisar de ajustes para casos complexos)
        if (line.includes('"') || line.includes("'")) {
            insideString = !insideString;
        }
        if (insideString) {
            enumLines.add(index); // Reutilizando o Set para marcar linhas com strings
        }
    });

    const magicNumberRegex = /(?<![\w."'])(-?\d+(\.\d+)?)(?![\w."'])/g;
    let match;

    // Função para verificar se a posição está dentro de comentário
    function isInsideComment(position) {
        // Obter o texto até essa posição
        const offset = document.offsetAt(position);

        // Verificar comentários de bloco /* ... */
        const textBefore = text.slice(0, offset);
        const openBlockComment = textBefore.lastIndexOf('/*');
        const closeBlockComment = textBefore.lastIndexOf('*/');
        if (openBlockComment > closeBlockComment) {
            return true;
        }

        // Verificar comentário de linha //
        const lineText = document.lineAt(position.line).text;
        const commentIndex = lineText.indexOf('//');
        if (commentIndex !== -1 && position.character >= commentIndex) {
            return true;
        }

        return false;
    }

    while ((match = magicNumberRegex.exec(text)) !== null) {
        const numStr = match[1];
        const numValue = Number(numStr);

        if ([0, 1, -1].includes(numValue)) {
            continue;
        }

        const startIndex = match.index + match[0].indexOf(numStr);
        const position = document.positionAt(startIndex);
        const lineIndex = position.line;
        const lineText = document.lineAt(lineIndex).text.trim();

        // Ignorar enums e strings
        if (enumLines.has(lineIndex)) {
            continue;
        }

        // Ignorar arrays literais
        const arrayLiteralPattern = /=\s*\[.*\]/;
        if (arrayLiteralPattern.test(lineText)) {
            continue;
        }

        // Ignorar declarações explícitas em TS/JS (incluindo strings)
        if (document.languageId.startsWith('typescript') || document.languageId.startsWith('javascript')) {
            const tsDeclPattern = /^(const|let|var)\s+\w+(\s*:\s*[\w\<\>\[\]]+)?\s*=\s*(["'].*["']|[\w.]+)/;
            if (tsDeclPattern.test(lineText)) {
                continue;
            }
        }

        // Ignorar declarações explícitas em C#
        if (document.languageId === 'csharp') {
            const csDeclPattern = /^\s*(?:public|private|protected|internal)?\s*(?:const\s+)?\w+\s+\w+\s*=\s*(["'].*["']|[\w.]+)/;

            if (csDeclPattern.test(lineText)) {
                continue;
            }
        }

        // **Nova verificação para ignorar números dentro de comentários**
        if (isInsideComment(position)) {
            continue;
        }

        const startPos = position;
        const endPos = document.positionAt(startIndex + numStr.length);
        const range = new vscode.Range(startPos, endPos);

        diagnostics.push(
            new vscode.Diagnostic(
                range,
                `Número mágico detectado: ${numStr}`,
                vscode.DiagnosticSeverity.Warning
            )
        );
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = {
    activate,
    deactivate
};
