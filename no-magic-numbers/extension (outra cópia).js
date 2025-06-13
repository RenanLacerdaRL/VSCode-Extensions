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
    let insideStringBlock = false;

    // Pré-processar para ignorar enums e blocos de strings
    lines.forEach((line, index) => {
        const trimmed = line.trim();

        if (/^\s*(export\s+)?enum\s+\w+/.test(trimmed)) {
            insideEnum = true;
        }
        if (insideEnum) {
            enumLines.add(index);
            if (trimmed.endsWith('}')) {
                insideEnum = false;
            }
        }

        const quoteCount = (line.match(/["']/g) || []).length;
        if (quoteCount % 2 !== 0) {
            insideStringBlock = !insideStringBlock;
        }

        if (insideStringBlock || line.includes('"') || line.includes("'")) {
            enumLines.add(index);
        }
    });

    const magicNumberRegex = /(?<![\w."'])-?\d+(\.\d+)?(?![\w."'])/g;
    let match;

    function isInsideComment(position) {
        const offset = document.offsetAt(position);
        const textBefore = text.slice(0, offset);

        const openBlockComment = textBefore.lastIndexOf('/*');
        const closeBlockComment = textBefore.lastIndexOf('*/');
        if (openBlockComment > closeBlockComment) return true;

        const lineText = document.lineAt(position.line).text;
        const commentIndex = lineText.indexOf('//');
        return commentIndex !== -1 && position.character >= commentIndex;
    }

    while ((match = magicNumberRegex.exec(text)) !== null) {
        const numStr = match[0];
        const numValue = Number(numStr);

        if ([0, 1, -1].includes(numValue)) {
            continue;
        }

        const startIndex = match.index;
        const position = document.positionAt(startIndex);
        const lineIndex = position.line;
        const lineText = document.lineAt(lineIndex).text.trim();

        // Ignorar enums e strings
        if (enumLines.has(lineIndex)) continue;

        // Ignorar arrays literais
        const arrayLiteralPattern = /=\s*\[.*\]/;
        if (arrayLiteralPattern.test(lineText)) continue;

        // Ignorar declarações literais simples em JS/TS
        if (document.languageId.startsWith('typescript') || document.languageId.startsWith('javascript')) {
            const tsDeclPattern = /^\s*(const|let|var)\s+\w+(\s*:\s*[\w<>\[\]]+)?\s*=\s*-?\d+(\.\d+)?\s*;?$/;
            if (tsDeclPattern.test(lineText.trim())) continue;

            const tsReadonlyPattern = /^\s*(public\s+|private\s+|protected\s+)?static\s+readonly\s+\w+\s*=\s*-?\d+(\.\d+)?\s*;?$/;
            if (tsReadonlyPattern.test(lineText.trim())) continue;

            // Ignorar chaves numéricas dentro de objetos (ex: responsive: { 400: { ... } })
            const objectKeyPattern = /^\s*-?\d+(\.\d+)?\s*:\s*{\s*$/;
            if (objectKeyPattern.test(lineText.trim())) continue;
        }

        // Ignorar declarações literais simples em C#
        if (document.languageId === 'csharp') {
            const csDeclPattern = /^\s*(?:public|private|protected|internal)?\s*(?:const\s+)?\w+\s+\w+\s*=\s*-?\d+(\.\d+)?\s*;?$/;
            if (csDeclPattern.test(lineText.trim())) continue;
        }

        // Ignorar propriedades de objetos (ex: fontSize: 10)
        const propertyPattern = /^\s*\w+\s*:\s*-?\d+(\.\d+)?\s*,?\s*$/;
        if (propertyPattern.test(lineText)) continue;

        // Ignorar dentro de comentários
        if (isInsideComment(position)) continue;

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
