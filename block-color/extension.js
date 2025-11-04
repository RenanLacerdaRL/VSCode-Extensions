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
        ignoredPrefixes: cfg.get('ignoredPrefixes', []),
        allowPlainBlock: cfg.get('allowPlainBlock', false),
        allowPlainBlockTextColor: cfg.get('allowPlainBlockTextColor', '#ffaa00') // nova configuração
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
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
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
                e.affectsConfiguration('rl.block-color.ignoredPrefixes') ||
                e.affectsConfiguration('rl.block-color.allowPlainBlock') ||
                e.affectsConfiguration('rl.block-color.allowPlainBlockTextColor')
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
            borderWidth: '1px 1px 0 1px',
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
            borderWidth: '0 1px 0 1px',
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
            borderWidth: '0 1px 1px 1px',
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
        ignoredPrefixes,
        allowPlainBlock,
        allowPlainBlockTextColor
    } = config;

    const doc = editor.document;
    const lines = doc.getText().split(/\r?\n/);

    if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    decorationTypes.forEach(d => d.dispose());
    decorationTypes = [];

    const reHex = /^(\s*)\/\/.*?\{\s*(#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}))\s*\}/;
    const reDefault = /^(\s*)\/\/.*?#([\w-]+)\b/;
    const rePlain = /^(\s*)\/\/\s*([\w-]+)\b/;

    const starts = [];

    let braceDepth = 0;
    let classDepth = 0;

    lines.forEach((ln, idx) => {
        if (/\bclass\b/.test(ln)) {
            classDepth++;
        }

        const openCount = (ln.match(/{/g) || []).length;
        const closeCount = (ln.match(/}/g) || []).length;
        braceDepth += openCount - closeCount;

        if (classDepth > 0 && braceDepth === 1) {
            const mHex = reHex.exec(ln);
            const mDefault = reDefault.exec(ln);

            if (mHex) {
                starts.push({ line: idx, color: mHex[2] });
            } else if (mDefault) {
                starts.push({ line: idx, color: defaultColor });
            } else if (allowPlainBlock) {
                const mPlain = rePlain.exec(ln);
                if (mPlain) {
                    // adiciona cor para o texto do comentário
                    const textDeco = vscode.window.createTextEditorDecorationType({
                        color: allowPlainBlockTextColor
                    });
                    decorationTypes.push(textDeco);

                    editor.setDecorations(
                        textDeco,
                        [new vscode.Range(idx, ln.indexOf('//'), idx, ln.length)]
                    );

                    // ainda marca o bloco para borda/fundo normal
                    starts.push({ line: idx, color: defaultColor });
                }
            }
        }

        if (classDepth > 0 && braceDepth === 0) {
            classDepth = 0;
        }
    });

    const blocks = [];
    for (let i = 0; i < starts.length; i++) {
        const startLine = starts[i].line;
        const color = starts[i].color;
        const endLine = (i + 1 < starts.length) ? starts[i + 1].line - 1 : lines.length - 1;
        if (endLine >= startLine) {
            blocks.push({ start: startLine, end: endLine, color });
        }
    }

    for (let k = 0; k < blocks.length; k++) {
        const { start: startLine, end: endLine, color } = blocks[k];

        const hasPrev = k > 0 && (blocks[k - 1].end + 1 === startLine);
        const hasNext = k < blocks.length - 1 && (endLine + 1 === blocks[k + 1].start);

        if (startLine === endLine) {
            const topBorder = !hasPrev;
            const bottomBorder = !hasNext;
            const borderWidth = `${topBorder ? 1 : 0}px 1px ${bottomBorder ? 1 : 0}px 1px`;
            let borderRadius = '0 0 0 0';
            if (topBorder && bottomBorder) borderRadius = '4px 4px 4px 4px';
            else if (topBorder && !bottomBorder) borderRadius = '4px 4px 0 0';
            else if (!topBorder && bottomBorder) borderRadius = '0 0 4px 4px';

            const singleDeco = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                ...(showBorder && {
                    borderWidth,
                    borderStyle: 'solid',
                    borderColor: color,
                    borderRadius
                }),
                ...(showBackground && { backgroundColor: color + '10' })
            });

            decorationTypes.push(singleDeco);
            editor.setDecorations(singleDeco, [new vscode.Range(startLine, 0, startLine, lines[startLine].length)]);
            continue;
        }

        const topDeco = hasPrev
            ? vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                ...(showBorder && {
                    borderWidth: '0 1px 0 1px',
                    borderStyle: 'solid',
                    borderColor: color
                }),
                ...(showBackground && { backgroundColor: color + '10' })
            })
            : createTopDecoration(color, showBackground, showBorder);

        const midDeco = createMiddleDecoration(color, showBackground, showBorder);

        const botDeco = hasNext
            ? vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                ...(showBorder && {
                    borderWidth: '0 1px 1px 1px',
                    borderStyle: 'solid',
                    borderColor: color,
                    borderRadius: '0 0 0 0'
                }),
                ...(showBackground && { backgroundColor: color + '10' })
            })
            : createBottomDecoration(color, showBackground, showBorder);

        decorationTypes.push(topDeco, midDeco, botDeco);

        editor.setDecorations(topDeco, [new vscode.Range(startLine, 0, startLine, lines[startLine].length)]);

        if (endLine > startLine + 1) {
            const midRanges = [];
            for (let i = startLine + 1; i < endLine; i++) {
                midRanges.push(new vscode.Range(i, 0, i, lines[i].length));
            }
            editor.setDecorations(midDeco, midRanges);
        }

        editor.setDecorations(botDeco, [new vscode.Range(endLine, 0, endLine, lines[endLine].length)]);
    }

    const docText = doc.getText();
    const enumsFound = ignoreEnums ? getEnumNames(docText) : new Set();
    const importedEnums = ignoreEnums ? getImportedEnumNames(lines) : new Set();
    const allEnums = new Set([...enumsFound, ...importedEnums]);

    if (enableStaticNames) {
    // calcula, por linha, se estamos dentro do corpo de uma classe
    const inClassPerLine = [];
    let braceDepthScan = 0;
    let classSeen = false;
    lines.forEach((ln, idx) => {
        if (/\bclass\b/.test(ln)) classSeen = true;
        const openCount = (ln.match(/{/g) || []).length;
        const closeCount = (ln.match(/}/g) || []).length;
        braceDepthScan += openCount - closeCount;
        inClassPerLine[idx] = classSeen && braceDepthScan > 0;
    });

    const staticMethodDecoration = vscode.window.createTextEditorDecorationType({ color: staticMethodColor });
    decorationTypes.push(staticMethodDecoration);

    // Nome. (A-Z ou minúsculo importado)
    const staticClassRegex = /\b([A-Za-z_]\w*)\b(?=\.)/g;
    // Nome( (ex: Number(, Math(, Date()
    const staticCallRegex  = /\b([A-Z]\w*)\b(?=\s*\()/g;
    const staticClassRanges = [];

    const globalStaticClasses = [
        'Number', 'Math', 'Date', 'Object', 'String',
        'Array', 'JSON', 'Symbol', 'BigInt', 'Reflect'
    ];

    // nomes importados (extraídos dos imports)
    const importedNames = new Set();
    lines.forEach(line => {
        const m = line.match(/import\s*{\s*([^}]+)\s*}/);
        if (m) {
            m[1].split(',').forEach(name => {
                const clean = name.trim().split(/\s+as\s+/)[0];
                if (clean) importedNames.add(clean);
            });
        }
    });

    lines.forEach((text, line) => {
        const t = text.trim();
        if (t.startsWith('//') || t.startsWith('using') || t.startsWith('import') || !inClassPerLine[line]) return;

        let m;

        // Nome. — pinta classes e variáveis importadas
        staticClassRegex.lastIndex = 0;
        while ((m = staticClassRegex.exec(text)) !== null) {
            const start = m.index;
            const name = m[1];
            const prefix = text.slice(Math.max(0, start - 10), start);

            if (/(?:\bthis|\bsuper)(\?\.)?\.$/.test(prefix)) continue;
            if (ignoreEnums && allEnums.has(name)) continue;
            if (ignoredPrefixes.some(ignored => name.endsWith(ignored))) continue;

            // pinta se começa com maiúscula (classe) ou se é importado
            if (/^[A-Z]/.test(name) || importedNames.has(name)) {
                staticClassRanges.push(new vscode.Range(line, start, line, start + name.length));
            }
        }

        // Nome( — global static calls
        staticCallRegex.lastIndex = 0;
        while ((m = staticCallRegex.exec(text)) !== null) {
            const start = m.index;
            const name = m[1];
            if (globalStaticClasses.includes(name)) {
                staticClassRanges.push(new vscode.Range(line, start, line, start + name.length));
            }
        }
    });

    editor.setDecorations(staticMethodDecoration, staticClassRanges);
}

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

    if (enableDefinedMethodColor) {
        const definedMethodDecoration = vscode.window.createTextEditorDecorationType({ color: definedMethodColor });
        decorationTypes.push(definedMethodDecoration);

        const definedMethodRanges = [];
        const methodRegex = /\b(?:public|private|protected|async\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::\s*[^({\n]+)?\s*{/g;

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
