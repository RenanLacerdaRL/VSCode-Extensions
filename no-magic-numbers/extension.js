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

    const config = vscode.workspace.getConfiguration('noMagicNumbers');
    const ignoreConstructors = config.get('ignoreConstructors') || [];

    const diagnostics = [];
    const text = document.getText();
    const lines = text.split('\n');

    const enumLines = new Set();
    let insideEnum = false;
    let insideStringBlock = false;
    let insideTemplateBlock = false;

    // Pré-processar para ignorar enums, strings e template literals
    lines.forEach((line, index) => {
        const trimmed = line.trim();

        // enum blocks
        if (/^\s*(export\s+)?enum\s+\w+/.test(trimmed)) {
            insideEnum = true;
        }
        if (insideEnum) {
            enumLines.add(index);
            if (trimmed.endsWith('}')) {
                insideEnum = false;
            }
        }

        // string blocks (' or ")
        const quoteCount = (line.match(/["']/g) || []).length;
        if (quoteCount % 2 !== 0) {
            insideStringBlock = !insideStringBlock;
        }
        if (insideStringBlock || /['"]/.test(line)) {
            enumLines.add(index);
        }

        // template literal blocks (`)
        const backtickCount = (line.match(/`/g) || []).length;
        if (backtickCount % 2 !== 0) {
            insideTemplateBlock = !insideTemplateBlock;
        }
        if (insideTemplateBlock || /`/.test(line)) {
            enumLines.add(index);
        }
    });

    const magicNumberRegex = /(?<![\w.\"'])-?\d+(\.\d+)?(?![\w.\"'])/g;
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

        // Ignorar linhas de enum, strings e template literals
        if (enumLines.has(lineIndex)) continue;

        const lineText = document.lineAt(lineIndex).text.trim();

        // Ignorar linhas que contenham instâncias de construtores a ignorar
        let shouldIgnore = false;
        for (const className of ignoreConstructors) {
            const constructorPattern = new RegExp(`new\\s+${className}\\s*\\(|\\b${className}\\s*\\(`);
            if (constructorPattern.test(lineText)) {
                shouldIgnore = true;
                break;
            }
        }
        if (shouldIgnore) continue;

        const regexLiteralPattern = /=\s*\/.*\/[gimsuy]*\s*;?$/;
        if (regexLiteralPattern.test(lineText)) continue;

        const arrayLiteralPattern = /=\s*\[.*\]/;
        if (arrayLiteralPattern.test(lineText)) continue;

        if (document.languageId.startsWith('typescript') || document.languageId.startsWith('javascript')) {
            const tsDeclPattern = /^\s*(const|let|var)\s+\w+(\s*:\s*[\w<>\[\]]+)?\s*=\s*-?\d+(\.\d+)?\s*;?$/;
            if (tsDeclPattern.test(lineText)) continue;

            const tsReadonlyPattern = /^\s*(public\s+|private\s+|protected\s+)?static\s+readonly\s+\w+\s*=\s*-?\d+(\.\d+)?\s*;?$/;
            if (tsReadonlyPattern.test(lineText)) continue;

            const objectKeyPattern = /^\s*-?\d+(\.\d+)?\s*:\s*{\s*$/;
            if (objectKeyPattern.test(lineText)) continue;
        }

        if (document.languageId === 'csharp') {
            const csDeclPattern = /^\s*(?:public|private|protected|internal)?\s*(?:const\s+)?\w+\s+\w+\s*=\s*-?\d+(\.\d+)?\s*;?$/;
            if (csDeclPattern.test(lineText)) continue;
        }

        const propertyPattern = /^\s*\w+\s*:\s*-?\d+(\.\d+)?\s*,?\s*$/;
        if (propertyPattern.test(lineText)) continue;

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
