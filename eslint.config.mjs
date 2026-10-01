import obsidian from "eslint-plugin-obsidianmd";
// Obsidian release-guideline checks; TypeScript correctness is checked separately.
export default [
  { ignores: ["node_modules/**", "main.js", "tests/**", "scripts/**", "audit/**", "android-companion/**"] },
  ...obsidian.configs.recommended.map(config => ({ ...config,
    rules: Object.fromEntries(Object.entries(config.rules ?? {}).filter(([name]) => name.startsWith("obsidianmd/")))
  })),
  { files: ["src/**/*.ts"], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }, rules: {
    "obsidianmd/ui/sentence-case": ["warn", { brands: ["Temperans", "Temperans Habits", "Android", "Obsidian", "Markdown", "Health Connect", "Monkeytype", "ApeKey", "Google Lens", "Settings.md", "Dashboard.md", "Habit Logs"], acronyms: ["API", "APIs", "REST", "HTTP", "HTTPS", "QR", "YAML", "JSON"], ignoreRegex: ["YYYY", "^e\\.g\\.", "^http", "^0 ", "^↑", "^↓", "^✓", "^‹", "^\\+1", "http://"] }]
  } }
];
