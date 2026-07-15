import { cp, mkdir, rm } from "node:fs/promises";

const files = ["index.html", "case.html", "app.js", "styles.css", "modules-v2.css", "modules.css", "interactions.css"];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await Promise.all(files.map((file) => cp(file, `dist/${file}`)));
console.log(`Built ${files.length} public files into dist/`);
