# Reto 03 — Agente "Órdenes de Compra SAP"

`PRD.md` is the specification. Follow its tool contract (section 6.2) and file structure (section 6.5) exactly.

## Standing rules

- TypeScript strict, no `any`, short functions, clear names. Simple code over clever code: a non-engineer must be able to explain it.
- Runtime: Bun. Dependencies: only `zod` and `@anthropic-ai/sdk` unless strictly necessary.
- Every tool returns a JSON string `{ ok: true, data }` or `{ ok: false, error }` and never throws.
- Tools never run shell commands. Resolve paths from `ctx.directory` with `path.join` (this runs on Windows).
- Never modify `fixtures/`.
- Whenever the PRD is ambiguous, choose the simplest reasonable option and log it in `SUPUESTOS.md` (Spanish), one line per assumption.
- Commit after each slice with a clear message.

## Layout

- `src/tools/oc.ts` — only the tools (each export becomes `oc_<export>`). No other exports there.
- `src/domain/` — business logic the tools use (reading the package, rules RC1–RC10, payload, evidence, logs).
- `src/sap/` — `SapAdapter` interface (PRD 7.4) and the file-based mock over `out/sap/`.
- `demo.ts` — runs every case through the tools without an LLM (`bun run demo`).
