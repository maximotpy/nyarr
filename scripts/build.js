// Build script: syntax-checks every JS file in the project (server, src, public)
// and validates JSON data files. Exits non-zero on failure.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let errors = 0;
let checked = 0;

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'downloads', 'data'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else if (/\.(js|json)$/.test(entry.name)) files.push(full);
    }
    return files;
}

for (const file of walk(ROOT)) {
    checked++;
    const rel = path.relative(ROOT, file);
    try {
        const content = fs.readFileSync(file, 'utf8');
        if (file.endsWith('.json')) {
            JSON.parse(content);
        } else {
            // Compile-only check: parse the script without executing it.
            new vm.Script(content, { filename: rel });
        }
        console.log(`  ok    ${rel}`);
    } catch (err) {
        errors++;
        console.error(`  FAIL  ${rel}: ${err.message}`);
    }
}

console.log(`\nChecked ${checked} files.`);
if (errors) {
    console.error(`Build failed with ${errors} error(s).`);
    process.exit(1);
}
console.log('Build succeeded.');
