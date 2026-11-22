import { useEffect, useState } from "react";
import { getReadiness } from "./api";
import type { Notification, PartCoverage, Readiness } from "./types";

const number = new Intl.NumberFormat("en-US");
const REFRESH_MS = 60 * 1000;

/** Format a quantity with a leading sign. */
function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${number.format(Math.abs(value))}`;
}

/** Short day label, e.g. "Sat 21 Nov", for an ISO date or datetime. */
function day(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Drop the product line prefix: "Grand Heist 6 – Standard Edition (game card)" → "Standard Edition". */
function editionName(name: string): string {
  return name.split(/\s[–-]\s/).pop()?.replace(/\s*\(.*\)$/, "") ?? name;
}

/** Open notifications about this part or one of its shipments. */
function issuesFor(part: PartCoverage, notifications: Notification[]): Notification[] {
  const ids = [part.component_id, ...part.inbound.map((s) => s.shipment_id)].map((id) => id.toUpperCase());
  return notifications.filter((n) => n.data.status !== "resolved" && ids.some((id) => (n.data.key ?? "").toUpperCase().includes(id)));
}

/** Launch readiness: packed per edition and whether part stock covers the rest (ERP view). */
export function ReadinessPanel({ notifications }: { notifications: Notification[] }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => getReadiness().then((value) => { setData(value); setError(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load readiness."));
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (error) return <section className="ready"><p className="ready-error">Launch readiness unavailable: {error}</p></section>;
  if (!data) return <section className="ready"><p className="ready-muted">Loading launch readiness…</p></section>;

  return (
    <section className="ready" aria-labelledby="ready-heading">
      <div className="ready-head">
        <h2 id="ready-heading">Launch readiness</h2>
        <span>ERP figures · stock as of {day(data.snapshot_date)}</span>
      </div>

      <div className="ready-editions">
        {data.editions.map((edition) => {
          const pct = edition.day_one ? Math.min(100, (edition.packed / edition.day_one) * 100) : 0;
          return (
            <article key={edition.product_id} className="ready-edition">
              <span>{editionName(edition.name)}</span>
              <strong>{number.format(edition.remaining)} <small>still to pack</small></strong>
              <div className="ready-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
              <small>{number.format(edition.packed)} of {number.format(edition.day_one)} packed ({pct.toFixed(0)}%) · last pack-out {day(edition.last_packed)}</small>
            </article>
          );
        })}
      </div>

      <div className="ready-table-wrap">
        <table className="ready-parts">
          <thead>
            <tr><th>Part</th><th className="num">Still needed</th><th className="num">Available</th><th className="num">Balance</th><th>Arriving before launch</th><th>Open issues</th></tr>
          </thead>
          <tbody>
            {data.parts.map((part) => {
              const issues = issuesFor(part, notifications);
              const disputed = part.balance >= 0 && issues.length > 0;
              const tone = part.fitted_into ? "muted" : part.balance < 0 ? "short" : disputed ? "disputed" : "ok";
              return (
                <tr key={part.component_id} className={`ready-row ready-${tone}`}>
                  <td>
                    <strong>{part.description}</strong>
                    <small>{part.component_id}{part.critical ? " · critical" : ""}{part.suppliers.length ? ` · ${part.suppliers.join(", ")}` : ""}</small>
                  </td>
                  {part.fitted_into ? (
                    <td colSpan={4} className="ready-fitted">Fitted into {part.fitted_into} by the supplier, not stocked separately</td>
                  ) : (
                    <>
                      <td className="num">{number.format(part.need)}</td>
                      <td className="num" title={`Stock ${number.format(part.stock)} + received since snapshot ${number.format(part.received_since)}`}>{number.format(part.available)}</td>
                      <td className="num ready-balance">{signed(part.balance)}{disputed && <small>per ERP · disputed</small>}</td>
                      <td>{part.inbound.length ? part.inbound.map((s) => <span key={s.shipment_id} className={`ready-ship ready-ship-${s.status}`} title={`${s.shipment_id} · ${s.supplier_id}`}>{s.mode} · {day(s.eta)} · {s.status.replace(/_/g, " ")}</span>) : <span className="ready-muted">none</span>}</td>
                    </>
                  )}
                  <td>{issues.length ? <a className="ready-issue" href={`#n-${issues[0].id}`} title={issues.map((n) => n.data.title).join("\n")}>{issues[0].data.title}{issues.length > 1 && <em> +{issues.length - 1} more</em>}</a> : <span className="ready-muted">–</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ready-note">Balance = ERP stock + receipts since the snapshot − what is still to pack. Shipment quantities are not in the ERP, so arrivals are listed but not counted. The ERP can be wrong: check the linked issues.</p>
    </section>
  );
}
