# Domain Docs

This repository uses one product-wide domain context.

## Before exploring

- Read `docs/glossary.md`.
- Read relevant decisions under `docs/adr/`.
- Do not create a duplicate `CONTEXT.md`; `docs/glossary.md` is Paseo’s authoritative terminology source.

## Vocabulary

Use the canonical terms from `docs/glossary.md` in issues, specifications, tests, implementation plans, and UI copy. Do not introduce synonyms that the glossary forbids.

If a required concept is missing, resolve it through domain modeling and update `docs/glossary.md`.

## Decisions

System-wide architectural decisions live in `docs/adr/`. If proposed work contradicts an ADR, surface the conflict explicitly before proceeding.
