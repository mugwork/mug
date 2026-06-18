---
name: mug
description: Run Mug CLI developer workflow commands — dev server, update, deploy, clone, shutdown, workspaces.
argument-hint: "dev | shutdown | update | deploy | clone | workspaces"
---

# Mug CLI

Run a Mug developer workflow command.

## Input

Command: `$ARGUMENTS`

## Dispatch

Run the matching CLI command in the workspace root:

- `dev` → see **Dev Server** below
- `shutdown` → see **Shutdown** below
- `update` → `mug update` (forces full refresh — normally auto-runs every 4h)
- `deploy` → `mug deploy`
- `clone` → see **Clone** below
- `workspaces` → `mug workspaces`

If no argument or unrecognized argument, show available commands and ask which to run.

## Dev Server

Check if a dev server is already running by looking for the PID file:

```bash
cat .mug/dev.pid 2>/dev/null
```

If a PID file exists with a running process, shut it down first:

```bash
mug shutdown
```

Then start the dev server:

```bash
mug dev
```

Run this command **in the background** — it's a long-running process.

Options:
- `mug dev --port <port>` — pin to a specific port (default: auto-detect from 8787)
- `mug dev --tunnel` — expose via Cloudflare Quick Tunnel (requires `cloudflared` installed)

The dev server auto-detects free ports, so multiple workspaces can run simultaneously.

## Shutdown

Gracefully stop the running dev server. Writes back database changes and cleans up.

```bash
mug shutdown
```

This reads `.mug/dev.pid` and sends SIGTERM to the dev server process.

## Clone

Clone an existing workspace from Mug cloud to the local machine. Creates a new directory, scaffolds workspace structure, and connects it to the cloud workspace.

```bash
mug clone                 # shows workspace picker if you have multiple
mug clone acme            # clone by name, subdomain, or ID
```

Files and databases stay remote — use `mug pull --all` to download locally if needed. Requires `mug login` first.
