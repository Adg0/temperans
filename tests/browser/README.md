# Responsive browser checks

`pnpm test:responsive` renders the production dashboard, habit form, dropdown and logging modal in a real browser. The small adapter supplies Obsidian DOM helpers and baseline host styles; this does not replace testing inside Obsidian with the user's theme.

The runner uses an optional local `playwright` installation, or the module path supplied in `PLAYWRIGHT_MODULE` (an absolute path to Playwright's `index.mjs`). It launches installed Microsoft Edge by default; set `BROWSER_CHANNEL=chrome` to use Chrome. It does not download a browser or add a production dependency.

Checks cover six desktop/mobile viewports, all cadence choices, custom units, displayed and saved selections, keyboard navigation, narrow settings panes, scrolling to the last habit, logging navigation and session entry, note naming toggles, custom formats, Daily Notes opt-in and validation, device-independent staged import actions, populated peer previews, selection/direction controls, transfers, empty states and transfer failure recovery. Screenshots go to the system temporary directory under `temperans-responsive`.
