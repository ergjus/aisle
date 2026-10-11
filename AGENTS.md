# Working on Aisle

Notes for coding agents (Claude Code reads this through CLAUDE.md).

## Settings and manual setup

`.env.example` is the single list of everything a person has to provide or do by hand to run Aisle. Keep it complete:

- Any change that reads a new environment variable adds it to `.env.example` in the same commit, with a comment saying what it switches on, where to get the value (console, page, or command), and whether it is optional.
- Manual setup that has no variable of its own but is needed for one to work (verifying a sending domain, enabling OIDC, applying a migration, a spend limit) goes in the comment above that variable.
- Group variables by feature, and say what happens when they are missing.
- Never put real secrets in it; use empty values or obvious placeholders.
- When you remove a variable from the code, remove it here too.

A pull request that adds or changes settings also lists them in its description, so the reviewer knows what to set on Vercel before merging.
