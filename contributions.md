# Contributing to Temperans Habits

Thanks for helping improve Temperans Habits. Contributions can improve the Obsidian plugin, fix bugs, refine documentation, or add reusable endpoint examples.

## Development setup

- Node.js 22.13 or newer (CI currently uses Node 24)
- pnpm 10.32.1 or newer

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run commands in the same environment where dependencies were installed. For example, if you installed dependencies in WSL, use WSL's Node.js and pnpm rather than mixing Windows and WSL toolchains.

`pnpm dev` watches the TypeScript source and rebuilds the plugin bundle. The generated `main.js` is a build artifact; make changes in `src/` and let the build generate it.

## Contributing code

The plugin is written in TypeScript. Application code lives in `src/`, automated tests live in `tests/`, and the API gallery lives in `index.html`.

- Keep changes focused and follow nearby patterns.
- Preserve user data. Manual log entries must remain protected from automated imports, and settings or log changes should go through the existing data-store and ownership helpers.
- Prefer a reusable capability over service-specific code. If an API cannot be represented by the current endpoint configuration, consider whether the endpoint model can be extended generically before adding a service-specific integration.
- Update relevant documentation and tests when behavior or configuration changes.
- For interface changes, include a screenshot or a short description of the affected view in the pull request.

Before opening a pull request, run the checks relevant to your change:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:release
```

For layout or responsive behavior changes, also run the browser check. Install Chromium if needed, then run:

```sh
pnpm exec playwright install chromium
BROWSER_CHANNEL=chromium pnpm test:responsive
```

The continuous integration workflow runs the main checks on Linux and Windows. It also runs the responsive browser check on Linux.

## Adding an endpoint YAML example

Reusable endpoint examples belong in `examples/` as individual `.yaml` files. Add an entry to `examples/README.md` so contributors can find it.

Each file should contain one habit item that can be copied into the `habits:` list in `Habit Logs/Settings.md`. Use a descriptive file name and a unique, kebab-case habit `id`.

Include the details another user needs to adapt it:

- What the endpoint tracks, its unit, and whether it returns a daily value or a rolling-period snapshot.
- Any required URL, account, entity, or location placeholders, with comments explaining what to replace.
- Authentication through Obsidian Secret Storage. Use a `secretKey` name in the YAML; never include a real API key, token, password, or personal account credential.
- The response mapping: `recordsPath`, `dateField`, `valueField`, and an appropriate aggregation or value transform. Use `valuePattern` only when a JSON field contains text that needs numeric extraction.
- A link to the service's official API documentation when available.

Keep examples within the endpoint runner's current capabilities: one HTTP request per sync, a JSON response, supported HTTP methods, configured headers/body/authentication, and the supported response mappings. Pagination, interactive OAuth flows, and arbitrary non-JSON response parsing are not currently provided. If an example requires one of these, document the limitation or propose a generic runner enhancement instead of implying the YAML works as-is.

Use public, stable endpoints when possible. Avoid examples that require exposing private data or credentials, and describe any account permissions or service-specific limits that users should review themselves.

## Pull request notes

Describe the user-visible change and the reason for it. For endpoint examples, include the source API documentation, expected response shape, fields mapped to the habit, and any setup the user must complete. Mention which checks you ran and any checks you could not run.
