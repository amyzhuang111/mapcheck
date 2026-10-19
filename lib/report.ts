import { formatShare, formatTimestamp, formatWhen } from "@/lib/format"
import type { AuditResult, ParseIssue, Workspace } from "@/lib/types"

function quote(values: string[]): string {
  if (values.length === 0) return "—"
  return values.map((value) => `\`${value}\``).join(", ")
}

function sourceLine(workspace: Workspace): string {
  if (workspace.sources.sample) {
    return "Labelled synthetic sample. Not a General Intuition model, session, or API response."
  }
  return "Imported by the person running MapCheck. Not an API response."
}

export function reportMarkdown(workspace: Workspace, audit: AuditResult, issues: ParseIssue[] = []): string {
  const findingBlocks = audit.findings.map((finding) => {
    const lines = [
      `## ${finding.title}`,
      "",
      `- Severity: ${finding.severity}`,
      `- Count: ${finding.count}`,
      `- Affected tokens: ${quote(finding.tokens)}`,
      `- Why it matters: ${finding.why}`,
      "",
    ]
    if (finding.id === "unmapped" && finding.severity !== "unavailable") {
      lines.push("| Token | Where | Events | Share |")
      lines.push("| --- | --- | ---: | ---: |")
      for (const item of audit.unmapped) {
        const where = [item.inActionSet ? "action set" : null, item.inLog ? "log" : null].filter(Boolean).join(" + ")
        lines.push(`| \`${item.token}\` | ${where || "—"} | ${item.events} | ${formatShare(item.events, audit.totalEvents)} |`)
      }
      lines.push("")
      if (audit.demo) {
        lines.push("### Pass-through demonstration")
        lines.push("")
        lines.push("Local reimplementation of the v0.24.0 rule, applied to a token from this import. Not a call to the API.")
        lines.push("")
        lines.push("```")
        lines.push(`input  ${JSON.stringify(audit.demo.input)}`)
        lines.push(`output ${JSON.stringify(audit.demo.output)}`)
        lines.push(`identical: ${audit.demo.identical}`)
        lines.push("```")
        lines.push("")
        if (audit.demo.contrastToken) {
          lines.push(`Contrast, a mapped token \`${audit.demo.contrastToken}\`:`)
          lines.push("")
          lines.push("```")
          lines.push(`input  ${JSON.stringify(audit.demo.contrastInput)}`)
          lines.push(`output ${JSON.stringify(audit.demo.contrastOutput)}`)
          lines.push("```")
          lines.push("")
        }
      }
    }
    if (finding.id === "collisions" && finding.severity !== "unavailable") {
      for (const group of audit.collisions) {
        lines.push(`- \`${group.target}\` ← ${quote(group.sources)} (in the log: ${quote(group.sourcesInLog)})`)
      }
      lines.push("")
    }
    if (finding.id === "orphans" && finding.severity !== "unavailable") {
      for (const row of audit.orphans) {
        lines.push(`- \`${row.source}\` → \`${row.target}\``)
      }
      lines.push("")
    }
    if (finding.id === "rare" && finding.severity !== "unavailable") {
      lines.push(`Frequency cut: under ${audit.thresholdPct}% of ${audit.totalEvents} logged events.`)
      lines.push("")
      lines.push("| Token | Events | Share | Mapped | Target |")
      lines.push("| --- | ---: | ---: | --- | --- |")
      for (const item of audit.rare) {
        const target = item.target ? `\`${item.target}\`${item.sharedTarget ? " (shared)" : ""}` : "—"
        lines.push(`| \`${item.token}\` | ${item.events} | ${formatShare(item.events, audit.totalEvents)} | ${item.mapped ? "yes" : "no"} | ${target} |`)
      }
      lines.push("")
    }
    return lines.join("\n")
  })

  const logRows = [...workspace.log].sort((a, b) => a.tMs - b.tMs || a.token.localeCompare(b.token))
  const logPreview = logRows
    .slice(0, 8)
    .map((entry) => `| ${formatTimestamp(entry.tMs)} | \`${entry.token}\` | ${entry.count} |`)
    .join("\n")

  const issueLines =
    issues.length === 0
      ? ["## Parse errors", "", "None.", ""]
      : [
          "## Parse errors",
          "",
          "These rows were kept visible and were not used as audit rows.",
          "",
          "| Source | Line | Problem | Raw |",
          "| --- | ---: | --- | --- |",
          ...issues.map(
            (item) =>
              `| ${item.source} | ${item.line ?? "—"} | ${item.message.replace(/\|/g, "/")} | ${item.raw.replace(/\|/g, "/")} |`,
          ),
          "",
        ]

  return [
    "# MapCheck audit report",
    "",
    sourceLine(workspace),
    "This report flags structural risk only. It cannot judge whether a target action is semantically correct.",
    "Pass-through of unmapped tokens is the documented silent-by-default behaviour of ActionMap.apply in general-intuition-sdk 0.24.0, not a defect claimed by this tool.",
    "",
    `- Ran: ${formatWhen(audit.ranAt)}`,
    `- ActionMap: ${workspace.sources.map === "absent" ? "not imported" : workspace.sources.mapLabel}`,
    `- Log: ${workspace.sources.log === "absent" ? "not imported" : workspace.sources.logLabel}`,
    ...(workspace.modelId ? [`- Model id: \`${workspace.modelId}\``] : []),
    `- Rare-action cut: ${audit.thresholdPct}%`,
    `- Logged events: ${audit.totalEvents}`,
    "",
    "## Risk scoreboard",
    "",
    `- Label: **${audit.riskLabel}**`,
    `- ${audit.riskDetail}`,
    "",
    ...audit.findings.map((finding) => `- ${finding.title}: ${finding.severity} (${finding.count})`),
    "",
    ...issueLines,
    ...findingBlocks,
    "## Counts",
    "",
    workspace.sources.log === "ready"
      ? [
          "| Token | Events | Share |",
          "| --- | ---: | ---: |",
          ...audit.counts.map(
            (item) => `| \`${item.token}\` | ${item.events} | ${formatShare(item.events, audit.totalEvents)} |`,
          ),
          "",
        ].join("\n")
      : "No log was imported.\n",
    "## Action set",
    "",
    workspace.sources.actionSet
      ? workspace.actionSet.map((token) => `- \`${token}\``).join("\n")
      : "No action_set was included in the ActionMap file.",
    "",
    "## Mapping",
    "",
    workspace.sources.map === "ready"
      ? ["| Source | Target |", "| --- | --- |", ...workspace.mapping.map((row) => `| \`${row.source}\` | \`${row.target}\` |`), ""].join(
          "\n",
        )
      : "No ActionMap rows were used.\n",
    "## Session log (first rows)",
    "",
    workspace.sources.log === "ready"
      ? [
          workspace.sources.sample ? "Labelled synthetic sample." : "Rows from the imported log.",
          "",
          "| Timestamp | Token | Count |",
          "| --- | --- | ---: |",
          logPreview || "| — | — | — |",
          "",
        ].join("\n")
      : "No log was imported.\n",
    "## Limits",
    "",
    "- Checks that need a map or a log are left unjudged when that file was not imported. The missing half is not invented.",
    "- No public evidence found of a partner-facing auditor for this mapping. This page is not that missing official tool, and it is not affiliated with General Intuition or Medal.",
    "- Model.action_set in v0.24.0 is a list of dicts. The package does not document the dict fields. This tool audits token strings.",
    "- The SDK's own example maps raw keys such as W to labels such as forward. A driving sample uses Rocket Science-style names. The rule is the same either way.",
    "",
  ].join("\n")
}

export function reportJson(workspace: Workspace, audit: AuditResult, issues: ParseIssue[] = []): string {
  return JSON.stringify(
    {
      tool: "MapCheck",
      disclaimer:
        "Structural risk only. Unmapped pass-through is silent-by-default behaviour of ActionMap.apply in general-intuition-sdk 0.24.0, not a bug claimed here. Missing inputs are not invented.",
      sample: workspace.sources.sample,
      modelId: workspace.modelId || null,
      mapLabel: workspace.sources.mapLabel,
      logLabel: workspace.sources.logLabel,
      sources: workspace.sources,
      ranAt: audit.ranAt,
      thresholdPct: audit.thresholdPct,
      totalEvents: audit.totalEvents,
      risk: { label: audit.riskLabel, detail: audit.riskDetail },
      parseErrors: issues,
      findings: audit.findings,
      counts: audit.counts,
      unmapped: audit.unmapped,
      collisions: audit.collisions,
      orphans: audit.orphans,
      rare: audit.rare,
      demonstration: audit.demo,
      actionSet: workspace.sources.actionSet ? workspace.actionSet : null,
      mapping: workspace.mapping.map((row) => ({ source: row.source, target: row.target })),
      sessionLog: workspace.log.map((entry) => ({
        tMs: entry.tMs,
        timestamp: formatTimestamp(entry.tMs),
        token: entry.token,
        count: entry.count,
        line: entry.line,
      })),
    },
    null,
    2,
  )
}
