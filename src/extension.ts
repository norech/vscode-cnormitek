import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from "child_process";

let collection!: vscode.DiagnosticCollection;
let debug!: vscode.OutputChannel;
let childProcesses: ChildProcessWithoutNullStreams[] = [];

function getErrorType(str: string) {
	let start = str.indexOf("(") + 1;
	let end = str.indexOf(")", start);
	return str.substring(start, end);
}

function getSeverity(message: string) {
	switch(getErrorType(message)) {
		case "major":
		case "minor":
			return vscode.DiagnosticSeverity.Warning;
		case "info":
		default:
			return vscode.DiagnosticSeverity.Information;

	}
}

function displayErrors(textDocument: vscode.TextDocument, data: string) {

	const diag: vscode.Diagnostic[] = [];
	data.split("\n").forEach(element => {
		if (element === "")
			return;

		debug.appendLine(element);
		const [ location, message ] = element.split("::");
		const [ _, line ] = location.split(":");

		let position;
		if (line === "?") {
			position = new vscode.Range(0, 0, 0, 0);
			debug.appendLine("Position is unknown");
		} else {
			const lineNb = parseInt(line, 10) - 1;
			position = new vscode.Range(lineNb, 0, lineNb, 1000000);
			debug.appendLine("Position at line " + lineNb);
		}
		debug.appendLine("Message is: " + message);
		debug.appendLine("Error type is: " + getErrorType(message));
		diag.push(new vscode.Diagnostic(position, message, getSeverity(message)));
	});
	collection.set(textDocument.uri, diag);
}


function lintDocument(textDocument: vscode.TextDocument): void {

	const config = vscode.workspace.getConfiguration("cnormitek", textDocument);
	if (textDocument.languageId !== "c" && textDocument.languageId !== "cpp") {
		return;
	}
	const input = textDocument.getText();
	if (input === "") {
		debug.appendLine("File has no content.");
		displayErrors(textDocument, "");
		return;
	}

	const scriptLoc: string = config.get("scriptLocation") || "cnormitek";
	const customArgs: string[] = config.get("additionalScriptArgs") || [];

	const args = [ "-", "--no-color", ...customArgs ];

	if (childProcesses.length > 5) {
		debug.appendLine("Too many processes started at the same time. Hold on.");
		return;
	}
	const childProcess = spawn(scriptLoc, args, { stdio: "pipe" });
	debug.appendLine("Started child process");
	debug.appendLine("Command: " + scriptLoc + " " + args.join(" "));
	childProcesses.push(childProcess);

	childProcess.stdin.write(input);
	childProcess.stdin.end();
	debug.appendLine("Wrote input.");

	let data = "";
	childProcess.stdout.on("data", (chunk) => {
		data += chunk;
	});

	childProcess.on("close", (code) => {
		debug.appendLine("Process exit with code " + code);
		debug.appendLine("Output from cnormitek:");
		debug.appendLine(data);
		childProcesses = childProcesses.filter((c) => c !== childProcess);
		displayErrors(textDocument, data);
	});

	setTimeout(() => {
		if (!childProcess.killed)
			childProcess.kill();
	}, 20000);
}


function lintEditor(editor?: vscode.TextEditor): void {

	editor = editor ?? vscode.window.activeTextEditor;
	const document = editor?.document;
	if (document !== undefined)
		lintDocument(document);
}


export function activate(context: vscode.ExtensionContext) {

	collection = vscode.languages.createDiagnosticCollection("cnormitek");
	debug = vscode.window.createOutputChannel("cnormitek debug");

	const editorChange = vscode.window.onDidChangeActiveTextEditor(lintEditor);
	const textOpen = vscode.workspace.onDidOpenTextDocument(lintDocument);
	const textChange = vscode.workspace.onDidChangeTextDocument((e) => lintDocument(e.document));
	const textSave = vscode.workspace.onDidSaveTextDocument(lintDocument);
	let commandLint = vscode.commands.registerCommand('cnormitek.lintFile', () => {
		lintEditor();
	});

	context.subscriptions.push(editorChange);
	context.subscriptions.push(textOpen);
	context.subscriptions.push(textChange);
	context.subscriptions.push(textSave);
	context.subscriptions.push(commandLint);
}


export function deactivate() {}
