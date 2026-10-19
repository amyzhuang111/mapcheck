import { applyActionMap, toMap } from "@/lib/apply"
import type {
  AuditResult,
  CollisionGroup,
  Finding,
  FindingId,
  LogEntry,
  OrphanRow,
  PassThroughDemo,
  RareToken,
  Severity,
  TokenCount,
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
  const ranked: Severity[] = ["high", "medium", "low", "clear"]
  for (const severity of ranked) {
    if (severities.includes(severity)) return severity
  }
  return "clear"
}

function unavailable(id: FindingId, title: string, why: string): Finding {
  return { id, title, severity: "unavailable", count: 0, tokens: [], why }
}

function mapReason(workspace: Workspace, subject: string): string {
  if (workspace.sources.map === "invalid") {
    return `The ActionMap text has parse errors, so ${subject} was not judged.`
  }
  return `No ActionMap was imported, so ${subject} was not judged.`
}

function logReason(workspace: Workspace, subject: string): string {
  if (workspace.sources.log === "invalid") {
    return `The log has parse errors, so ${subject} was not judged.`
  }
  return `No log was imported, so ${subject} was not judged.`
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
  const mapReady = workspace.sources.map === "ready"
  const logReady = workspace.sources.log === "ready"
  const map = mapReady ? toMap(workspace.mapping) : new Map<string, string>()
  const counts = logReady ? logTotals(workspace.log) : new Map<string, number>()
  const totalEvents = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const actionSet = workspace.sources.actionSet
    ? new Set(workspace.actionSet.map((token) => token.trim()).filter(Boolean))
    : new Set<string>()
  const known = new Set<string>([...actionSet, ...counts.keys()])

  const byTarget = new Map<string, string[]>()
  if (mapReady) {
    for (const [source, target] of map) {
      const list = byTarget.get(target) ?? []
      list.push(source)
      byTarget.set(target, list)
    }
  }

  let unmapped: UnmappedToken[] = []
  let unmappedFinding: Finding
  if (!mapReady) {
    unmappedFinding = unavailable("unmapped", "Unmapped pass-throughs", mapReason(workspace, "pass-through"))
  } else if (!logReady && !workspace.sources.actionSet) {
    unmappedFinding = unavailable(
      "unmapped",
      "Unmapped pass-throughs",
      "No log and no action_set were imported. The map only lists tokens that already have a row, so pass-through cannot be seen.",
    )
  } else {
    unmapped = [...known]
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
    const severity: Severity =
      unmapped.length === 0 ? "clear" : unmapped.some((item) => item.inLog) ? "high" : "medium"
    const scope = [
      logReady ? "the imported log" : null,
      workspace.sources.actionSet ? "the action_set" : null,
    ]
      .filter(Boolean)
      .join(" and ")
    unmappedFinding = {
      id: "unmapped",
      title: "Unmapped pass-throughs",
      severity,
      count: unmapped.length,
      tokens: unmapped.map((item) => item.token),
      why:
        unmapped.length === 0
          ? `Every token in ${scope} has a mapping row, so apply() would not pass one of these through.`
          : "These tokens are missing from the map, so apply() returns them unchanged and raises nothing. A raw name can reach the build.",
    }
  }

  let collisions: CollisionGroup[] = []
  let collisionFinding: Finding
  if (!mapReady) {
    collisionFinding = unavailable("collisions", "Collisions", mapReason(workspace, "collisions"))
  } else {
    collisions = [...byTarget.entries()]
      .filter(([, sources]) => sources.length > 1)
      .map(([target, sources]) => ({
        target,
        sources: [...sources].sort(),
        sourcesInLog: logReady ? sources.filter((source) => counts.has(source)).sort() : [],
      }))
      .sort((a, b) => b.sourcesInLog.length - a.sourcesInLog.length || a.target.localeCompare(b.target))
    const severity: Severity =
      collisions.length === 0
        ? "clear"
        : logReady && collisions.some((group) => group.sourcesInLog.length >= 2)
          ? "high"
          : "medium"
    collisionFinding = {
      id: "collisions",
      title: "Collisions",
      severity,
      count: collisions.length,
      tokens: collisions.flatMap((group) => group.sources),
      why:
        collisions.length === 0
          ? "No target is shared by more than one source token."
          : logReady
            ? "Several source tokens become one target, so the build can no longer tell those actions apart."
            : "Several source tokens become one target. No log was imported, so this does not say those tokens were used.",
    }
  }

  let orphans: OrphanRow[] = []
  let orphanFinding: Finding
  if (!mapReady) {
    orphanFinding = unavailable("orphans", "Orphans", mapReason(workspace, "unused mappings"))
  } else if (!logReady) {
    orphanFinding = unavailable("orphans", "Orphans", logReason(workspace, "unused mappings"))
  } else {
    orphans = [...map.entries()]
      .filter(([source]) => !counts.has(source))
      .map(([source, target]) => ({ source, target }))
      .sort((a, b) => a.source.localeCompare(b.source))
    orphanFinding = {
      id: "orphans",
      title: "Orphans",
      severity: orphans.length === 0 ? "clear" : "low",
      count: orphans.length,
      tokens: orphans.map((row) => row.source),
      why:
        orphans.length === 0
          ? "Every mapping row names a token that appears in the imported log."
          : "These mapped tokens do not appear in the imported log, so those rows cover nothing that was logged.",
    }
  }

  let rare: RareToken[] = []
  let rareFinding: Finding
  if (!logReady) {
    rareFinding = unavailable("rare", "Rare-action coverage", logReason(workspace, "rare-action coverage"))
  } else if (!mapReady) {
    rareFinding = unavailable("rare", "Rare-action coverage", mapReason(workspace, "rare-action coverage"))
  } else {
    rare = [...counts.entries()]
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
    const severity: Severity = rare.length === 0 ? "clear" : rare.some((item) => !item.mapped) ? "high" : "medium"
    rareFinding = {
      id: "rare",
      title: "Rare-action coverage",
      severity,
      count: rare.length,
      tokens: rare.map((item) => item.token),
      why:
        rare.length === 0
          ? "Nothing in the log sits under the frequency cut."
          : "Sparse actions are the ones action-following loses first. Unmapped ones pass through silently. Mapped ones are only structurally covered.",
    }
  }

  const findings = [unmappedFinding, collisionFinding, orphanFinding, rareFinding]
  const ran = findings.filter((finding) => finding.severity !== "unavailable")
  const severity = highest(ran.map((finding) => finding.severity))
  const missing = findings.some((finding) => finding.severity === "unavailable")
  const risk =
    ran.length === 0
      ? {
          label: "Incomplete",
          detail: "Nothing structural was checked. Import the missing ActionMap or log. Counts appear only when a log parses.",
        }
      : severity === "high"
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
                detail: "Only orphan rows. They do not change apply() for tokens that appear in this log.",
              }
            : missing
              ? {
                  label: "Partial",
                  detail: "The checks that could run are clear. Other checks were skipped because the map or the log was not imported.",
                }
              : {
                  label: "Clear",
                  detail: "No structural flags at this frequency cut. This still says nothing about whether each target is the right control.",
                }

  const countsOut: TokenCount[] = [...counts.entries()]
    .map(([token, events]) => ({
      token,
      events,
      share: totalEvents > 0 ? events / totalEvents : 0,
      mapped: mapReady ? map.has(token) : null,
      target: mapReady ? (map.get(token) ?? null) : null,
    }))
    .sort((a, b) => b.events - a.events || a.token.localeCompare(b.token))

  const mappedTokens = mapReady ? [...map.keys()].filter((token) => known.has(token)).sort() : []
  const demo =
    unmappedFinding.severity !== "unavailable" && unmapped.length > 0
      ? pickDemo(workspace.mapping, unmapped, mappedTokens)
      : null

  return {
    ranAt: new Date().toISOString(),
    thresholdPct: threshold,
    totalEvents,
    findings,
    unmapped,
    collisions,
    orphans,
    rare,
    counts: countsOut,
    demo,
    riskLabel: risk.label,
    riskDetail: risk.detail,
  }
}
