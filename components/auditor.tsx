"use client"

import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { applyActionMap, toMap } from "@/lib/apply"
import { runAudit } from "@/lib/audit"
import { formatShare, formatTimestamp, formatWhen } from "@/lib/format"
import { reportJson, reportMarkdown } from "@/lib/report"
import { createSample, DEFAULT_RARE_THRESHOLD_PCT } from "@/lib/sample"
import type { AuditResult, MappingRow, Severity, Workspace } from "@/lib/types"

function snapshot(workspace: Workspace, threshold: number): string {
  return JSON.stringify({
    threshold,
    mapping: workspace.mapping.map((row) => [row.source, row.target]),
  })
}

function download(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function labelSeverity(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}

export function Auditor() {
  const [workspace, setWorkspace] = useState<Workspace>(() => createSample())
  const [threshold, setThreshold] = useState(DEFAULT_RARE_THRESHOLD_PCT)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [auditedSnapshot, setAuditedSnapshot] = useState<string | null>(null)
  const [tryToken, setTryToken] = useState<string | null>(null)
  const rowSeq = useRef(100)

  const stale = audit !== null && auditedSnapshot !== snapshot(workspace, threshold)
  const map = useMemo(() => toMap(workspace.mapping), [workspace.mapping])

  const totals = useMemo(() => {
    const counts = new Map<string, { events: number; first: number; last: number }>()
    for (const entry of workspace.log) {
      const token = entry.token.trim()
      if (!token || entry.count <= 0) continue
      const current = counts.get(token) ?? { events: 0, first: entry.tMs, last: entry.tMs }
      current.events += entry.count
      current.first = Math.min(current.first, entry.tMs)
      current.last = Math.max(current.last, entry.tMs)
      counts.set(token, current)
    }
    const total = [...counts.values()].reduce((sum, item) => sum + item.events, 0)
    const rows = [...counts.entries()]
      .map(([token, item]) => ({ token, ...item, share: total > 0 ? item.events / total : 0 }))
      .sort((a, b) => b.events - a.events || a.token.localeCompare(b.token))
    return { total, rows }
  }, [workspace.log])

  const duplicateSources = useMemo(() => {
    const seen = new Map<string, number>()
    for (const row of workspace.mapping) {
      const source = row.source.trim()
      if (!source) continue
      seen.set(source, (seen.get(source) ?? 0) + 1)
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([source]) => source))
  }, [workspace.mapping])

  function commitAudit(next: AuditResult) {
    setAudit(next)
    setAuditedSnapshot(snapshot(workspace, threshold))
    setTryToken(next.demo.token)
  }

  function onAudit() {
    commitAudit(runAudit(workspace, threshold))
  }

  function onExport(format: "md" | "json") {
    const next = runAudit(workspace, threshold)
    commitAudit(next)
    const stamp = next.ranAt.slice(0, 19).replace(/[:T]/g, "")
    if (format === "md") {
      download(`mapcheck-audit-${stamp}.md`, reportMarkdown(workspace, next), "text/markdown")
    } else {
      download(`mapcheck-audit-${stamp}.json`, reportJson(workspace, next), "application/json")
    }
  }

  function updateRow(id: string, patch: Partial<MappingRow>) {
    setWorkspace((current) => ({
      ...current,
      mapping: current.mapping.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }))
  }

  function removeRow(id: string) {
    setWorkspace((current) => ({
      ...current,
      mapping: current.mapping.filter((row) => row.id !== id),
    }))
  }

  function addRow(source = "", target = "") {
    const id = `map-new-${rowSeq.current}`
    rowSeq.current += 1
    setWorkspace((current) => ({
      ...current,
      mapping: [...current.mapping, { id, source, target }],
    }))
  }

  function resetSample() {
    setWorkspace(createSample())
    setThreshold(DEFAULT_RARE_THRESHOLD_PCT)
    setAudit(null)
    setAuditedSnapshot(null)
    setTryToken(null)
  }

  const liveToken = tryToken ?? "reset_camera"
  const liveInput = [liveToken]
  const liveOutput = applyActionMap(liveInput, workspace.mapping)
  const liveIdentical = liveInput[0] === liveOutput[0]
  const heroInput = ["reset_camera"]
  const heroOutput = applyActionMap(heroInput, workspace.mapping)
  const heroIdentical = heroOutput[0] === "reset_camera"

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <header className="gi-hero px-5 py-6 sm:px-8 sm:py-8">
        <p className="text-sm">MapCheck.</p>
        <h1 className="mt-4 max-w-[45ch] text-[32px] leading-[1.25] font-normal sm:text-[40px]">
          Unmapped actions pass through silently.
        </h1>
        <p className="mt-4 max-w-[45ch] text-base leading-[1.25]">
          A preflight for the ActionMap in general-intuition-sdk 0.24.0.
        </p>
        <p className="mt-4 max-w-[45ch] text-base leading-[1.25]">Sample audit — hardcoded example data. Edit rows by hand to explore. Real ActionMap/log import is not built yet.</p>
        <table className="gi-grid mt-6 max-w-xl">
          <tbody>
            <tr>
              <th scope="row">In</th>
              <td>{JSON.stringify(heroInput)}</td>
            </tr>
            <tr>
              <th scope="row">Out</th>
              <td>{JSON.stringify(heroOutput)}</td>
            </tr>
            <tr>
              <th scope="row">Result</th>
              <td>
                {heroIdentical
                  ? "Identical. Passed through unchanged."
                  : "Replaced. This token now has a mapping row."}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button
            type="button"
            onClick={() => onExport("md")}
            style={{
              background: "#fff",
              color: "#000",
              border: "1px solid #000",
              borderRadius: 0,
              padding: "8px 16px",
              fontWeight: 500,
            }}
          >
            Export audit report
          </Button>
          <button
            type="button"
            className="text-sm leading-[1.25] underline"
            onClick={() => onExport("json")}
          >
            Download JSON
          </button>
        </div>
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="gi-card p-4">
            <h2 className="text-2xl leading-[1.25] font-normal">Action set.</h2>
            <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              Tokens this sample model can emit. v0.24.0 types the field as a list of dicts. The
              package does not document those fields, so the sample uses the strings apply()
              receives.
            </p>
            <p className="mt-2 font-mono text-xs text-[#888]">{workspace.modelId}</p>
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid min-w-[28rem]">
                <tbody>
                  <tr>
                    {workspace.actionSet.map((token) => (
                      <td key={token}>{token}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="gi-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-2xl leading-[1.25] font-normal">Mapping.</h2>
              <Button type="button" variant="outline" onClick={() => addRow()}>
                Add row
              </Button>
            </div>
            <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              Source token to target action. Blank rows are ignored. A repeated source keeps the
              last row, the way a Python dict would.
            </p>
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid min-w-[32rem]">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Row</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.mapping.map((row) => {
                    const source = row.source.trim()
                    const duplicate = source !== "" && duplicateSources.has(source)
                    return (
                      <tr key={row.id}>
                        <td>
                          <label className="block">
                            <span className="sr-only">Source token</span>
                            <Input
                              value={row.source}
                              spellCheck={false}
                              aria-invalid={duplicate}
                              onChange={(event) => updateRow(row.id, { source: event.target.value })}
                            />
                          </label>
                        </td>
                        <td>
                          <label className="block">
                            <span className="sr-only">Target action</span>
                            <Input
                              value={row.target}
                              spellCheck={false}
                              onChange={(event) => updateRow(row.id, { target: event.target.value })}
                            />
                          </label>
                          {duplicate ? (
                            <p className="mt-1 max-w-[45ch] text-xs text-[#888]">
                              Duplicate source. The last row is the one apply() keeps.
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <Button type="button" variant="outline" onClick={() => removeRow(row.id)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="gi-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-2xl leading-[1.25] font-normal">Session log.</h2>
              <p className="font-mono text-xs text-[#888]">{totals.total} events. SAMPLE — synthetic.</p>
            </div>
            <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              Timestamped counts for one made-up session. Not an API session, and not Medal or
              Rocket Science data. dodge is in the log and not in the action set.
            </p>
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid min-w-[36rem]">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Events</th>
                    <th>Share</th>
                    <th>Target</th>
                    <th>Span</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.rows.map((row) => {
                    const target = map.get(row.token)
                    const rare = audit ? row.share * 100 < audit.thresholdPct : false
                    return (
                      <tr key={row.token}>
                        <td>
                          {row.token}
                          {rare ? <span className="text-[#888]"> rare</span> : null}
                        </td>
                        <td>{row.events}</td>
                        <td>{formatShare(row.events, totals.total)}</td>
                        <td>{target ?? (audit ? "pass-through" : "—")}</td>
                        <td>
                          {formatTimestamp(row.first)}–{formatTimestamp(row.last)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-[#888]">
                Timestamped rows ({workspace.log.length}).
              </summary>
              <ul className="mt-2 max-h-48 overflow-auto font-mono text-xs leading-[1.25]">
                {workspace.log.map((entry) => (
                  <li key={entry.id}>
                    {formatTimestamp(entry.tMs)} {entry.token} × {entry.count}
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section aria-live="polite" className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end gap-4">
              <label className="block">
                <span className="text-sm text-[#888]">Rare under.</span>
                <span className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={threshold}
                    className="w-24"
                    onChange={(event) => setThreshold(Number(event.target.value))}
                  />
                  <span className="text-sm text-[#888]">% of logged events.</span>
                </span>
              </label>
              <Button type="button" variant="outline" onClick={onAudit}>
                {audit ? "Run audit again" : "Run audit"}
              </Button>
              <Button type="button" variant="outline" onClick={resetSample}>
                Reset sample
              </Button>
            </div>
            {audit ? (
              <Results
                audit={audit}
                stale={stale}
                liveToken={liveToken}
                liveIdentical={liveIdentical}
                liveInput={liveInput}
                liveOutput={liveOutput}
                onTry={setTryToken}
                onAdd={addRow}
              />
            ) : (
              <p className="max-w-[45ch] text-sm leading-[1.25] text-[#888]">
                The tables fill when you export or run the audit. The loaded sample already plants
                one of each finding.
              </p>
            )}
          </section>
        </div>

        <aside className="gi-card p-4 lg:sticky lg:top-4">
          <h2 className="text-2xl leading-[1.25] font-normal">Honesty.</h2>
          <div className="mt-3 space-y-3 text-sm leading-[1.25]">
            <p className="max-w-[45ch]">SDK-shaped synthetic sample only.</p>
            <p className="max-w-[45ch]">
              Structural risk only. This cannot judge whether a mapping is semantically correct.
            </p>
            <p className="max-w-[45ch]">
              Unmapped pass-through is silent-by-default behaviour in general-intuition-sdk 0.24.0.
              It is not claimed as a bug.
            </p>
          </div>
          <h2 className="mt-6 text-2xl leading-[1.25] font-normal">Limits.</h2>
          <ul className="mt-3 space-y-3 text-sm leading-[1.25] text-[#888]">
            <li className="max-w-[45ch]">No API key is used. Nothing is sent off this page.</li>
            <li className="max-w-[45ch]">
              Model.action_set is a list of dicts in v0.24.0. The package does not document the
              dict fields. This sample audits the strings apply() receives.
            </li>
            <li className="max-w-[45ch]">
              No public evidence found of a partner-facing tool that audits this map before a game
              or robot build.
            </li>
            <li className="max-w-[45ch]">
              The SDK example maps raw keys such as W to labels such as forward. These source names
              are Rocket Science-style tokens.
            </li>
          </ul>
        </aside>
      </div>

      <footer className="mt-10 border-t border-[#4d4d4d] py-4 text-sm leading-[1.25] text-[#888]">
        Not affiliated with General Intuition or Medal.
      </footer>
    </div>
  )
}

function Results({
  audit,
  stale,
  liveToken,
  liveIdentical,
  liveInput,
  liveOutput,
  onTry,
  onAdd,
}: {
  audit: AuditResult
  stale: boolean
  liveToken: string
  liveIdentical: boolean
  liveInput: string[]
  liveOutput: string[]
  onTry: (token: string) => void
  onAdd: (source: string, target: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="gi-card p-4">
        <h2 className="text-2xl leading-[1.25] font-normal">Risk.</h2>
        <p className="mt-3 text-[40px] leading-[1.25] font-normal">{audit.riskLabel}.</p>
        <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">{audit.riskDetail}</p>
        <p className="mt-2 font-mono text-xs text-[#888]">{formatWhen(audit.ranAt)}</p>
        <div className="mt-4 max-w-full overflow-x-auto">
          <table className="gi-grid">
            <thead>
              <tr>
                <th>Check</th>
                <th>Severity</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {audit.findings.map((finding) => (
                <tr key={finding.id}>
                  <td>{finding.title}</td>
                  <td>{labelSeverity(finding.severity)}</td>
                  <td>{finding.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stale ? (
          <p className="mt-3 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
            The map or the frequency cut changed after this run. Run the audit again before trusting
            the tables. Export writes a fresh report from the table as it is now.
          </p>
        ) : null}
      </section>

      {audit.findings.map((finding) => (
        <section key={finding.id} className="gi-card p-4">
          <h3 className="text-2xl leading-[1.25] font-normal">{finding.title}.</h3>
          <p className="mt-2 font-mono text-xs text-[#888]">
            {labelSeverity(finding.severity)}. {finding.count}{" "}
            {finding.id === "collisions"
              ? finding.count === 1
                ? "target"
                : "targets"
              : finding.count === 1
                ? "token"
                : "tokens"}
            .
          </p>
          <p className="mt-3 max-w-[45ch] text-sm leading-[1.25]">{finding.why}</p>

          {finding.id === "unmapped" ? (
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid min-w-[36rem]">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Where</th>
                    <th>Events</th>
                    <th>Share</th>
                    <th>Row</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.unmapped.map((item) => (
                    <tr key={item.token}>
                      <td>
                        <button type="button" className="underline" onClick={() => onTry(item.token)}>
                          {item.token}
                        </button>
                      </td>
                      <td>
                        {[item.inActionSet ? "action set" : null, item.inLog ? "log" : null]
                          .filter(Boolean)
                          .join(" + ")}
                      </td>
                      <td>{item.inLog ? item.events : "—"}</td>
                      <td>{item.inLog ? formatShare(item.events, audit.totalEvents) : "—"}</td>
                      <td>
                        <Button type="button" variant="outline" onClick={() => onAdd(item.token, "")}>
                          Add a row
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5}>
                      Selected {liveToken}. {JSON.stringify(liveInput)} → {JSON.stringify(liveOutput)}.{" "}
                      {liveIdentical ? "Identical. Passed through unchanged." : "Replaced."}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {finding.id === "collisions" ? (
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid min-w-[28rem]">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Sources</th>
                    <th>In the log</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.collisions.map((group) => (
                    <tr key={group.target}>
                      <td>{group.target}</td>
                      <td>{group.sources.join(", ")}</td>
                      <td>{group.sourcesInLog.length > 0 ? group.sourcesInLog.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {finding.id === "orphans" ? (
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.orphans.map((row) => (
                    <tr key={row.source}>
                      <td>{row.source}</td>
                      <td>{row.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {finding.id === "rare" ? (
            <div className="mt-4 max-w-full overflow-x-auto">
              <p className="mb-2 font-mono text-xs text-[#888]">
                Under {audit.thresholdPct}% of {audit.totalEvents} events.
              </p>
              <table className="gi-grid min-w-[32rem]">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Events</th>
                    <th>Share</th>
                    <th>Mapped</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.rare.map((item) => (
                    <tr key={item.token}>
                      <td>{item.token}</td>
                      <td>{item.events}</td>
                      <td>{formatShare(item.events, audit.totalEvents)}</td>
                      <td>{item.mapped ? "yes" : "no"}</td>
                      <td>
                        {item.target ?? "—"}
                        {item.sharedTarget ? " shared" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

