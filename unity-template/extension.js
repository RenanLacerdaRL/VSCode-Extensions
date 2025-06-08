const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function activate(context) {
    const disposableOpenTemplatesFolder = vscode.commands.registerCommand('extension.openTemplatesFolder', function (resource) {
        const templatesFolderPath = vscode.workspace.getConfiguration('unityTemplate').get('templateFolder');

        if (templatesFolderPath) {
            const templatesFolderFullPath = path.resolve(templatesFolderPath);

            if (fs.existsSync(templatesFolderFullPath)) {
                const command = process.platform === 'win32' ? `start "" "${templatesFolderFullPath}"` : `xdg-open "${templatesFolderFullPath}"`;
                exec(command, (error, stdout, stderr) => {
                    if (error) vscode.window.showErrorMessage(`Erro ao abrir o Explorer: ${stderr}`);
                });
            } else {
                vscode.window.showErrorMessage('O diretório de templates configurado não existe.');
            }
        } else {
            vscode.window.showErrorMessage('Configure o caminho dos templates no arquivo settings.json.');
        }
    });
    const disposableCreateFileComponent = vscode.commands.registerCommand('extension.CreateFileComponent', async function (resource) {
        if (resource && resource.fsPath && fs.statSync(resource.fsPath).isDirectory()) {
            const folderPath = resource.fsPath;
            const newFileName = await vscode.window.showInputBox({
                prompt: 'Digite o nome do novo arquivo',
                validateInput: (value) => {
                    if (!value || value.trim() === '') return 'O nome do arquivo não pode estar vazio';
                    return null;
                }
            });

            if (newFileName) {
                const newFilePath = path.join(folderPath, `${newFileName}.cs`);

                if (fs.existsSync(newFilePath)) {
                    vscode.window.showErrorMessage('Já existe um arquivo com esse nome na pasta.');
                } else {
                    const className = capitalizeFirstLetter(newFileName.replace(/\.[^/.]+$/, ''));

                    fs.writeFileSync(newFilePath, generateFileContent(className));
                    vscode.window.showInformationMessage(`Novo arquivo "${newFileName}" criado com sucesso na pasta "${folderPath}"!`);
                }
            }
        } else {
            vscode.window.showErrorMessage('Selecione uma pasta válida para criar o arquivo.');
        }
    });
    const disposableCreateFileEvent = vscode.commands.registerCommand('extension.CreateFileEvent', async function (resource) {
        if (resource && resource.fsPath && fs.statSync(resource.fsPath).isDirectory()) {
            const folderPath = resource.fsPath;

            const newFileName = await vscode.window.showInputBox({
                prompt: 'Digite o nome do novo arquivo',
                validateInput: (value) => {
                    if (!value || value.trim() === '') return 'O nome do arquivo não pode estar vazio';
                    return null;
                }
            });

            if (newFileName) {
                const newFilePath = path.join(folderPath, `${newFileName}.cs`);

                if (fs.existsSync(newFilePath)) {
                    vscode.window.showErrorMessage('Já existe um arquivo com esse nome na pasta.');
                } else {
                    const className = capitalizeFirstLetter(newFileName.replace(/\.[^/.]+$/, ''));

                    fs.writeFileSync(newFilePath, generateFileContentEvent(className));
                    vscode.window.showInformationMessage(`Novo arquivo "${newFileName}" criado com sucesso na pasta "${folderPath}"!`);
                }
            }
        } else {
            vscode.window.showErrorMessage('Selecione uma pasta válida para criar o arquivo.');
        }
    });
    const disposableGenerateConstructor = vscode.commands.registerCommand('extension.GenerateConstructor', async function () {
        const editor = vscode.window.activeTextEditor;

        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const classNameMatch = document.getText().match(/(?:public\s+)?class\s+(\w+)/);
            const className = classNameMatch ? classNameMatch[1] : 'NewBehaviourScript';

            // Procura o construtor existente
            let constructorStartLine = -1;
            let constructorEndLine = -1;
            for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
                const lineText = document.lineAt(lineIndex).text.trim();

                if (lineText.startsWith(`public ${className}(`)) constructorStartLine = lineIndex;
                if (constructorStartLine !== -1 && lineText === '}') {
                    constructorEndLine = lineIndex;
                    break;
                }
            }

            // Remove o construtor existente se encontrado
            if (constructorStartLine !== -1 && constructorEndLine !== -1) {
                const range = new vscode.Range(constructorStartLine, 0, constructorEndLine + 1, 0);
                await editor.edit(editBuilder => {
                    editBuilder.delete(range);
                });
            }

            // Cria um novo construtor com base nas variáveis e no nome da classe
            constructorStartLine = -1;
            constructorEndLine = -1;
            const variablePattern = /\b(\w+(\[\])?)\s+(\w+);\s*/g;
            let match;
            const variables = [];
            while ((match = variablePattern.exec(document.getText(selection))) !== null) {
                const type = match[1];
                const name = match[3];
                variables.push({ type, name });
            }

            if (variables.length === 0) {
                vscode.window.showErrorMessage('Nenhuma variável válida encontrada na seleção.');
                return;
            }

            const newConstructorText = `\n    public ${className}(\n${variables.map(v => `        ${v.type} ${v.name}`).join(',\n')}\n    ) {\n${variables.map(v => `        this.${v.name} = ${v.name};`).join('\n')}\n    }`;
            const insertPosition = new vscode.Position(constructorEndLine !== -1 ? constructorEndLine + 1 : selection.end.line + 1, 0);
            await editor.edit(editBuilder => {
                editBuilder.insert(insertPosition, newConstructorText);
            });

            vscode.window.showInformationMessage('Novo construtor criado com sucesso!');
        }
    });
    const disposableCheckCsProj = vscode.commands.registerCommand('extension.CheckCsProj', async function (resource) {
        if (resource && resource.fsPath && fs.statSync(resource.fsPath).isFile() && resource.fsPath.endsWith('.cs')) {
            const csprojFilePath = findCsProjFile(vscode.workspace.rootPath);

            if (csprojFilePath) {
                const fileName = path.basename(resource.fsPath, '.cs');
                const directory = path.relative(path.dirname(csprojFilePath), path.dirname(resource.fsPath)).replace(/\\/g, '/');
                const compileItem = `<Compile Include="${directory}/${fileName}.cs" />`;
                const csprojContent = fs.readFileSync(csprojFilePath, 'utf8');

                if (csprojContent.includes(compileItem)) {
                    vscode.window.showInformationMessage(`${fileName}.cs já existe em ${csprojFilePath}`);
                } else {
                    const lastIndex = csprojContent.lastIndexOf('</ItemGroup>');
                    const modifiedCsprojContent = csprojContent.slice(0, lastIndex) + `\t${compileItem}\n` + csprojContent.slice(lastIndex);

                    fs.writeFileSync(csprojFilePath, modifiedCsprojContent, 'utf8');
                    vscode.window.showInformationMessage(`Adicionado ${fileName}.cs a ${csprojFilePath}`);
                }
            } else {
                vscode.window.showErrorMessage('Arquivo .csproj não encontrado. Certifique-se de estar em um projeto Unity.');
            }
        } else {
            vscode.window.showErrorMessage('Selecione um arquivo .cs válido para verificar.');
        }
    });

    context.subscriptions.push(disposableCopyFiles, disposableCreateFileComponent, disposableCreateFileEvent, disposableGenerateConstructor, disposableCheckCsProj);
}
function deactivate() { }

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function generateFileContent(className) {
    return `using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ${className} {

}`;
}
function generateFileContentEvent(className) {
    return `using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ${className} {
    public event Action<bool> OnEvent;

    public void Event(bool value) {
        OnEvent?.Invoke(value);
    }
}`;
}
function findCsProjFile(folderPath) {
    const files = fs.readdirSync(folderPath);
    const csprojFiles = files.filter(file => file === 'Assembly-CSharp.csproj');
    return csprojFiles.length > 0 ? path.join(folderPath, csprojFiles[0]) : null;
}
function addToCsProjFile(projectFilePath, newFileName) {
    const csprojContent = fs.readFileSync(projectFilePath, 'utf8');
    const fileName = path.basename(newFilePath, '.cs');
    const directory = path.relative(path.dirname(projectFilePath), path.dirname(newFilePath)).replace(/\\/g, '/');
    const compileItem = `<Compile Include="${directory}/${fileName}.cs" />`;

    if (csprojContent.includes(compileItem)) {
        console.log(`${newFileName}.cs já existe em ${projectFilePath}`);
        return;
    }
    const lastIndex = csprojContent.lastIndexOf('</ItemGroup>');
    const modifiedCsprojContent = csprojContent.slice(0, lastIndex) + `\t${compileItem}\n` + csprojContent.slice(lastIndex);
    
    fs.writeFileSync(projectFilePath, modifiedCsprojContent, 'utf8');
    console.log(`Adicionado ${newFileName}.cs a ${projectFilePath}`);
}
module.exports = {
    activate,
    deactivate
};
