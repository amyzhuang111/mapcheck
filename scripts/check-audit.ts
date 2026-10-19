import assert from "node:assert/strict"
import fs from "node:fs"
import { runAudit } from "../lib/audit"
import { readJson } from "../lib/json-doc"
import { loadImport } from "../lib/load"
import { parseActionMap } from "../lib/parse-map"
import { parseLog } from "../lib/parse-log"
import { reportJson, reportMarkdown } from "../lib/report"
import { fixedActionMapJson, sampleActionMapJson, sampleLogCsv } from "../lib/sample"

let assertions = 0

function same(actual: unknown, expected: unknown, label: string) {
  assertions += 1
  assert.deepEqual(actual, expected, label)
}

function ok(value: unknown, label: string) {
  assertions += 1
  assert.ok(value, label)
}

function read(path: string): string {
  return fs.readFileSync(path, "utf8")
}

function byId(audit: ReturnType<typeof runAudit>) {
  return Object.fromEntries(audit.findings.map((finding) => [finding.id, finding]))
}

function summarise(audit: ReturnType<typeof runAudit>) {
  return {
    totalEvents: audit.totalEvents,
    risk: audit.riskLabel,
    findings: audit.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      count: finding.count,
      tokens: finding.tokens,
    })),
    counts: audit.counts.map((item) => [item.token, item.events]),
    demo: audit.demo
      ? { input: audit.demo.input, output: audit.demo.output, identical: audit.demo.identical }
      : null,
  }
}

const reports: Array<{ fixture: string; expected: unknown; computed: unknown }> = []

function record(fixture: string, expected: unknown, computed: unknown) {
  reports.push({ fixture, expected, computed })
  same(computed, expected, fixture)
}

same(read("public/samples/action-map.json"), sampleActionMapJson(), "sample map file matches generator")
same(read("public/samples/session-log.csv"), sampleLogCsv(), "sample log file matches generator")
same(read("fixtures/fixed-action-map.json"), fixedActionMapJson(), "fixed map file matches generator")

const sampleMapText = read("public/samples/action-map.json")
const sampleLogText = read("public/samples/session-log.csv")
const sampleParsed = JSON.parse(sampleMapText) as unknown
const sampleRead = readJson(sampleMapText)
ok(sampleRead.error === null, "sample map json parses")
same(JSON.parse(JSON.stringify(sampleRead.value)), sampleParsed, "sample map agrees with JSON.parse")

const sampleLoaded = loadImport({
  mapText: sampleMapText,
  logText: sampleLogText,
  mapLabel: "sample ActionMap",
  logLabel: "sample log",
  sampleRequested: true,
})
same(sampleLoaded.issues, [], "sample files have no parse errors")
const sampleAudit = runAudit(sampleLoaded.workspace, 5)
const sampleFindings = byId(sampleAudit)

const sampleExpected = {
  totalEvents: 976,
  risk: "Hold",
  unmapped: ["dodge", "reset_camera", "air_roll_right", "handbrake", "rear_view"].sort(),
  collisions: [
    { target: "throttle_positive", sources: ["accelerate", "boost"] },
    { target: "yaw_left", sources: ["air_roll_left", "steer_left"] },
  ],
  orphans: ["powerslide", "use_item"].sort(),
  rareUnmapped: "air_roll_right",
  rareMapped: "jump",
  accelerateRare: false,
  demo: { input: ["reset_camera"], output: ["reset_camera"], identical: true, contrast: "throttle_positive" },
}
const sampleComputed = {
  totalEvents: sampleAudit.totalEvents,
  risk: sampleAudit.riskLabel,
  unmapped: [...sampleFindings.unmapped.tokens].sort(),
  collisions: sampleAudit.collisions.map((group) => ({ target: group.target, sources: group.sources })),
  orphans: [...sampleFindings.orphans.tokens].sort(),
  rareUnmapped: sampleAudit.rare.find((item) => item.token === "air_roll_right")?.mapped === false ? "air_roll_right" : null,
  rareMapped: sampleAudit.rare.find((item) => item.token === "jump" && item.mapped)?.token ?? null,
  accelerateRare: sampleAudit.rare.some((item) => item.token === "accelerate"),
  demo: {
    input: sampleAudit.demo?.input ?? null,
    output: sampleAudit.demo?.output ?? null,
    identical: sampleAudit.demo?.identical ?? null,
    contrast: sampleAudit.demo?.contrastOutput?.[0] ?? null,
  },
}
record("sample import", sampleExpected, sampleComputed)
same(sampleFindings.unmapped.severity, "high", "sample unmapped severity")
same(sampleFindings.collisions.severity, "high", "sample collision severity")
same(sampleFindings.orphans.severity, "low", "sample orphan severity")
same(sampleFindings.rare.severity, "high", "sample rare severity")
ok((sampleAudit.rare.find((item) => item.token === "air_roll_right")?.share ?? 1) < 410 / sampleAudit.totalEvents, "rare share")

const markdown = reportMarkdown(sampleLoaded.workspace, sampleAudit, sampleLoaded.issues)
ok(/Unmapped pass-throughs/.test(markdown), "markdown unmapped")
ok(/Collisions/.test(markdown), "markdown collisions")
ok(/Orphans/.test(markdown), "markdown orphans")
ok(/Rare-action coverage/.test(markdown), "markdown rare")
ok(/identical: true/.test(markdown), "markdown identical")
ok(/silent-by-default/.test(markdown), "markdown silent")
const json = JSON.parse(reportJson(sampleLoaded.workspace, sampleAudit, sampleLoaded.issues)) as {
  findings: Array<{ id: string }>
  demonstration: { identical: boolean }
}
same(
  json.findings.map((finding) => finding.id),
  ["unmapped", "collisions", "orphans", "rare"],
  "json finding ids",
)
same(json.demonstration.identical, true, "json demo identical")

const fixed = loadImport({
  mapText: read("fixtures/fixed-action-map.json"),
  logText: sampleLogText,
  mapLabel: "fixed ActionMap",
  logLabel: "sample log",
  sampleRequested: false,
})
const fixedAudit = runAudit(fixed.workspace, 5)
const fixedFindings = byId(fixedAudit)
record(
  "fixed sample map",
  { severities: ["clear", "clear", "low", "medium"], orphans: ["rear_view"] },
  {
    severities: [
      fixedFindings.unmapped.severity,
      fixedFindings.collisions.severity,
      fixedFindings.orphans.severity,
      fixedFindings.rare.severity,
    ],
    orphans: fixedAudit.orphans.map((row) => row.source),
  },
)
ok(fixedAudit.rare.every((item) => item.mapped), "fixed rare tokens are mapped")

const independent = loadImport({
  mapText: read("fixtures/independent-map.json"),
  logText: read("fixtures/independent-log.csv"),
  mapLabel: "independent-map.json",
  logLabel: "independent-log.csv",
  sampleRequested: false,
})
same(independent.issues, [], "independent fixture parses clean")
const independentAudit = runAudit(independent.workspace, 5)
record(
  "independent",
  {
    totalEvents: 15,
    risk: "Hold",
    unmapped: ["reset_camera"],
    collisions: [{ target: "throttle_positive", sources: ["accelerate", "boost"], inLog: ["accelerate", "boost"] }],
    orphans: [
      { source: "brake", target: "throttle_negative" },
      { source: "powerslide", target: "slide" },
    ],
    counts: [
      ["accelerate", 10],
      ["boost", 3],
      ["reset_camera", 2],
    ],
    rare: [],
    demo: { input: ["reset_camera"], output: ["reset_camera"], identical: true },
  },
  {
    totalEvents: independentAudit.totalEvents,
    risk: independentAudit.riskLabel,
    unmapped: independentAudit.unmapped.map((item) => item.token),
    collisions: independentAudit.collisions.map((group) => ({
      target: group.target,
      sources: group.sources,
      inLog: group.sourcesInLog,
    })),
    orphans: independentAudit.orphans,
    counts: independentAudit.counts.map((item) => [item.token, item.events]),
    rare: independentAudit.rare.map((item) => item.token),
    demo: independentAudit.demo
      ? { input: independentAudit.demo.input, output: independentAudit.demo.output, identical: independentAudit.demo.identical }
      : null,
  },
)

const mapOnly = loadImport({
  mapText: read("fixtures/independent-map.json"),
  logText: "",
  mapLabel: "independent-map.json",
  logLabel: "pasted log",
  sampleRequested: false,
})
const mapOnlyAudit = runAudit(mapOnly.workspace, 5)
const mapOnlyFindings = byId(mapOnlyAudit)
record(
  "map only",
  {
    totalEvents: 0,
    risk: "Review",
    unmapped: "unavailable",
    collisions: { severity: "medium", targets: ["throttle_positive"] },
    orphans: "unavailable",
    counts: [],
    demo: null,
  },
  {
    totalEvents: mapOnlyAudit.totalEvents,
    risk: mapOnlyAudit.riskLabel,
    unmapped: mapOnlyFindings.unmapped.severity,
    collisions: { severity: mapOnlyFindings.collisions.severity, targets: mapOnlyAudit.collisions.map((group) => group.target) },
    orphans: mapOnlyFindings.orphans.severity,
    counts: mapOnlyAudit.counts,
    demo: mapOnlyAudit.demo,
  },
)
same(mapOnlyAudit.unmapped, [], "map only does not invent unmapped tokens")

const logOnly = loadImport({
  mapText: "",
  logText: read("fixtures/independent-log.csv"),
  mapLabel: "pasted ActionMap",
  logLabel: "independent-log.csv",
  sampleRequested: false,
})
const logOnlyAudit = runAudit(logOnly.workspace, 5)
const logOnlyFindings = byId(logOnlyAudit)
record(
  "log only",
  {
    risk: "Incomplete",
    unmapped: "unavailable",
    collisions: "unavailable",
    orphans: "unavailable",
    counts: [
      ["accelerate", 10],
      ["boost", 3],
      ["reset_camera", 2],
    ],
    inventedUnmapped: [],
  },
  {
    risk: logOnlyAudit.riskLabel,
    unmapped: logOnlyFindings.unmapped.severity,
    collisions: logOnlyFindings.collisions.severity,
    orphans: logOnlyFindings.orphans.severity,
    counts: logOnlyAudit.counts.map((item) => [item.token, item.events]),
    inventedUnmapped: logOnlyAudit.unmapped.map((item) => item.token),
  },
)

const emptyMap = loadImport({
  mapText: read("fixtures/empty-map.json"),
  logText: read("fixtures/independent-log.csv"),
  mapLabel: "empty-map.json",
  logLabel: "independent-log.csv",
  sampleRequested: false,
})
const emptyAudit = runAudit(emptyMap.workspace, 5)
record(
  "empty map with log",
  {
    unmapped: ["reset_camera", "boost", "accelerate"],
    identical: true,
    collisions: 0,
    orphans: 0,
  },
  {
    unmapped: emptyAudit.unmapped.map((item) => item.token),
    identical: emptyAudit.demo?.identical ?? false,
    collisions: emptyAudit.collisions.length,
    orphans: emptyAudit.orphans.length,
  },
)

const quoted = parseLog(read("fixtures/quoted-log.csv"))
record(
  "quoted multiline csv",
  {
    issues: [],
    rows: [
      ["reset_camera", 7],
      ["air_roll_right", 9],
      ["jump", 16],
    ],
  },
  {
    issues: quoted.issues,
    rows: quoted.entries.map((entry) => [entry.token, entry.count]),
  },
)
ok(!quoted.entries.some((entry) => entry.token.includes("\n") || entry.token.includes(",")), "quotes stayed one field")

const badLog = parseLog(read("fixtures/bad-log.csv"))
record(
  "bad log rows",
  {
    lines: [3, 4, 6],
    counted: [
      ["accelerate", 10],
      ["dodge", 2],
    ],
  },
  {
    lines: badLog.issues.map((item) => item.line),
    counted: badLog.entries.map((entry) => [entry.token, entry.count]),
  },
)
ok(badLog.issues.length === 3, "bad rows kept visible")

const badMap = parseActionMap(read("fixtures/bad-map.json"))
record(
  "bad map value",
  {
    line: 3,
    rows: [
      ["accelerate", "throttle_positive"],
      ["brake", "throttle_negative"],
    ],
  },
  {
    line: badMap.issues[0]?.line ?? null,
    rows: badMap.rows.map((row) => [row.source, row.target]),
  },
)
ok(badMap.issues.some((item) => item.message.includes("boost")), "boost error names the token")

const duplicate = parseActionMap(read("fixtures/duplicate-map.json"))
record(
  "duplicate map key",
  { line: 3, target: "throttle_negative", issues: 1 },
  { line: duplicate.issues[0]?.line ?? null, target: duplicate.rows[0]?.target ?? null, issues: duplicate.issues.length },
)

const broken = parseActionMap(read("fixtures/broken-map.json"))
record(
  "broken map json",
  { status: "invalid", line: 4, rows: 0 },
  { status: broken.status, line: broken.issues[0]?.line ?? null, rows: broken.rows.length },
)

const noHeader = parseLog(read("fixtures/no-header.csv"))
record(
  "csv without header",
  { status: "invalid", line: 1, entries: 0 },
  { status: noHeader.status, line: noHeader.issues[0]?.line ?? null, entries: noHeader.entries.length },
)

const single = parseLog(read("fixtures/single-column.csv"))
record(
  "single column csv",
  [
    ["accelerate", 2],
    ["boost", 1],
  ],
  (() => {
    const totals = new Map<string, number>()
    for (const entry of single.entries) totals.set(entry.token, (totals.get(entry.token) ?? 0) + entry.count)
    return [...totals.entries()]
  })(),
)

const countsLog = parseLog(read("fixtures/counts-log.json"))
record(
  "json counts",
  [
    ["accelerate", 10],
    ["reset_camera", 2],
  ],
  countsLog.entries.map((entry) => [entry.token, entry.count]),
)

const brokenWithLog = loadImport({
  mapText: read("fixtures/broken-map.json"),
  logText: read("fixtures/independent-log.csv"),
  mapLabel: "broken-map.json",
  logLabel: "independent-log.csv",
  sampleRequested: false,
})
const brokenAudit = runAudit(brokenWithLog.workspace, 5)
const brokenFindings = byId(brokenAudit)
record(
  "broken map keeps the log",
  { collisions: "unavailable", events: 15, errors: 1 },
  {
    collisions: brokenFindings.collisions.severity,
    events: brokenAudit.totalEvents,
    errors: brokenWithLog.issues.length,
  },
)

console.log(
  JSON.stringify(
    {
      assertions,
      fixtures: reports,
      sample: summarise(sampleAudit),
    },
    null,
    2,
  ),
)
