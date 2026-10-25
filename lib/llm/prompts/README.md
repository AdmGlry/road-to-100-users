# LLM prompts

One file per prompt (e.g. `extract-profile.ts`, `score-company.ts`, `compose-application.ts`,
`classify-reply.ts`). Each file exports:

- `PROMPT_NAME` — stable identifier (e.g. `"extract_profile"`), used in usage events.
- `PROMPT_VERSION` — string constant, bumped on every change to the prompt text or
  schema (e.g. `"2026-10-25.1"`), so results and costs can be traced to a prompt version.
- The Zod schema of the expected JSON output (or an import from `../schemas.ts`).
- A builder function returning `{ system, prompt }` from typed inputs.
- The model tier to use (`"fast"` for extraction / scoring / classification, `"smart"` for
  mail composition — SPEC §11).

Call it through `generateJson()` from `lib/llm/client.ts`, passing `promptName` and
`promptVersion`.

Rules:

- Generation prompts must explicitly forbid inventing experience, degrees or skills absent
  from the profile (AGENTS.md).
- User-facing generated text is in French; code and identifiers in English.
- Never log prompt inputs or model outputs (CV / mail contents).
