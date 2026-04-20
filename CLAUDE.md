# n8n Workflow Builder

This project is for building and managing n8n workflows using Claude. Use the n8n MCP server tools and n8n skills together to create high-quality automations and AI-powered workflows.

## Tools

### n8n MCP Server

Provides direct interaction with the n8n instance. Key tools:

| Tool | Use for |
|------|---------|
| `search_nodes` | Finding nodes by keyword |
| `get_node` | Understanding node operations (use `detail="standard"`) |
| `validate_node` | Checking node configurations (use `mode="full"`) |
| `n8n_create_workflow` | Creating new workflows |
| `n8n_update_partial_workflow` | Editing existing workflows (most common operation) |
| `validate_workflow` | Checking complete workflow validity |
| `n8n_autofix_workflow` | Auto-fixing validation errors |
| `search_templates` | Finding from 2,700+ real workflow templates |
| `n8n_deploy_template` | Deploying a template to the instance |
| `n8n_manage_datatable` | Managing n8n data tables and rows |

**Critical:** Node type format differs between tools:
- Search/validate tools: `nodes-base.httpRequest`
- Workflow create/update tools: `n8n-nodes-base.httpRequest`

### n8n Skills

Seven skills activate automatically based on context:

- **Expression Syntax** — `{{ }}` patterns, `$json`/`$node`/`$env` variables, common expression mistakes
- **MCP Tools Expert** — Tool selection, parameter formats, validation profiles
- **Workflow Patterns** — 5 proven patterns: webhook processing, HTTP API, database ops, AI agents, scheduled tasks
- **Validation Expert** — Interpreting errors, the validate-fix-repeat loop, auto-fix capabilities
- **Node Configuration** — Operation-aware setup, property dependencies, required fields
- **Code JavaScript** — `$input` data access, return formats, `$helpers.httpRequest()`, Luxon dates
- **Code Python** — Standard library only (no external packages), `_input`/`_json` syntax

## Workflow Creation Process

1. **Understand the goal** — Clarify what the workflow does, what triggers it, and expected output
2. **Check existing workflows** — List workflows on the instance; reuse or extend before building from scratch
3. **Search templates** — Check if a relevant template exists in the 2,700+ library before building manually
4. **Build the workflow** — Use `n8n_create_workflow`, following the quality guidelines below
5. **Validate** — Run `validate_workflow` and fix issues (expect 2-3 validation cycles). Use `n8n_autofix_workflow` for automatic fixes
6. **Test** — Trigger a test execution and verify the output
7. **Report** — Share the workflow name, ID, and a summary of what it does

## Quality Guidelines

- **Descriptive node names** — Name every node based on what it does (e.g., "Fetch Open Orders from Shopify" not "HTTP Request")
- **Sticky notes** — Document the workflow's purpose, non-obvious logic, and configuration notes
- **Error handling** — Add error-handling branches for critical operations. Use the Error Trigger node for workflow-level error handling
- **No hardcoded secrets** — Always use n8n credentials. Never put API keys, tokens, or passwords in node parameters
- **Modular design** — Extract reusable logic into sub-workflows. One workflow = one responsibility
- **Clean data flow** — Use Set/Edit Fields nodes to shape data between steps rather than complex expressions in node configs
- **Webhook data** — Remember: webhook data lives under `.body`, not at root level
- **Code nodes** — Prefer JavaScript (95% of cases). Always return `[{json: {...}}]` format. Use "Run Once for All Items" mode by default
- **Expressions** — Use `{{ }}` double-curly syntax. Never use expressions inside Code nodes, webhook paths, or credentials

## Safety

- Never edit production workflows directly — always make a copy and test in development first
- Always validate workflows before activating them
- Use proper credential references for all authentication
