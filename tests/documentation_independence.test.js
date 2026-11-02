const assert = require("node:assert/strict");
const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const skippedDirectories = new Set([".git", "node_modules"]);

async function markdownFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !skippedDirectories.has(entry.name)) {
      files.push(...await markdownFiles(path.join(directory, entry.name)));
    } else if (entry.isFile() && path.extname(entry.name) === ".md") {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

test("documentation does not depend on the Dynatrace repository", async () => {
  const violations = [];

  for (const file of await markdownFiles()) {
    const content = await readFile(file, "utf8");
    if (/forward-dynatrace/iu.test(content)) {
      violations.push(path.relative(root, file));
    }
  }

  assert.deepEqual(violations, []);
});
