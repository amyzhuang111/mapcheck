import type { LogEntry, MappingRow, Workspace } from "@/lib/types"

const MODEL_ID = "sample-rocket-science-shaped"

const ACTION_SET = [
  "accelerate",
  "brake",
  "steer_left",
  "steer_right",
  "boost",
  "handbrake",
  "jump",
  "reset_camera",
  "no_op",
  "air_roll_left",
  "air_roll_right",
  "rear_view",
]

const MAPPING: Array<[string, string]> = [
  ["accelerate", "throttle_positive"],
  ["brake", "throttle_negative"],
  ["steer_left", "yaw_left"],
  ["steer_right", "yaw_right"],
  ["boost", "throttle_positive"],
  ["jump", "hop"],
  ["air_roll_left", "yaw_left"],
  ["no_op", "idle"],
  ["powerslide", "slide"],
  ["use_item", "interact"],
]

const LOG_SPEC: Array<{ token: string; count: number; times: number[] }> = [
  { token: "accelerate", count: 410, times: [400, 8200, 19100, 35400, 52800, 70600, 85300] },
  { token: "brake", count: 90, times: [2100, 24600, 61000] },
  { token: "steer_left", count: 150, times: [1600, 18800, 40200, 67700] },
  { token: "steer_right", count: 140, times: [900, 15300, 43800, 72100] },
  { token: "boost", count: 64, times: [5400, 28900, 64000] },
  { token: "handbrake", count: 28, times: [11200, 49800] },
  { token: "jump", count: 16, times: [7600, 55200] },
  { token: "reset_camera", count: 7, times: [33100] },
  { token: "no_op", count: 36, times: [200, 30000, 80000] },
  { token: "air_roll_left", count: 22, times: [9400, 47100] },
  { token: "air_roll_right", count: 9, times: [51200] },
  { token: "dodge", count: 4, times: [26800] },
]

function expandLog(): LogEntry[] {
  const entries: LogEntry[] = []
  for (const spec of LOG_SPEC) {
    const base = Math.floor(spec.count / spec.times.length)
    let remainder = spec.count - base * spec.times.length
    spec.times.forEach((tMs, index) => {
      const count = base + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder -= 1
      entries.push({
        id: `${spec.token}-${tMs}-${index}`,
        tMs,
        token: spec.token,
        count,
      })
    })
  }
  return entries.sort((a, b) => a.tMs - b.tMs || a.token.localeCompare(b.token))
}

export function createSample(): Workspace {
  const mapping: MappingRow[] = MAPPING.map(([source, target], index) => ({
    id: `map-${index + 1}`,
    source,
    target,
  }))
  return {
    modelId: MODEL_ID,
    actionSet: [...ACTION_SET],
    mapping,
    log: expandLog(),
  }
}

export const DEFAULT_RARE_THRESHOLD_PCT = 5
