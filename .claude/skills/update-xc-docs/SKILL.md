# update-xc-docs

Automatically sync README.md and CLAUDE.md after working with new F5 XC API use cases via the MCP server.

## When to invoke

Invoke this skill at the end of any session where:
- A new F5 XC API pattern was discovered (new path, schema quirk, field name)
- A new use case was explored (e.g. DNS, TCP LB, new resource type)
- A new tool or `xc_raw_request` endpoint was used successfully for the first time

## What this skill does

1. **Review the session** — identify any new use cases, API paths, schema patterns, or gotchas discovered
2. **Update CLAUDE.md** (`F5_XC_MCP_Server/CLAUDE.md`):
   - Add the use case to the Version 1.0 Use Cases table if not already present
   - Add or update entries in the `## F5 XC API Quirks` section with correct API paths, field names, and schema examples
3. **Update README.md** (`F5_XC_MCP_Server/README.md`):
   - Add the use case to the `## Use Cases (v1.0)` table
   - Add a new `### <Category> (UC-N)` section to `## Available Tools` listing the tools or `xc_raw_request` paths used
4. **Commit** the changes with a clear message referencing the new use case
5. **Ask the user** whether to push to GitHub before pushing

## Rules

- Do not duplicate entries — check both files before adding
- Keep CLAUDE.md quirks factual and based only on what was actually observed in the session (no guessing)
- For `xc_raw_request`-based operations, document the exact API path in the tools table
- Always include a note if a resource requires a specific namespace (e.g. DNS zones → `system`)
- UC numbers are sequential — check the highest existing UC number and increment
- Schema examples in CLAUDE.md must use the working request body shape, not failed attempts
