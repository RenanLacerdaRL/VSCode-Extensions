const vscode = require('vscode');

let diagnosticsCollection;
let statusBarItem;

const jsTsReserved = new Set([
  'break','case','catch','class','const','continue','debugger','default',
  'delete','do','else','export','extends','finally','for','function','if',
  'import','in','instanceof','new','return','super','switch','this','throw',
  'try','typeof','var','void','while','with','yield','let','static','enum',
  'await','implements','interface','package','private','protected','public',
  'readonly'
]);
const csharpReserved = new Set([
  'abstract','as','base','bool','break','byte','case','catch','char','checked',
  'class','const','continue','decimal','default','delegate','do','double','else',
  'enum','event','explicit','extern','false','finally','fixed','float','for',
  'foreach','goto','if','implicit','in','int','interface','internal','is','lock',
  'long','namespace','new','null','object','operator','out','override','params',
  'private','protected','public','readonly','ref','return','sbyte','sealed','short',
  'sizeof','stackalloc','static','string','struct','switch','this','throw','true',
  'try','typeof','uint','ulong','unchecked','unsafe','ushort','using','virtual',
  'void','volatile','while'
]);

function activate(context) {
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('unusedSymbols');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(search) Variáveis e métodos não usados';
  statusBarItem.tooltip = 'Clique para verificar variáveis e métodos não utilizados no projeto (públicas e privadas)';
  statusBarItem.command = 'unusedSymbols.checkUnused';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const disposable = vscode.commands.registerCommand('unusedSymbols.checkUnused', async () => {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showInformationMessage('Abra uma pasta de projeto para fazer a verificação.');
      return;
    }
    await checkUnusedSymbols();
  });
  context.subscriptions.push(disposable);
}

function deactivate() {
  if (diagnosticsCollection) diagnosticsCollection.dispose();
  if (statusBarItem) statusBarItem.dispose();
}

async function checkUnusedSymbols() {
  diagnosticsCollection.clear();

  const ignoredMethods = new Set([
    'OnTriggerEnter','OnTriggerExit','OnTriggerStay',
    'OnCollisionEnter','OnCollisionExit','OnCollisionStay',
    'OnControllerColliderHit','OnParticleCollision',
    'Awake','Start','Update','FixedUpdate','LateUpdate',
    'OnEnable','OnDisable','OnDestroy',
  ]);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Verificando métodos e variáveis não usadas no projeto...',
    cancellable: false
  }, async () => {
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,js,html,cs}',
      '{**/node_modules/**,**/[Cc]ore/**}'
    );
    const docs = await Promise.all(files.map(f => vscode.workspace.openTextDocument(f)));

    const declaredSymbols = [];

    const methodRegexes = {
      ts: [
        /\b(?:public|private)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g,
        /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
        /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*function\s*\([^)]*\)/g
      ],
      js: [
        /function\s+(\w+)\s*\([^)]*\)\s*\{/g,
        /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
        /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*function\s*\([^)]*\)/g
      ],
      cs: [
        /\b(?:public|private)?\s*(?:static\s+)?(?:void|\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g,
        /\[SerializeField\]\s+\w+\s+(\w+)\s*;/g
      ]
    };
    const varRegexes = {
      ts: [
        /\b(?:public|private)?\s*(?:readonly\s+)?(\w+)\s*[:=]/g,
        /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*[:=]/g
      ],
      js: /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=/g,
      cs: [
        /\b(?:public|private)?\s*(?:static\s+)?\w+\s+(\w+)\s*(?:=|;)/g,
        /\[SerializeField\]\s+\w+\s+(\w+)\s*;/g
      ]
    };

    function extractSymbols(text, regexes) {
      const symbols = [];
      for (const regex of Array.isArray(regexes) ? regexes : [regexes]) {
        let m;
        while ((m = regex.exec(text)) !== null) {
          if (m[1]) symbols.push(m[1]);
        }
      }
      return symbols;
    }

    function stripCommentsAndStrings(text) {
      text = text.replace(/\/\*[\s\S]*?\*\//g, '');
      text = text.replace(/\/\/.*$/gm, '');
      text = text.replace(/'[^']*'/g, '');
      text = text.replace(/"[^"]*"/g, '');
      text = text.replace(/`[^`]*`/g, '');
      return text;
    }

    function isRealUsage(line, name) {
      if (new RegExp(`\\bas\\s+${name}\\b`).test(line)) return false;
      return new RegExp(`\\b${name}\\b`).test(line);
    }

    function isInsideObjectLiteral(text, index) {
      if (index > 0 && text[index - 1] === ':') {
        const beforeText = text.substring(0, index);
        const openBraces = (beforeText.match(/{/g) || []).length;
        const closeBraces = (beforeText.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
          return true;
        }
      }
      return false;
    }

    for (const doc of docs) {
      let text = doc.getText();
      const lang = doc.languageId;
      if (lang === 'csharp') {
        text = text.split('\n').filter(l => !l.trim().startsWith('using ')).join('\n');
      }
      const clean = stripCommentsAndStrings(text);

      let methods = [], vars = [];
      if (lang.startsWith('typescript')) {
        methods = extractSymbols(clean, methodRegexes.ts);
        vars    = extractSymbols(clean, varRegexes.ts);
      } else if (lang.startsWith('javascript')) {
        methods = extractSymbols(clean, methodRegexes.js);
        vars    = extractSymbols(clean, varRegexes.js);
      } else if (lang === 'csharp') {
        methods = extractSymbols(clean, methodRegexes.cs);
        vars    = extractSymbols(clean, varRegexes.cs);
      }

      for (const name of methods.concat(vars)) {
        if (ignoredMethods.has(name)) continue;
        if ((lang.startsWith('typescript') || lang.startsWith('javascript')) && jsTsReserved.has(name)) continue;
        if (lang === 'csharp' && csharpReserved.has(name)) continue;

        const firstIndex = clean.indexOf(name);
        if (isInsideObjectLiteral(clean, firstIndex)) continue;

        declaredSymbols.push({ name, uri: doc.uri, originalText: text, lang, isStaticMethod: isStaticMethod(clean, name) });
      }
    }

    // Função para detectar se o símbolo é método estático que retorna um tipo conhecido, exemplo OwlOptions
    // Para evitar falso positivo na função estática que retorna objeto tipado
    function isStaticMethod(text, methodName) {
      // Simples regex para método estático em TS/JS
      // ex: static Default() { ... }
      const staticMethodRegex = new RegExp(`static\\s+${methodName}\\s*\\([^)]*\\)\\s*{`);
      if (!staticMethodRegex.test(text)) return false;

      // Verifica se a função contém um return com um tipo específico (exemplo 'as OwlOptions')
      const methodStart = text.indexOf(`static ${methodName}`);
      if (methodStart === -1) return false;
      const methodBodyStart = text.indexOf('{', methodStart);
      const methodBodyEnd = findMatchingBrace(text, methodBodyStart);
      if (methodBodyStart === -1 || methodBodyEnd === -1) return false;
      const methodBody = text.substring(methodBodyStart, methodBodyEnd + 1);

      // Detecta retorno com type assertion as OwlOptions ou similar
      if (/return\s+{[\s\S]*}\s+as\s+\w+/m.test(methodBody)) {
        return true;
      }
      return false;
    }

    // Função auxiliar para encontrar a chave correspondente
    function findMatchingBrace(text, openBraceIndex) {
      let stack = 0;
      for (let i = openBraceIndex; i < text.length; i++) {
        if (text[i] === '{') stack++;
        else if (text[i] === '}') {
          stack--;
          if (stack === 0) return i;
        }
      }
      return -1;
    }

    const projectRaw = docs.map(d => d.getText()).join('\n');
    const project = stripCommentsAndStrings(projectRaw);
    const diagnosticsByUri = new Map();

    for (const { name, uri, originalText, lang, isStaticMethod } of declaredSymbols) {
      // Se for método estático com retorno tipo conhecido, assume usado (evita falso positivo)
      if (isStaticMethod) continue;

      const usageRegex = new RegExp(`\\b${name}\\b`, 'g');
      const matches = [...project.matchAll(usageRegex)];
      const real = matches.filter(m => {
        const idx   = m.index;
        const start = project.lastIndexOf('\n', idx) + 1;
        const end   = project.indexOf('\n', idx) + 1;
        const line  = project.substring(start, end > 0 ? end : project.length);
        return isRealUsage(line, name);
      });

      if (real.length <= 1) {
        const localCount = (originalText.match(usageRegex) || []).length;
        if (localCount > 1) continue;

        const idx = originalText.indexOf(name);
        if (idx !== -1) {
          const doc = await vscode.workspace.openTextDocument(uri);
          const pos = doc.positionAt(idx);
          const range = new vscode.Range(pos, pos.translate(0, name.length));
          const diag = new vscode.Diagnostic(
            range,
            `Símbolo não utilizado: "${name}"`,
            vscode.DiagnosticSeverity.Warning
          );
          const key = uri.toString();
          if (!diagnosticsByUri.has(key)) diagnosticsByUri.set(key, []);
          diagnosticsByUri.get(key).push(diag);
        }
      }
    }

    diagnosticsCollection.clear();
    for (const [uriStr, diags] of diagnosticsByUri) {
      diagnosticsCollection.set(vscode.Uri.parse(uriStr), diags);
    }

    vscode.window.showInformationMessage(`Verificação concluída: ${diagnosticsByUri.size} arquivos com símbolos não usados.`);
  });
}

module.exports = {
  activate,
  deactivate
};
