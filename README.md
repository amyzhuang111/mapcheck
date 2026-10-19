# MapCheck — ActionMap auditor

Live: https://mapcheck-rho.vercel.app

**Status: Sample audit — hardcoded example data. Edit rows by hand to explore. Real ActionMap/log import is not built yet.**

A small browser tool that audits a hardcoded sample action mapping (edit rows by hand to explore) before those tokens would reach a game or a robot build.

It is a local, SDK-shaped sample. It does not call the General Intuition API, it does not use an API key, and it does not include a real model, a real session, or Medal / Rocket Science data. Unmapped tokens passing through is the silent-by-default behaviour of `ActionMap.apply` in `general-intuition-sdk` 0.24.0. This page does not call that a bug. It flags the structural risk a partner would otherwise only notice downstream.

## How to run

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4179](http://127.0.0.1:4179).

The page loads a planted sample. The white hero shows `reset_camera` passing through unchanged. **Export audit report** is the primary button and downloads Markdown. **Download JSON** downloads the same findings. **Run audit** fills the tables without a download.

To confirm the planted sample from the command line:

```bash
npm run check
```

Production build:

```bash
npm run build
npm start
```

## What the sample is planted to show

| Check | Planted example |
| --- | --- |
| Unmapped pass-through | `reset_camera` is in the action set and the log, and has no mapping row. `apply(["reset_camera"])` returns `["reset_camera"]`. |
| Collision | `accelerate` and `boost` both map to `throttle_positive`. `steer_left` and `air_roll_left` both map to `yaw_left`. |
| Orphan | `powerslide` → `slide` and `use_item` → `interact` match nothing in the action set or the log. |
| Rare-action coverage | Under 5% of logged events, `air_roll_right` is rare and unmapped. `jump` is rare and mapped. Common `accelerate` is not in the rare list. |

Edit a row and run the audit again. The cards follow the table.

## Talk track

You have a public Python SDK — I read v0.24.0 last night — and its ActionMap passes unmapped tokens through unchanged, silently. I couldn't find a public way for a partner to audit that mapping before it reaches a game or robot build, so I built this sample.

## What a real integration still has to decide

On this sample, MapCheck can tell you a token has no row, that two sources collapse to one target, that a row matches nothing, and that a rare logged action is or is not in the map. It cannot tell you the target is the right control on the robot or in the game. No public evidence found of an official partner-facing auditor for this. The dict fields inside `Model.action_set` are not documented in the 0.24.0 package; this sample audits the strings `apply()` receives.
