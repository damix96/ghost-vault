import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('../docs/ui-kit');
const files = new Map();
const collect = async directory => {
  assert.ok((await stat(resolve(directory, 'index.md'))).isFile(), `Missing index: ${directory}`);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.md')) files.set(path, await readFile(path, 'utf8'));
  }
};
await collect(root);
const edges = new Map();
let links = 0;
let maximum = 0;
for (const [path, source] of files) {
  const lines = source.trimEnd().split(/\r?\n/).length;
  maximum = Math.max(maximum, lines);
  assert.ok(lines <= 200, `${path}: ${lines} lines`);
  const targets = [];
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^[a-z]+:/i.test(match[1])) continue;
    const [link, anchor] = match[1].split('#');
    const target = resolve(dirname(path), decodeURIComponent(link || '.'));
    const actual = link ? target : path;
    assert.ok((await stat(actual)).isFile(), `${path}: ${match[1]}`);
    if (anchor && extname(actual) === '.md') {
      const content = files.get(actual) ?? await readFile(actual, 'utf8');
      const headings = [...content.matchAll(/^#+\s+(.+)$/gm)].map(heading => heading[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-'));
      assert.ok(headings.includes(decodeURIComponent(anchor)), `${path}: missing anchor ${anchor}`);
    }
    targets.push(actual);
    links++;
  }
  edges.set(path, targets);
}
const reached = new Set();
const visit = path => {
  if (reached.has(path)) return;
  reached.add(path);
  for (const target of edges.get(path) ?? []) if (files.has(target)) visit(target);
};
visit(resolve(root, 'index.md'));
assert.equal([...files.keys()].filter(path => !reached.has(path)).length, 0, 'Unreachable document');
assert.ok(edges.get(resolve(root, 'index.md')).includes(resolve(root, 'basics/index.md')));
assert.ok(edges.get(resolve(root, 'basics/index.md')).includes(resolve(root, 'basics/scope.md')));
console.log(`Docs: ${files.size} files, max ${maximum} lines, ${links} local links; indexes/reachability/root→basics→scope pass`);
