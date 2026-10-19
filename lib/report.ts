import { formatShare, formatTimestamp, formatWhen } from "@/lib/format"
import type { AuditResult, Workspace } from "@/lib/types"

function quote(values: string[]): string {
  if (values.length === 0) return "—"
  return values.map((value) => `\`${value}\``).join(", ")
}

export function reportMarkdown(workspace: Workspace, audit: AuditResult): string {
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
    if (finding.id === "unmapped") {
      lines.push("| Token | Where | Events | Share |")
      lines.push("| --- | --- | ---: | ---: |")
      for (const item of audit.unmapped) {
        const where = [item.inActionSet ? "action set" : null, item.inLog ? "log" : null].filter(Boolean).join(" + ")
        lines.push(`| \`${item.token}\` | ${where} | ${item.events} | ${formatShare(item.events, audit.totalEvents)} |`)
      }
      lines.push("")
      lines.push("### Pass-through demonstration")
      lines.push("")
      lines.push("Local reimplementation of the v0.24.0 rule. Not a call to the API.")
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
    if (finding.id === "collisions") {
      for (const group of audit.collisions) {
        lines.push(`- \`${group.target}\` ← ${quote(group.sources)} (in the log: ${quote(group.sourcesInLog)})`)
      }
      lines.push("")
    }
    if (finding.id === "orphans") {
      for (const row of audit.orphans) {
        lines.push(`- \`${row.source}\` → \`${row.target}\``)
      }
      lines.push("")
    }
    if (finding.id === "rare") {
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

  const logRows = [...workspace.log].sort((a, b) => a.tMs - b.tMs)
  const logPreview = logRows
    .slice(0, 8)
    .map((entry) => `| ${formatTimestamp(entry.tMs)} | \`${entry.token}\` | ${entry.count} |`)
    .join("\n")

  return [
    "# MapCheck audit report",
    "",
    "SDK-shaped sample. Not a General Intuition model, session, or API response. No API key was used.",
    "This report flags structural risk only. It cannot judge whether a target action is semantically correct.",
    "Pass-through of unmapped tokens is the documented silent-by-default behaviour of ActionMap.apply in general-intuition-sdk 0.24.0, not a defect claimed by this tool.",
    "",
    `- Ran: ${formatWhen(audit.ranAt)}`,
    `- Sample model id: \`${workspace.modelId}\``,
    `- Rare-action cut: ${audit.thresholdPct}%`,
    `- Logged events: ${audit.totalEvents}`,
    "",
    "## Risk scoreboard",
    "",
    `- Label: **${audit.riskLabel}**`,
    `- ${audit.riskDetail}`,
    "",
    ...audit.findings.map(
      (finding) => `- ${finding.title}: ${finding.severity} (${finding.count})`,
    ),
    "",
    ...findingBlocks,
    "## Action set",
    "",
    workspace.actionSet.map((token) => `- \`${token}\``).join("\n"),
    "",
    "## Mapping",
    "",
    "| Source | Target |",
    "| --- | --- |",
    ...workspace.mapping.map((row) => `| \`${row.source}\` | \`${row.target}\` |`),
    "",
    "## Session log (first rows)",
    "",
    "Synthetic timestamped counts. The full log is in the JSON export.",
    "",
    "| Timestamp | Token | Count |",
    "| --- | --- | ---: |",
    logPreview,
    "",
    "## Limits",
    "",
    "- No public evidence found of a partner-facing auditor for this mapping. This page is not that missing official tool, and it is not affiliated with General Intuition or Medal.",
    "- Model.action_set in v0.24.0 is a list of dicts. The package does not document the dict fields. This sample audits the strings apply() receives.",
    "- The SDK's own example maps raw keys such as W to labels such as forward. These source names are Rocket Science-style control tokens, used so a driving build's vocabulary is what gets audited. The rule is the same either way.",
    "",
  ].join("\n")
}

export function reportJson(workspace: Workspace, audit: AuditResult): string {
  return JSON.stringify(
    {
      tool: "MapCheck",
      disclaimer:
        "SDK-shaped sample. No API key, no real model, no real session. Structural risk only. Unmapped pass-through is silent-by-default behaviour of ActionMap.apply in general-intuition-sdk 0.24.0, not a bug claimed here.",
      sampleModelId: workspace.modelId,
      ranAt: audit.ranAt,
      thresholdPct: audit.thresholdPct,
      totalEvents: audit.totalEvents,
      risk: { label: audit.riskLabel, detail: audit.riskDetail },
      findings: audit.findings,
      unmapped: audit.unmapped,
      collisions: audit.collisions,
      orphans: audit.orphans,
      rare: audit.rare,
      demonstration: audit.demo,
      actionSet: workspace.actionSet,
      mapping: workspace.mapping.map((row) => ({ source: row.source, target: row.target })),
      sessionLog: workspace.log.map((entry) => ({
        tMs: entry.tMs,
        timestamp: formatTimestamp(entry.tMs),
        token: entry.token,
        count: entry.count,
      })),
    },
    null,
    2,
  )
}
