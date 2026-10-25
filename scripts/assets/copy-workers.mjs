import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/vendor", { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(`node_modules/maplibre-gl/dist/${name}`, `public/vendor/${name}`);
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/vendor/pdf.worker.min.mjs");
copyFileSync("node_modules/pdfjs-dist/LICENSE", "public/vendor/pdfjs-LICENSE.txt");
copyFileSync("node_modules/maplibre-gl/LICENSE.txt", "public/vendor/maplibre-LICENSE.txt");
console.log("Bundled map/PDF workers from installed dependencies");
