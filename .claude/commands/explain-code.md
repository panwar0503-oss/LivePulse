---
description: Explain how existing code works - purpose, flow, data, errors, security, trade-offs.
argument-hint: "<file, function, feature, or flow>"
disable-model-invocation: true
disallowed-tools: Edit, Write, NotebookEdit
---

# /explain-code $ARGUMENTS

Read-only. The developer knows Node/Express well: skip Express basics; explain Next.js/React, Sequelize,
Socket.IO, and Redis specifics. Target doesn't exist → say so; never describe hypothetical code as real.

Locate with Grep/Glob, read only the involved functions, then cover briefly:
1. Purpose (1–2 sentences) and which requirement it serves (`requirements/…`), if any.
2. Execution flow as numbered steps with `path:line` (request → Zod → controller → service → transaction →
   commit → emit → client).
3. Key functions/types/events and dependencies.
4. Errors and security: what fails, where it's caught, what the client sees, where validation/authz happen.
5. Trade-offs and limitations.
6. One short example with real names from the code.
7. Implemented vs proposed — clearly separated.

Small excerpts only, never whole files.
