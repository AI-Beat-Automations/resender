<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Reading files

**Outline first, then ranges.** For any file over ~200 lines, map it before reading: `grep -n` for `export`, `^##`, or top-level keys, then `sed -n 'A,Bp'` on the ranges you need. One file per command. Tool output past ~30KB is truncated and the truncated copy persists in context, so a second read pays twice.

Hubs that always need this: `lib/pages/page-registry.ts` and `CONTEXT.md` (locate the term with `grep -n '^### '`, read only that section).

**Log actions and reasons.** The closed catalog lives in `lib/observability/catalog.ts` (types only; `logger.ts` re-exports it). To add a literal, `grep -n '@section <feature>' lib/observability/catalog.ts` and append inside that block; open a new `@section` before `@section end` for a new module. Do not read `logger.ts` for this.

**Product copy (i18n).** Each section of the app dictionary is one file in `content/i18n/app/sections/<section>.ts` holding its type, `es` and `en` together. Add keys there only; `dictionary.ts`, `es.ts` and `en.ts` just compose the sections and change only when a section is added.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `AI-Beat-Automations/resender`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
