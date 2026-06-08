# gstack-workflows

Lightweight OPC plugin that adapts the most useful gstack workflow patterns into
native Claude Code skills.

This plugin intentionally does not vendor the full gstack repository or depend on
gstack's Bun browser daemon. It provides prompt-level workflows that fit OPC's
existing plugin and skill loader.

## Included skills

| Skill | Purpose |
| --- | --- |
| `gstack-investigate` | Diagnose bugs with evidence before changing code. |
| `gstack-review` | Review the current diff before landing. |
| `gstack-cso` | Run an OWASP + STRIDE-oriented security audit. |
| `gstack-qa-only` | Produce a read-only QA report for a URL, app, or flow. |
| `gstack-document-release` | Check and update docs after a shipped change. |

## Design boundaries

- Skills are prefixed with `gstack-` to avoid collisions with OPC built-ins.
- Browser automation is described as a workflow, not hard-wired to gstack's
  external `$B` command.
- The full gstack daemon can still be integrated later through a dedicated
  `hosts/opc.ts` generator path upstream.
