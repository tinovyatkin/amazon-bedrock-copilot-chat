# Repository Guidelines

## Project Structure & Module Organization

- Source: `src/` (extension entry `extension.ts`, provider `provider.ts`, Bedrock client `bedrock-client.ts`, converters under `converters/`, commands under `commands/`, tests in `src/test/`).
- Build output: `dist/` (bundled extension) and `out/` (VSCode test fixtures); VSIX goes to `dist/extension.vsix`.
- Assets & docs: `assets/`, `docs/`, top-level config for lint/format/hooks.
- Architecture: `extension.ts` activates → `provider.ts` lists models and streams replies → `converters/` adapt messages/tools → `stream-processor.ts` buffers tool params and text → `logger.ts` records logs.

## Build, Test, and Development Commands

- `bun install` or `npm install` – install deps and VSCode API d.ts via postinstall.
- `bun run compile` – build the extension to `dist/extension.js` (CJS, sourcemaps).
- `bun run package` – same as compile; used by `vscode:prepublish`.
- `bun run vsce:package` – create `dist/extension.vsix` for manual install.
- `bun run check-types` – type-check with `tsgo` (no emit).
- `bun run lint` / `bun run format` / `bun run format:check` – ESLint + Prettier.
- `bun run test` – runs `vscode-test` (pretest runs type-check).
- `bun run download-api` – refresh proposed VSCode API d.ts when upgrading VSCode.
- Dev loop: open in VSCode ≥1.104.0, press `F5` to launch Extension Development Host; check `BedrockChat*.log`.

## Coding Style & Naming Conventions

- 2-space indentation, LF endings (`.editorconfig`). Prettier enforces 100-char width and JSDoc rules.
- TypeScript; prefer type-only imports and `readonly` fields; avoid `console` (use `logger`).
- Keep imports logically grouped; follow existing Bedrock provider abstractions (client → profiles → provider → stream processor).

## Testing Guidelines

- Unit/integration tests live in `src/test/*.test.ts`; name new specs `<feature>.test.ts`.
- For tests that hit AWS, guard with environment checks to avoid accidental spend; prefer mocked clients where possible.
- Run `bun run test` before PRs; add repro steps for manual E2E. Tests use `mocha` via `vscode-test`.

## Commit & Pull Request Guidelines

- Commitlint types: `build|chore|ci|ai|docs|feat|fix|perf|refactor|revert|style|test`; scope optional; header ≤150 chars. Body/footer blank lines required; no terminal periods.
- Hooks: `lefthook` runs format/lint/typecheck and commitlint; install with `lefthook install` if not active.
- PRs: include what/why, tests run (`bun run test`, manual steps), AWS resources touched, and screenshots or clips if UI/UX changes.
