const vscode = require('vscode');

let decorationTypes = [];

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('rl.block-color');
    return {
        showBackground: cfg.get('showBackground', false),
        showBorder: cfg.get('showBorder', true),
        defaultColor: cfg.get('defaultColor', '#cccccc'),
        staticMethodColor: cfg.get('staticMethodColor', '#f44747'),
        newClassColor: cfg.get('newClassColor', '#569CD6'),
        definedMethodColor: cfg.get('definedMethodColor', '#00ff99'),
        decoratorColor: cfg.get('decoratorColor', '#c586c0'),
        enableStaticNames: cfg.get('enableStaticNames', true),
        enableNewClassNames: cfg.get('enableNewClassNames', true),
        enableDefinedMethodColor: cfg.get('enableDefinedMethodColor', true),
        enableDecoratorColor: cfg.get('enableDecoratorColor', true),
        ignoreEnums: cfg.get('ignoreEnums', true),
        ignoredPrefixes: cfg.get('ignoredPrefixes', [])
    };
}

function activate(context) {
    if (vscode.window.activeTextEditor) {
        updateDecorations(vscode.window.activeTextEditor);
    }
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDecorations(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.activeTextEditor && e.document === e.document) {
                updateDecorations(vscode.window.activeTextEditor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('rl.block-color.showBackground') ||
                e.affectsConfiguration('rl.block-color.showBorder') ||
                e.affectsConfiguration('rl.block-color.defaultColor') ||
                e.affectsConfiguration('rl.block-color.staticMethodColor') ||
                e.affectsConfiguration('rl.block-color.newClassColor') ||
                e.affectsConfiguration('rl.block-color.definedMethodColor') ||
                e.affectsConfiguration('rl.block-color.decoratorColor') ||
                e.affectsConfiguration('rl.block-color.enableStaticNames') ||
                e.affectsConfiguration('rl.block-color.enableNewClassNames') ||
                e.affectsConfiguration('rl.block-color.enableDefinedMethodColor') ||
                e.affectsConfiguration('rl.block-color.enableDecoratorColor') ||
                e.affectsConfiguration('rl.block-color.ignoreEnums') ||
                e.affectsConfiguration('rl.block-color.ignoredPrefixes')
            ) {
                if (vscode.window.activeTextEditor) {
                    updateDecorations(vscode.window.activeTextEditor);
                }
            }
        })
    );
}

function deactivate() {
    decorationTypes.forEach(d => d.dispose());
    decorationTypes = [];
}

// Decorações de bloco
function createTopDecoration(color, showBg, showBorder) {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        ...(showBorder && {
            borderWidth: '2px 2px 0 2px',
            borderStyle: 'solid',
            borderColor: color,
            borderRadius: '4px 4px 0 0'
        }),
        ...(showBg && { backgroundColor: color + '10' })
    });
}

function createMiddleDecoration(color, showBg, showBorder) {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        ...(showBorder && {
            borderWidth: '0 2px 0 2px',
            borderStyle: 'solid',
            borderColor: color
        }),
        ...(showBg && { backgroundColor: color + '10' })
    });
}

function createBottomDecoration(color, showBg, showBorder) {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        ...(showBorder && {
            borderWidth: '0 2px 2px 2px',
            borderStyle: 'solid',
            borderColor: color,
            borderRadius: '0 0 4px 4px'
        }),
        ...(showBg && { backgroundColor: color + '10' })
    });
}

// Detecta enums
function getEnumNames(text) {
    const enumNames = new Set();
    const enumPattern = /^\s*export\s+enum\s+([A-Z]\w*)\b|^\s*enum\s+([A-Z]\w*)\b/gm;
    let m;
    while ((m = enumPattern.exec(text)) !== null) {
        const name = m[1] || m[2];
        if (name) enumNames.add(name);
    }
    return enumNames;
}

function getImportedEnumNames(lines) {
    const importedEnums = new Set();
    const importEnumRegex = /^\s*import\s+\{\s*([\w\s,]+)\s*\}\s+from\s+['"].*\.enum['"];?/;
    lines.forEach(line => {
        const match = importEnumRegex.exec(line);
        if (match && match[1]) {
            match[1].split(',').map(n => n.trim()).forEach(n => importedEnums.add(n));
        }
    });
    return importedEnums;
}

// Função principal
function updateDecorations(editor) {
    const config = getConfig();
    const {
        showBackground,
        showBorder,
        defaultColor,
        staticMethodColor,
        newClassColor,
        definedMethodColor,
        decoratorColor,
        enableStaticNames,
        enableNewClassNames,
        enableDefinedMethodColor,
        enableDecoratorColor,
        ignoreEnums,
        ignoredPrefixes
    } = config;

    const doc = editor.document;
    const lines = doc.getText().split(/\r?\n/);

    decorationTypes.forEach(d => d.dispose());
    decorationTypes = [];

    // Blocos via comentários
    const reHex = /^(\s*)\/\/.*?\{\s*(#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}))\s*\}/;
    const reDefault = /^(\s*)\/\/.*?#([A-Z][\w]*)\b/;
    const starts = [];

    lines.forEach((ln, idx) => {
        const mHex = reHex.exec(ln);
        const mDefault = reDefault.exec(ln);

        if (mHex) starts.push({ line: idx, color: mHex[2] });
        else if (mDefault) starts.push({ line: idx, color: defaultColor });
    });

    for (let k = 0; k < starts.length; k++) {
        const { line: startLine, color } = starts[k];
        const endLine = (k + 1 < starts.length) ? starts[k + 1].line - 1 : lines.length - 1;
        if (endLine < startLine) continue;

        const topDeco = createTopDecoration(color, showBackground, showBorder);
        const midDeco = createMiddleDecoration(color, showBackground, showBorder);
        const botDeco = createBottomDecoration(color, showBackground, showBorder);
        decorationTypes.push(topDeco, midDeco, botDeco);

        editor.setDecorations(topDeco, [new vscode.Range(startLine, 0, startLine, lines[startLine].length)]);

        if (endLine > startLine + 1) {
            const midRanges = [];
            for (let i = startLine + 1; i < endLine; i++) {
                midRanges.push(new vscode.Range(i, 0, i, lines[i].length));
            }
            editor.setDecorations(midDeco, midRanges);
        }

        if (endLine > startLine) {
            editor.setDecorations(botDeco, [new vscode.Range(endLine, 0, endLine, lines[endLine].length)]);
        }
    }

    // Detecta enums
    const docText = doc.getText();
    const enumsFound = ignoreEnums ? getEnumNames(docText) : new Set();
    const importedEnums = ignoreEnums ? getImportedEnumNames(lines) : new Set();
    const allEnums = new Set([...enumsFound, ...importedEnums]);

    // Métodos estáticos
    if (enableStaticNames) {
        const staticMethodDecoration = vscode.window.createTextEditorDecorationType({ color: staticMethodColor });
        decorationTypes.push(staticMethodDecoration);

        const staticClassRegex = /\b([A-Z]\w*)\b(?=\.)/g;
        const staticClassRanges = [];

        lines.forEach((text, line) => {
            if (text.trim().startsWith('//')) return;

            let m;
            while ((m = staticClassRegex.exec(text)) !== null) {
                const start = m.index;
                const className = m[1];
                const prefix = text.slice(Math.max(0, start - 10), start);
                if (/(?:\bthis|\bsuper)(\?\.)?\.$/.test(prefix)) continue;
                if (ignoreEnums && allEnums.has(className)) continue;
                if (ignoredPrefixes.some(ignored => className.endsWith(ignored))) continue;

                staticClassRanges.push(new vscode.Range(line, start, line, start + className.length));
            }
        });

        editor.setDecorations(staticMethodDecoration, staticClassRanges);
    }

    // Classes instanciadas com "new"
    if (enableNewClassNames) {
        const newClassDecoration = vscode.window.createTextEditorDecorationType({ color: newClassColor });
        decorationTypes.push(newClassDecoration);

        const newClassRegex = /\bnew\s+([A-Z]\w*)\b/g;
        const newClassRanges = [];

        lines.forEach((text, line) => {
            if (text.trim().startsWith('//')) return;
            let m;
            while ((m = newClassRegex.exec(text)) !== null) {
                const start = m.index + 4;
                const className = m[1];
                if (ignoredPrefixes.some(ignored => className.endsWith(ignored))) continue;
                if (ignoreEnums && allEnums.has(className)) continue;
                newClassRanges.push(new vscode.Range(line, start, line, start + className.length));
            }
        });

        editor.setDecorations(newClassDecoration, newClassRanges);
    }

    // Métodos definidos no próprio arquivo
    if (enableDefinedMethodColor) {
        const definedMethodDecoration = vscode.window.createTextEditorDecorationType({ color: definedMethodColor });
        decorationTypes.push(definedMethodDecoration);

        const definedMethodRanges = [];
        const methodRegex = /\b(?:public|private|protected|async\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::\s*[\w<>,\s]+)?\s*\{/g;

        lines.forEach((text, line) => {
            if (text.trim().startsWith('//')) return;

            let m;
            while ((m = methodRegex.exec(text)) !== null) {
                const methodName = m[1];
                const keywords = new Set(["if", "for", "while", "switch", "catch", "function", "return", "try"]);
                if (keywords.has(methodName)) continue;

                const start = text.indexOf(methodName, m.index);
                const end = start + methodName.length;
                definedMethodRanges.push(new vscode.Range(line, start, line, end));
            }
        });

        editor.setDecorations(definedMethodDecoration, definedMethodRanges);
    }

    // Decorators @
    if (enableDecoratorColor) {
        const decoratorDecoration = vscode.window.createTextEditorDecorationType({ color: decoratorColor });
        decorationTypes.push(decoratorDecoration);

        const decoratorRegex = /(@[A-Za-z_]\w*)/g;
        const decoratorRanges = [];

        lines.forEach((text, line) => {
             const trimmed = text.trim();
             if (trimmed.startsWith('//') || trimmed.startsWith('import')) return;

            let m;
            while ((m = decoratorRegex.exec(text)) !== null) {
                const start = m.index;
                const end = start + m[1].length;
                decoratorRanges.push(new vscode.Range(line, start, line, end));
            }
        });

        editor.setDecorations(decoratorDecoration, decoratorRanges);
    }
}

module.exports = { activate, deactivate };
