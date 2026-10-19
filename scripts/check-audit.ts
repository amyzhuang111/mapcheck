import assert from "node:assert/strict"
import { applyActionMap } from "../lib/apply"
import { runAudit } from "../lib/audit"
import { reportJson, reportMarkdown } from "../lib/report"
import { createSample, DEFAULT_RARE_THRESHOLD_PCT } from "../lib/sample"

const sample = createSample()
const audit = runAudit(sample, DEFAULT_RARE_THRESHOLD_PCT)

const byId = Object.fromEntries(audit.findings.map((finding) => [finding.id, finding]))

assert.equal(audit.totalEvents, 976)
assert.equal(byId.unmapped.severity, "high")
assert.ok(byId.unmapped.tokens.includes("reset_camera"))
assert.ok(byId.unmapped.tokens.includes("handbrake"))
assert.ok(byId.unmapped.tokens.includes("air_roll_right"))
assert.ok(byId.unmapped.tokens.includes("dodge"))
assert.ok(byId.unmapped.tokens.includes("rear_view"))

assert.equal(byId.collisions.severity, "high")
assert.equal(byId.collisions.count, 2)
const throttle = audit.collisions.find((group) => group.target === "throttle_positive")
const yaw = audit.collisions.find((group) => group.target === "yaw_left")
assert.deepEqual(throttle?.sources, ["accelerate", "boost"])
assert.deepEqual(yaw?.sources, ["air_roll_left", "steer_left"])

assert.equal(byId.orphans.severity, "low")
assert.ok(byId.orphans.tokens.includes("powerslide"))
assert.ok(byId.orphans.tokens.includes("use_item"))

assert.equal(byId.rare.severity, "high")
const rareByToken = Object.fromEntries(audit.rare.map((item) => [item.token, item]))
assert.equal(rareByToken.air_roll_right.mapped, false)
assert.equal(rareByToken.jump.mapped, true)
assert.equal(rareByToken.accelerate, undefined)
assert.ok(rareByToken.air_roll_right.share < (410 / audit.totalEvents))

assert.equal(audit.demo.token, "reset_camera")
assert.equal(audit.demo.identical, true)
assert.deepEqual(audit.demo.input, ["reset_camera"])
assert.deepEqual(audit.demo.output, ["reset_camera"])
assert.equal(audit.demo.contrastToken, "accelerate")
assert.deepEqual(audit.demo.contrastOutput, ["throttle_positive"])

assert.deepEqual(applyActionMap(["boost", "reset_camera"], sample.mapping), [
  "throttle_positive",
  "reset_camera",
])
assert.deepEqual(applyActionMap(["reset_camera"], []), ["reset_camera"])

const markdown = reportMarkdown(sample, audit)
assert.match(markdown, /Unmapped pass-throughs/)
assert.match(markdown, /Collisions/)
assert.match(markdown, /Orphans/)
assert.match(markdown, /Rare-action coverage/)
assert.match(markdown, /identical: true/)
assert.match(markdown, /silent-by-default/)

const json = JSON.parse(reportJson(sample, audit)) as { findings: Array<{ id: string }> }
assert.deepEqual(
  json.findings.map((finding) => finding.id),
  ["unmapped", "collisions", "orphans", "rare"],
)

const fixed = createSample()
fixed.mapping = [
  ...fixed.mapping.filter((row) => row.source !== "powerslide" && row.source !== "use_item"),
  { id: "fix-boost", source: "boost", target: "boost_on" },
  { id: "fix-roll", source: "air_roll_left", target: "roll_left" },
  { id: "fix-handbrake", source: "handbrake", target: "drift" },
  { id: "fix-camera", source: "reset_camera", target: "camera_reset" },
  { id: "fix-roll-right", source: "air_roll_right", target: "roll_right" },
  { id: "fix-rear", source: "rear_view", target: "look_back" },
  { id: "fix-dodge", source: "dodge", target: "dodge_tap" },
]
const cleared = runAudit(fixed, DEFAULT_RARE_THRESHOLD_PCT)
const clearedById = Object.fromEntries(cleared.findings.map((finding) => [finding.id, finding]))
assert.equal(clearedById.unmapped.severity, "clear")
assert.equal(clearedById.collisions.severity, "clear")
assert.equal(clearedById.orphans.severity, "clear")
assert.equal(clearedById.rare.severity, "medium")
assert.ok(cleared.rare.every((item) => item.mapped))

console.log(
  JSON.stringify(
    {
      totalEvents: audit.totalEvents,
      risk: audit.riskLabel,
      findings: audit.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        count: finding.count,
        tokens: finding.tokens,
      })),
      demo: {
        input: audit.demo.input,
        output: audit.demo.output,
        identical: audit.demo.identical,
      },
      afterFix: cleared.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
      })),
    },
    null,
    2,
  ),
)
