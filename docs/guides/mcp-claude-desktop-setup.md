# MCP Setup for Claude Desktop and Claude Code

## What it does

The LivePulse MCP server lets Claude read your live session and propose changes to it. Claude can read the session
snapshot, suggest polls, list questions, and read the report. For changes, Claude can only propose a poll, a poll
start or close, or an answer. Nothing reaches the audience until you approve it in the presenter app.

## Before you start

- The LivePulse API is running (`npm run dev -w api`, or your usual local start).
- You have created a session in the web app.
- You have copied the presenter key once. Keep it somewhere private, such as a password manager.

## Claude Desktop config

Open the Claude Desktop config file (Settings, then Developer, then Edit Config) and add an entry under
`mcpServers`. Replace the placeholders with your values. `cwd` is the `api` folder of your local repo.

```json
{
  "mcpServers": {
    "livepulse": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "<path-to-repo>/api",
      "env": {
        "LIVEPULSE_API_URL": "http://localhost:4000",
        "LIVEPULSE_SESSION_ID": "<your-session-id>",
        "LIVEPULSE_PRESENTER_KEY": "<your-presenter-key>"
      }
    }
  }
}
```

Keep the presenter key out of shared files, screenshots, and git. Do not paste it into a repo `.env` that you
commit. Restart Claude Desktop after you save.

## Claude Code setup

Run this once from any folder. It uses the same values as the Desktop entry.

```bash
claude mcp add livepulse \
  -e LIVEPULSE_API_URL=http://localhost:4000 \
  -e LIVEPULSE_SESSION_ID=<your-session-id> \
  -e LIVEPULSE_PRESENTER_KEY=<your-presenter-key> \
  -- npx tsx src/mcp/server.ts
```

Run it from the `api` folder, or add `--cwd <path-to-repo>/api` if your Claude Code version supports it. Keep the
presenter key out of any file you commit.

## What to ask Claude

- "Give me a snapshot of my session."
- "Create a poll about pricing in my session."
- "Suggest three polls based on the top questions."
- "List the top questions."

## Approval step

Claude's changes appear as proposals in the presenter's AI panel. Read each one, then approve or reject it there.
Approved proposals run once and show as done or failed. Rejected proposals never run. The audience sees a change only
after you approve it.

## Troubleshooting

- **Presenter key rejected:** the key does not match this session. Check the value in the config, or use the key from
  the session you are presenting.
- **API unreachable:** the API is not running, or `LIVEPULSE_API_URL` is wrong. Start the API and check the URL.
- **AI off for the session:** proposals are blocked while AI is off for this session. Turn on the AI switch in the presenter app's AI panel,
  then ask Claude again.
- **Session ended:** the session is closed and cannot take new proposals. Create a new session and use its ID and key.
