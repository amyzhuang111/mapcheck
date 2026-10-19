import { applyActionMap, toMap } from "@/lib/apply"
import type {
  AuditResult,
  CollisionGroup,
  Finding,
  LogEntry,
  OrphanRow,
  PassThroughDemo,
  RareToken,
  Severity,
  UnmappedToken,
  Workspace,
} from "@/lib/types"

function logTotals(log: LogEntry[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const entry of log) {
    const token = entry.token.trim()
    if (!token || entry.count <= 0) continue
    totals.set(token, (totals.get(token) ?? 0) + entry.count)
  }
  return totals
}

function highest(severities: Severity[]): Severity {
  if (severities.includes("high")) return "high"
  if (severities.includes("medium")) return "medium"
  if (severities.includes("low")) return "low"
  return "clear"
}

function pickDemo(
  rows: Workspace["mapping"],
  unmapped: UnmappedToken[],
  mappedTokens: string[],
): PassThroughDemo {
  const logged = unmapped.filter((item) => item.inLog)
  const ranked = [...(logged.length > 0 ? logged : unmapped)].sort((a, b) => {
    const setDelta = Number(b.inActionSet) - Number(a.inActionSet)
    if (setDelta !== 0) return setDelta
    return a.events - b.events || a.token.localeCompare(b.token)
  })
  const token = ranked[0]?.token ?? "unlisted_token"
  const input = [token]
  const output = applyActionMap(input, rows)
  const contrastToken = mappedTokens[0] ?? null
  const contrastInput = contrastToken ? [contrastToken] : []
  const contrastOutput = contrastToken ? applyActionMap(contrastInput, rows) : []
  return {
    token,
    input,
    output,
    identical: input.join("\0") === output.join("\0"),
    contrastToken,
    contrastInput,
    contrastOutput,
    contrastIdentical: contrastInput.join("\0") === contrastOutput.join("\0"),
  }
}

export function runAudit(workspace: Workspace, thresholdPct: number): AuditResult {
  const threshold = Number.isFinite(thresholdPct) ? Math.min(100, Math.max(0, thresholdPct)) : 5
  const map = toMap(workspace.mapping)
  const counts = logTotals(workspace.log)
  const totalEvents = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const actionSet = new Set(workspace.actionSet.map((token) => token.trim()).filter(Boolean))
  const known = new Set<string>([...actionSet, ...counts.keys()])

  const unmapped: UnmappedToken[] = [...known]
    .filter((token) => !map.has(token))
    .map((token) => {
      const events = counts.get(token) ?? 0
      return {
        token,
        inActionSet: actionSet.has(token),
        inLog: counts.has(token),
        events,
        share: totalEvents > 0 ? events / totalEvents : 0,
      }
    })
    .sort((a, b) => Number(b.inLog) - Number(a.inLog) || a.events - b.events || a.token.localeCompare(b.token))

  const byTarget = new Map<string, string[]>()
  for (const [source, target] of map) {
    const list = byTarget.get(target) ?? []
    list.push(source)
    byTarget.set(target, list)
  }
  const collisions: CollisionGroup[] = [...byTarget.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([target, sources]) => ({
      target,
      sources: [...sources].sort(),
      sourcesInLog: sources.filter((source) => counts.has(source)).sort(),
    }))
    .sort((a, b) => b.sourcesInLog.length - a.sourcesInLog.length || a.target.localeCompare(b.target))

  const orphans: OrphanRow[] = [...map.entries()]
    .filter(([source]) => !known.has(source))
    .map(([source, target]) => ({ source, target }))
    .sort((a, b) => a.source.localeCompare(b.source))

  const rare: RareToken[] = [...counts.entries()]
    .filter(([, events]) => totalEvents > 0 && events / totalEvents < threshold / 100)
    .map(([token, events]) => {
      const target = map.get(token) ?? null
      const sharedTarget = target != null && (byTarget.get(target)?.length ?? 0) > 1
      return {
        token,
        events,
        share: events / totalEvents,
        mapped: target != null,
        target,
        sharedTarget,
      }
    })
    .sort((a, b) => a.events - b.events || a.token.localeCompare(b.token))

  const unmappedSeverity: Severity =
    unmapped.length === 0 ? "clear" : unmapped.some((item) => item.inLog) ? "high" : "medium"
  const collisionSeverity: Severity =
    collisions.length === 0
      ? "clear"
      : collisions.some((group) => group.sourcesInLog.length >= 2)
        ? "high"
        : "medium"
  const orphanSeverity: Severity = orphans.length === 0 ? "clear" : "low"
  const rareSeverity: Severity =
    rare.length === 0 ? "clear" : rare.some((item) => !item.mapped) ? "high" : "medium"

  const findings: Finding[] = [
    {
      id: "unmapped",
      title: "Unmapped pass-throughs",
      severity: unmappedSeverity,
      count: unmapped.length,
      tokens: unmapped.map((item) => item.token),
      why:
        unmapped.length === 0
          ? "Every token in the action set and the log has a mapping row, so apply() would not pass one of these through."
          : "These tokens are missing from the map, so apply() returns them unchanged and raises nothing — a raw name can reach the build.",
    },
    {
      id: "collisions",
      title: "Collisions",
      severity: collisionSeverity,
      count: collisions.length,
      tokens: collisions.flatMap((group) => group.sources),
      why:
        collisions.length === 0
          ? "No target is shared by more than one source token."
          : "Several source tokens become one target, so the build can no longer tell those actions apart.",
    },
    {
      id: "orphans",
      title: "Orphans",
      severity: orphanSeverity,
      count: orphans.length,
      tokens: orphans.map((row) => row.source),
      why:
        orphans.length === 0
          ? "Every mapping row names a token that appears in the action set or the log."
          : "These rows name tokens that are not in the action set and never appear in the log, so they cover nothing here.",
    },
    {
      id: "rare",
      title: "Rare-action coverage",
      severity: rareSeverity,
      count: rare.length,
      tokens: rare.map((item) => item.token),
      why:
        rare.length === 0
          ? "Nothing in the log sits under the frequency cut."
          : "Sparse actions are the ones action-following loses first. Unmapped ones pass through silently; mapped ones are only structurally covered.",
    },
  ]

  const severity = highest(findings.map((finding) => finding.severity))
  const risk =
    severity === "high"
      ? {
          label: "Hold",
          detail: "High-severity structural flags. Do not treat this map as ready for a game or robot build.",
        }
      : severity === "medium"
        ? {
            label: "Review",
            detail: "No silent pass-through of a logged token, but the map still collapses or under-covers something.",
          }
        : severity === "low"
          ? {
              label: "Tidy",
              detail: "Only orphan rows. They do not change apply() for tokens in this sample.",
            }
          : {
              label: "Clear",
              detail: "No structural flags at this frequency cut. This still says nothing about whether each target is the right control.",
            }

  const mappedTokens = [...map.keys()].filter((token) => known.has(token)).sort()

  return {
    ranAt: new Date().toISOString(),
    thresholdPct: threshold,
    totalEvents,
    findings,
    unmapped,
    collisions,
    orphans,
    rare,
    demo: pickDemo(workspace.mapping, unmapped, mappedTokens),
    riskLabel: risk.label,
    riskDetail: risk.detail,
  }
}
