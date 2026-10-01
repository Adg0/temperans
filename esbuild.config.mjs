import esbuild from "esbuild";
import process from "node:process";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  absWorkingDir: process.cwd(),
  entryPoints: ["./src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: "main.js"
});

if (watch) {
  await context.watch();
  console.log("Watching Temperans Habits source files...");
} else {
  await context.rebuild();
  await context.dispose();
}
