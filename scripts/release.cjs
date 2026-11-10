'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const packageFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
const version = process.argv[2] || pkg.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('版本号格式应为 x.y.z，例如 1.0.1。');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes('id="app-version"')) throw new Error('缺少页面版本号。');
html = html.replace(/data-version="[^"]*">v[^<]*<\/span>/, `data-version="${version}">v${version}</span>`);
for (const asset of ['styles.css', 'engine.js', 'app.js']) {
  const escaped = asset.replace('.', '\\.');
  html = html.replace(new RegExp(`((?:href|src)=")${escaped}(?:\\?v=[^"]*)?"`), `$1${asset}?v=${version}"`);
}
pkg.version = version;
fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'index.html'), html);
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version }, null, 2) + '\n');
console.log(`已同步 v${version}：页面、静态资源和更新清单。`);
