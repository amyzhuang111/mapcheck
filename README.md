# MapCheck — ActionMap auditor

Live: https://mapcheck-rho.vercel.app

A browser preflight for an ActionMap before those tokens reach a game or a robot build.

Nothing is audited when the page opens. Paste or upload a map, a log, or both. The audit uses only that text. If one of them is missing, the checks that need it are marked missing. MapCheck does not invent the other half.

It does not call the General Intuition API, it does not use an API key, and it does not ship a real model or a real session. Unmapped tokens passing through is the silent-by-default behaviour of `ActionMap.apply` in `general-intuition-sdk` 0.24.0. This page does not call that a bug. It flags the structural risk a partner would otherwise only notice downstream.

A labelled synthetic sample is available as a download, and as **Load sample**. It stays off until you ask for it.

## How to run

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4179](http://127.0.0.1:4179).

**Audit imported files** runs the checks. **Export audit report** downloads Markdown. **Download JSON** downloads the same findings. Both are computed from the current import.

To confirm the fixtures from the command line:

```bash
npm test
```

`npm run check` runs the same script. Production build:

```bash
npm run build
npm start
```

Deploy notes are in `DEPLOY.md`.

## What you can import

ActionMap JSON, the dict `ActionMap` takes:

- `{"W": "forward", "A": "left"}`
- `{ "mapping": { "W": "forward" }, "action_set": ["W", "reset_camera"], "model_id": "optional" }`
- `action_map` is accepted in place of `mapping`. `action_set` is optional. Without it, pass-through is judged only against the log.
- An array of `["token", "action"]` pairs, or `{ "token": "W", "action": "forward" }` objects.

Session log:

- CSV with a header. The token column is `token`, `action`, `key`, `source`, or `name`. Optional `count` (`n`, `events`) and `t_ms` (`t`, `timestamp`, `time_ms`, `ts`). Quoted fields may contain commas and line breaks.
- A single column of tokens, one per row, each counted once. No header required.
- JSON: `["token", "token"]`, `[{ "token": "W", "count": 2, "t_ms": 400 }]`, `{ "events": [ ... ] }`, `{ "log": [ ... ] }`, `{ "session": [ ... ] }`, or `{ "counts": { "W": 2 } }`.

Bad rows stay on screen with a line number. They are not used as rows and they are not dropped quietly. A CSV with several columns and no token header is rejected instead of guessed.

## What the labelled sample is planted to show

Load both sample files. The numbers below are that import, not the empty page.

| Check | Planted example |
| --- | --- |
| Unmapped pass-through | `reset_camera` is in the action set and the log, and has no mapping row. `apply(["reset_camera"])` returns `["reset_camera"]`. |
| Collision | `accelerate` and `boost` both map to `throttle_positive`. `steer_left` and `air_roll_left` both map to `yaw_left`. |
| Orphan | `powerslide` → `slide` and `use_item` → `interact` never appear in the log. |
| Rare-action coverage | Under 5% of logged events, `air_roll_right` is rare and unmapped. `jump` is rare and mapped. Common `accelerate` is not in the rare list. |

## Talk track

You have a public Python SDK — I read v0.24.0 last night — and its ActionMap passes unmapped tokens through unchanged, silently. I couldn't find a public way for a partner to audit that mapping before it reaches a game or robot build, so I built one.

## What a real integration still has to decide

MapCheck can tell you a token in the import has no row, that two sources collapse to one target, that a row never appears in the log, and how often each logged token occurred. It cannot tell you the target is the right control on the robot or in the game. No public evidence found of an official partner-facing auditor for this. The dict fields inside `Model.action_set` are not documented in the 0.24.0 package; this tool audits the strings `apply()` receives.
