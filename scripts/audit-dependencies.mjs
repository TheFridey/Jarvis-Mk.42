// Read-only evidence, not an automatic unused-package remover.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import ts from 'typescript';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const manifests = files.filter(path => /(^|\/)package\.json$/.test(path));
const imports = new Map();
for (const path of files.filter(path => /\.(?:[cm]?[jt]sx?)$/.test(path) && !path.includes('/out/'))) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text;
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require' || node.expression.getText(source) === 'require.resolve')) {
      specifier = node.arguments[0].text;
    }
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('node:')) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      const references = imports.get(name) ?? [];
      references.push(path);
      imports.set(name, references);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const decisions = [];
for (const path of manifests) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const dir = dirname(path);
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const references = [...new Set(imports.get(name) ?? [])];
    const local = references.filter(ref => dir === '.' || ref.startsWith(`${dir}/`));
    const tool = Object.values(pkg.scripts ?? {}).some(script => script.includes(name.replace(/^@[^/]+\//, '')));
    decisions.push({ workspace: pkg.name, manifest: path, name, range,
      decision: local.length || tool || name.startsWith('@types/') ? 'KEEP' : 'DEFER',
      evidence: local, tool, note: local.length || tool ? 'Direct import or package script; confirm resolved graph with pnpm why.' :
        name.startsWith('@types/') ? 'Compiler type dependency; compile before changing.' : 'No local static import. Check transitive peers, dynamic resolution and workspace ownership before removal.' });
  }
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, decisions }, null, 2)}\n`);
