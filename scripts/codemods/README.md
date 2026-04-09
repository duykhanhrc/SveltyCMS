# @file scripts\codemods\2026-migrate-schema.ts

# SveltyCMS Codemods

Codemods are small scripts that automate code transformations after an upgrade. They help in handling breaking changes, renaming properties, or updating schema patterns.

## How it works

When you run `bun run scripts/upgrade.ts`, the tool automatically scans this directory for `.ts` and `.js` files and executes them in order.

## Writing a Codemod

A codemod can be any valid script. For complex transformations, we recommend using `ts-morph` or `jscodeshift`.

### Simple Example (Using Node.js fs)

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(process.cwd(), "src/app.css");
let content = readFileSync(filePath, "utf-8");

// Rename a class
content = content.replace(".old-class", ".new-class");

writeFileSync(filePath, content);
console.log("✅ Updated app.css");
```

### Advanced Example (Using ts-morph)

If you have `ts-morph` installed, you can perform AST-based transformations:

```typescript
import { Project } from "ts-morph";

const project = new Project();
project.addSourceFilesAtPaths("src/**/*.svelte");

for (const sourceFile of project.getSourceFiles()) {
  // Perform AST transformations
}

project.save();
```
