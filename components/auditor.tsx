"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { runAudit } from "@/lib/audit"
import { formatShare, formatWhen } from "@/lib/format"
import { loadImport, textProvided } from "@/lib/load"
import { reportJson, reportMarkdown } from "@/lib/report"
import { DEFAULT_RARE_THRESHOLD_PCT } from "@/lib/sample"
import type { AuditResult, ParseIssue, Severity, Workspace } from "@/lib/types"

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
  if (severity === "unavailable") return "Missing"
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}

function snapshot(mapText: string, logText: string, threshold: number): string {
  return JSON.stringify({ mapText, logText, threshold })
}

async function readChosenFile(file: File): Promise<string> {
  return file.text()
}

export function Auditor() {
  const [mapText, setMapText] = useState("")
  const [logText, setLogText] = useState("")
  const [mapLabel, setMapLabel] = useState("pasted ActionMap")
  const [logLabel, setLogLabel] = useState("pasted log")
  const [threshold, setThreshold] = useState(DEFAULT_RARE_THRESHOLD_PCT)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [auditedSnapshot, setAuditedSnapshot] = useState<string | null>(null)
  const [explicitSample, setExplicitSample] = useState(false)
  const [formNote, setFormNote] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)

  const stale = audit !== null && auditedSnapshot !== snapshot(mapText, logText, threshold)
  const counts = useMemo(() => audit?.counts ?? [], [audit])

  function commit(nextMap: string, nextLog: string, nextMapLabel: string, nextLogLabel: string, sampleRequested: boolean) {
    if (!textProvided(nextMap) && !textProvided(nextLog)) {
      setAudit(null)
      setWorkspace(null)
      setIssues([])
      setAuditedSnapshot(null)
      setFormNote("Nothing is audited until a file is imported.")
      return null
    }
    const loaded = loadImport({
      mapText: nextMap,
      logText: nextLog,
      mapLabel: nextMapLabel,
      logLabel: nextLogLabel,
      sampleRequested,
    })
    const nextAudit = runAudit(loaded.workspace, threshold)
    setWorkspace(loaded.workspace)
    setIssues(loaded.issues)
    setAudit(nextAudit)
    setAuditedSnapshot(snapshot(nextMap, nextLog, threshold))
    setFormNote(null)
    return { workspace: loaded.workspace, audit: nextAudit, issues: loaded.issues }
  }

  function onAudit() {
    commit(mapText, logText, mapLabel, logLabel, explicitSample)
  }

  async function onLoadSample() {
    setFormNote(null)
    try {
      const [mapResponse, logResponse] = await Promise.all([
        fetch("/samples/action-map.json"),
        fetch("/samples/session-log.csv"),
      ])
      if (!mapResponse.ok || !logResponse.ok) {
        setFormNote("The sample files could not be read from this app.")
        return
      }
      const nextMap = await mapResponse.text()
      const nextLog = await logResponse.text()
      const nextMapLabel = "sample ActionMap"
      const nextLogLabel = "sample log"
      setMapText(nextMap)
      setLogText(nextLog)
      setMapLabel(nextMapLabel)
      setLogLabel(nextLogLabel)
      setExplicitSample(true)
      commit(nextMap, nextLog, nextMapLabel, nextLogLabel, true)
    } catch {
      setFormNote("The sample files could not be read from this app.")
    }
  }

  function onClear() {
    setMapText("")
    setLogText("")
    setMapLabel("pasted ActionMap")
    setLogLabel("pasted log")
    setAudit(null)
    setWorkspace(null)
    setIssues([])
    setAuditedSnapshot(null)
    setExplicitSample(false)
    setFormNote(null)
    setThreshold(DEFAULT_RARE_THRESHOLD_PCT)
    setFormKey((value) => value + 1)
  }

  function onExport(format: "md" | "json") {
    const loaded = commit(mapText, logText, mapLabel, logLabel, explicitSample)
    if (!loaded) return
    const stamp = loaded.audit.ranAt.slice(0, 19).replace(/[:T]/g, "")
    if (format === "md") {
      download(`mapcheck-audit-${stamp}.md`, reportMarkdown(loaded.workspace, loaded.audit, loaded.issues), "text/markdown")
    } else {
      download(
        `mapcheck-audit-${stamp}.json`,
        reportJson(loaded.workspace, loaded.audit, loaded.issues),
        "application/json",
      )
    }
  }

  const sampleBanner = explicitSample
    ? "Labelled synthetic sample. Not a real model or session."
    : workspace?.sources.sample
      ? "This ActionMap file is marked as a sample."
      : null

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
        {!audit ? (
          <p className="mt-4 max-w-[45ch] text-base leading-[1.25]">
            Nothing is audited until a file is imported.
          </p>
        ) : null}
        {audit?.demo ? (
          <table className="gi-grid mt-6 max-w-xl">
            <tbody>
              <tr>
                <th scope="row">In</th>
                <td>{JSON.stringify(audit.demo.input)}</td>
              </tr>
              <tr>
                <th scope="row">Out</th>
                <td>{JSON.stringify(audit.demo.output)}</td>
              </tr>
              <tr>
                <th scope="row">Result</th>
                <td>
                  {audit.demo.identical
                    ? "Identical. Passed through unchanged."
                    : "Replaced. This token has a mapping row."}
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}
        {audit && !audit.demo ? (
          <p className="mt-4 max-w-[45ch] text-base leading-[1.25]">
            {audit.findings.find((finding) => finding.id === "unmapped")?.why}
          </p>
        ) : null}
        {sampleBanner ? <p className="mt-4 max-w-[45ch] text-sm leading-[1.25]">{sampleBanner}</p> : null}
        {audit ? (
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
            <button type="button" className="text-sm leading-[1.25] underline" onClick={() => onExport("json")}>
              Download JSON
            </button>
          </div>
        ) : null}
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="gi-card p-4">
            <h2 className="text-2xl leading-[1.25] font-normal">ActionMap.</h2>
            <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              Paste or upload the dict ActionMap takes: token to action. A wrapper may add mapping and an optional action_set.
            </p>
            <p className="mt-2 font-mono text-xs leading-[1.25] text-[#888]">{`{"W": "forward"}`}</p>
            <textarea
              value={mapText}
              spellCheck={false}
              aria-label="ActionMap JSON"
              className="mt-4 h-40 w-full resize-y rounded-none border border-[#4d4d4d] bg-black p-2 font-mono text-sm leading-[1.25] text-white outline-none focus-visible:border-white"
              onChange={(event) => {
                setMapText(event.target.value)
                setMapLabel("pasted ActionMap")
                setExplicitSample(false)
              }}
            />
            <input
              key={`map-${formKey}`}
              type="file"
              accept=".json,application/json"
              aria-label="Upload ActionMap JSON"
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-none file:border file:border-white file:bg-black file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setMapText(await readChosenFile(file))
                setMapLabel(file.name)
                setExplicitSample(false)
              }}
            />
          </section>

          <section className="gi-card p-4">
            <h2 className="text-2xl leading-[1.25] font-normal">Session log.</h2>
            <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              Paste or upload CSV or JSON of action tokens. Quoted CSV fields can span lines. A missing half is not invented.
            </p>
            <p className="mt-2 font-mono text-xs leading-[1.25] text-[#888]">token,count,t_ms</p>
            <textarea
              value={logText}
              spellCheck={false}
              aria-label="Session log"
              className="mt-4 h-40 w-full resize-y rounded-none border border-[#4d4d4d] bg-black p-2 font-mono text-sm leading-[1.25] text-white outline-none focus-visible:border-white"
              onChange={(event) => {
                setLogText(event.target.value)
                setLogLabel("pasted log")
                setExplicitSample(false)
              }}
            />
            <input
              key={`log-${formKey}`}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              aria-label="Upload session log"
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-none file:border file:border-white file:bg-black file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setLogText(await readChosenFile(file))
                setLogLabel(file.name)
                setExplicitSample(false)
              }}
            />
          </section>

          <section className="flex flex-col gap-4">
            <label className="block max-w-[45ch]">
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
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={onAudit}>
                Audit imported files
              </Button>
              <Button type="button" variant="outline" onClick={onLoadSample}>
                Load sample
              </Button>
              <Button type="button" variant="outline" onClick={onClear}>
                Clear
              </Button>
            </div>
            <p className="max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              The sample is synthetic and stays off until you load it.
            </p>
            <p className="flex flex-wrap gap-4 text-sm leading-[1.25]">
              <a className="underline" href="/samples/action-map.json" download>
                Download sample ActionMap
              </a>
              <a className="underline" href="/samples/session-log.csv" download>
                Download sample log
              </a>
            </p>
            {formNote ? <p className="max-w-[45ch] text-sm leading-[1.25]">{formNote}</p> : null}
            {stale ? (
              <p className="max-w-[45ch] text-sm leading-[1.25] text-[#888]">
                The import changed after this run. Audit again before trusting the tables. Export writes a fresh report from the text as it is now.
              </p>
            ) : null}
          </section>

          {issues.length > 0 ? <IssueTable issues={issues} /> : null}
          {audit && workspace ? (
            <Results audit={audit} workspace={workspace} counts={counts} />
          ) : (
            <p className="max-w-[45ch] text-sm leading-[1.25] text-[#888]">
              No audit yet. Import an ActionMap, a log, or both.
            </p>
          )}
        </div>

        <aside className="gi-card p-4 lg:sticky lg:top-4">
          <h2 className="text-2xl leading-[1.25] font-normal">Honesty.</h2>
          <div className="mt-3 space-y-3 text-sm leading-[1.25]">
            <p className="max-w-[45ch]">Files stay in this browser. Nothing is sent to an API.</p>
            <p className="max-w-[45ch]">
              Structural risk only. This cannot judge whether a mapping is semantically correct.
            </p>
            <p className="max-w-[45ch]">
              Unmapped pass-through is silent-by-default behaviour in general-intuition-sdk 0.24.0. It is not claimed as a bug.
            </p>
          </div>
          <h2 className="mt-6 text-2xl leading-[1.25] font-normal">Limits.</h2>
          <ul className="mt-3 space-y-3 text-sm leading-[1.25] text-[#888]">
            <li className="max-w-[45ch]">A map alone cannot show pass-through. A log alone cannot show collisions.</li>
            <li className="max-w-[45ch]">
              Model.action_set is a list of dicts in v0.24.0. The package does not document the dict fields. This tool audits token strings.
            </li>
            <li className="max-w-[45ch]">
              No public evidence found of a partner-facing tool that audits this map before a game or robot build.
            </li>
            <li className="max-w-[45ch]">
              The SDK example maps raw keys such as W to labels such as forward.
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

function IssueTable({ issues }: { issues: ParseIssue[] }) {
  return (
    <section className="gi-card p-4">
      <h2 className="text-2xl leading-[1.25] font-normal">Parse errors.</h2>
      <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">
        These rows stay listed. They are not used as mapping rows or events.
      </p>
      <div className="mt-4 max-w-full overflow-x-auto">
        <table className="gi-grid min-w-[36rem]">
          <thead>
            <tr>
              <th>Source</th>
              <th>Line</th>
              <th>Problem</th>
              <th>Raw</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((item, index) => (
              <tr key={`${item.source}-${item.line ?? "x"}-${index}`}>
                <td>{item.source}</td>
                <td>{item.line ?? "—"}</td>
                <td>{item.message}</td>
                <td>{item.raw || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Results({
  audit,
  workspace,
  counts,
}: {
  audit: AuditResult
  workspace: Workspace
  counts: AuditResult["counts"]
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="gi-card p-4">
        <h2 className="text-2xl leading-[1.25] font-normal">Risk.</h2>
        <p className="mt-3 text-[40px] leading-[1.25] font-normal">{audit.riskLabel}.</p>
        <p className="mt-2 max-w-[45ch] text-sm leading-[1.25] text-[#888]">{audit.riskDetail}</p>
        <p className="mt-2 font-mono text-xs text-[#888]">
          {formatWhen(audit.ranAt)}
          {workspace.modelId ? ` · ${workspace.modelId}` : ""}
        </p>
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
                  <td>{finding.severity === "unavailable" ? "—" : finding.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {workspace.sources.log === "ready" ? (
        <section className="gi-card p-4">
          <h2 className="text-2xl leading-[1.25] font-normal">Counts.</h2>
          <p className="mt-2 max-w-[45ch] font-mono text-xs text-[#888]">
            {audit.totalEvents} events.
            {audit.totalEvents === 0 ? " The log parsed and has no counted rows." : ""}
          </p>
          <div className="mt-4 max-w-full overflow-x-auto">
            <table className="gi-grid min-w-[28rem]">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Events</th>
                  <th>Share</th>
                  {workspace.sources.map === "ready" ? <th>Target</th> : null}
                </tr>
              </thead>
              <tbody>
                {counts.map((row) => (
                  <tr key={row.token}>
                    <td>{row.token}</td>
                    <td>{row.events}</td>
                    <td>{formatShare(row.events, audit.totalEvents)}</td>
                    {workspace.sources.map === "ready" ? <td>{row.target ?? "pass-through"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {audit.findings.map((finding) => (
        <section key={finding.id} className="gi-card p-4">
          <h3 className="text-2xl leading-[1.25] font-normal">{finding.title}.</h3>
          <p className="mt-2 font-mono text-xs text-[#888]">
            {labelSeverity(finding.severity)}
            {finding.severity === "unavailable"
              ? "."
              : `. ${finding.count} ${finding.count === 1 ? "item" : "items"}.`}
          </p>
          <p className="mt-3 max-w-[45ch] text-sm leading-[1.25]">{finding.why}</p>
          {finding.id === "unmapped" && finding.severity !== "unavailable" && audit.unmapped.length > 0 ? (
            <div className="mt-4 max-w-full overflow-x-auto">
              <table className="gi-grid min-w-[32rem]">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Where</th>
                    <th>Events</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.unmapped.map((item) => (
                    <tr key={item.token}>
                      <td>{item.token}</td>
                      <td>
                        {[item.inActionSet ? "action set" : null, item.inLog ? "log" : null].filter(Boolean).join(" + ")}
                      </td>
                      <td>{item.inLog ? item.events : "—"}</td>
                      <td>{item.inLog ? formatShare(item.events, audit.totalEvents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {finding.id === "collisions" && finding.severity !== "unavailable" && audit.collisions.length > 0 ? (
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
          {finding.id === "orphans" && finding.severity !== "unavailable" && audit.orphans.length > 0 ? (
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
          {finding.id === "rare" && finding.severity !== "unavailable" && audit.rare.length > 0 ? (
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

      {workspace.sources.map === "ready" ? (
        <section className="gi-card p-4">
          <h2 className="text-2xl leading-[1.25] font-normal">Mapping rows.</h2>
          <p className="mt-2 font-mono text-xs text-[#888]">{workspace.mapping.length} rows used.</p>
          <div className="mt-4 max-w-full overflow-x-auto">
            <table className="gi-grid min-w-[24rem]">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {workspace.mapping.map((row) => (
                  <tr key={row.id}>
                    <td>{row.source}</td>
                    <td>{row.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
