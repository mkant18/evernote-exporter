# CLAUDE.md

Guidelines for AI-assisted development on this project.

## Core Rules

**Think before coding.** State assumptions explicitly. If multiple interpretations exist, surface them — don't pick silently. If something is unclear, ask before implementing.

**Simplicity first.** Write the minimum code that solves the problem. No speculative features, no abstractions for single-use code, no flexibility that wasn't requested. If it could be half as long, rewrite it.

**Surgical changes.** Touch only what the task requires. Don't improve adjacent code, don't refactor things that aren't broken, match existing style. Every changed line should trace directly to the user's request.

**Goal-driven execution.** Before multi-step tasks, state a brief plan with verifiable steps. Define what "done" looks like before writing code.

## Project Notes

- Core export engine: Node.js
- Future GUI: Electron (same language, no boundary)
- Neutral storage format: JSON (system-agnostic, human-readable)
- Priority data to preserve: tags, checklists, attachments, notebook hierarchy
