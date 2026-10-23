# <feature-name> — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — <short title>

### Architecture
```
DB: <tables/constraints>
API: <METHOD /api/path → service → model>
Realtime: <event> (room) → emitted after commit
Web: <page → hook → component>
```

### Key decisions
1. **<decision>** — <rationale>

### Contracts
- HTTP: `METHOD /api/path` — request schema, response, errors (400/401/403/404/409), who may call it
- Socket: `domain:action` — direction, room, payload, ack, who may send/receive

### Files
| File | Create/Modify | Purpose | Risk |
|---|---|---|---|

### Impact analysis
- **Breaking changes**:
- **Migrations / rollback**:
- **Concurrency**:
- **Security**:
- **Testing approach**:

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | | LOW / MEDIUM / HIGH | inline / executor-low / executor-medium / executor-high | pending | |

## Issues & updates
<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| <YYYY-MM-DD> | plan_created | | planning-tracking.md |
