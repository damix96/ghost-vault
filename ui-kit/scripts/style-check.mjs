import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const inspect = async path => {
  if ((await stat(path)).isDirectory()) {
    for (const entry of await readdir(path)) await inspect(join(path, entry));
  } else if (/\.(ts|mjs|css|html)$/.test(path)) {
    const source = await readFile(path, 'utf8');
    const lines = source.trimEnd().split(/\r?\n/).length;
    if (lines < 10 || lines > 300) throw new Error(`${path}: ${lines} lines; expected 10–300`);
    if (/\.(ts|mjs)$/.test(path)) {
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) throw new Error(`${path}: function syntax`);
        if (ts.isBlock(node) && node.statements.length === 1 && ts.isReturnStatement(node.statements[0])) throw new Error(`${path}: single-return block`);
        ts.forEachChild(node, visit);
      };
      visit(file);
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if ([ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia].includes(token)) throw new Error(`${path}: comment`);
      }
    }
    if (path.startsWith('examples') && /style\s*=|\.style\b|<style\b/.test(source)) throw new Error(`${path}: page style escape`);
    if (/\.(css|html)$/.test(path) && /\/\*|<!--/.test(source)) throw new Error(`${path}: comment`);
  }
};
for (const path of ['src', 'scripts', 'examples', 'tests', 'vite.config.ts', 'index.html']) await inspect(path);
console.log('Authored modules: 10–300 lines, arrows, no comments/single-return blocks; examples: no inline design');
