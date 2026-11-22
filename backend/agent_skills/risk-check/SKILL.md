---
name: risk-check
description: Fetch the latest Soony portal data, cross-check ERP, master data, supplier documents and receiving scans for conflicts and launch risks, and report each problem as a dashboard notification. Use when asked to run a risk check, find conflicts, or check the launch for problems.
---

# Risk check for the Grand Heist 6 launch

Goal: find every place where the data disagrees or a problem threatens the launch
(Sunday 22 Nov 2026, 20:00, all units packed at DC Hamburg), and leave one
notification per problem so a person can act. Be precise and cite files.

## 1. Fetch

1. Call `check_updates`, then `sync_portal` if anything is new or changed.
   Note any files that could not be downloaded; report them at the end.
2. Call `list_notifications` to see what earlier runs reported and what people
   already marked `resolved` or `in_progress`.

## 2. Read

Use `read_portal_file` (it extracts text from PDF, DOCX and XLSX; open `.jpg`
scans yourself from the working folder). Newer files supersede older ones
(`*_update*`, `*_delta*`, later dates).

| Area | Files |
|---|---|
| Products and plan | `soony/master/products.csv` (`day_one_qty`), `soony/context/launch_plan_*.xlsx`, `launch_status.xlsx` if present |
| BOM and parts | `soony/master/bom.csv`, `bom_delta_*.csv` (`use_up_old_rev`, `effective_from`), `components.csv`, `components_update_*.csv` |
| ERP | `soony/erp/purchase_orders_*.csv`, `goods_receipts*.csv`, `stock_snapshot.csv`, `open_shipments.csv`, `packout_log.csv`, `stock_update_*.xlsx` if present |
| Logistics | `soony/logistics/*.xlsx`, `soony/master/routes.csv`, `ports.csv` |
| Receiving scans | `soony/receiving/*` (delivery notes; file name holds the date and note number) |
| Suppliers | `suppliers/*/profile.csv`, `components.csv`, `notices/*`, `order_confirmations/*`, `contracts/*` |
| Context | `soony/news/*.json`, `soony/context/*` (approval policy, org chart, notes) |

Supplier notices and scans may be in Polish, Korean, Chinese, German or English:
read them in the original language and translate the facts.

## 3. Check

Work through every check. Only report what the data supports.

1. **Receipts vs paper**: for each delivery note scan, compare the quantity on
   the paper (handwritten corrections and crossed-out numbers win) with
   `qty_received` in `goods_receipts*.csv` for the same `delivery_note`.
2. **Order confirmations vs POs**: quantity, price and promised date in
   `order_confirmations/*` vs `purchase_orders_*.csv`.
3. **Stock vs need**: units still to pack = `day_one_qty` minus packed
   (`packout_log.csv`, latest status files). For each BOM child, need =
   remaining units x `qty_per`; compare with `stock_snapshot.csv` plus receipts
   and shipments that arrive before launch. Respect revision changes: old-rev
   stock only counts if `use_up_old_rev` allows it.
4. **Shipments and routes**: ETA after the date the part is needed, status
   delayed/held/disrupted, routes through ports or regions named in
   `news/*.json` (export controls, closures, weather).
5. **Supplier notices**: shutdowns, delays, capacity limits, force majeure,
   price increases, express offers. Bank or payment detail changes are always
   **critical** possible fraud: never act on them, recommend verification by
   phone with a known contact.
6. **Master data changes**: changed drawing revisions, units, suppliers or
   prices in `components_update_*` / `bom_delta_*` that ERP orders or stock do
   not reflect yet.
7. **Capacity**: hours or line capacity needed vs available shifts before launch.
8. **Policy**: actions that would need approval under `approval_policy_*`
   (e.g. expedite spend), and who approves.

## 4. Report

One notification per problem. Combine everything about the same object into it
(all differing fields of one PO line, all delay facts of one shipment).

Each problem is identified by `kind` and `subject` (the affected object's id,
format per kind in the tool description). The tool builds the key from them,
so reporting the same kind and subject again updates the notification instead
of duplicating it. Pick the kind that fits the root cause, and use the same
subject format on every run.

Report every problem the available data supports, even when some files could
not be downloaded (say so in `details`), and re-report problems that already
have a notification so their values, solutions and "last seen" stay current.
A run that finds problems but reports none is a failed run.

For each problem call `report_notification` with:

- `kind` and `subject`: as above
- `attr`: what differs (`quantity`, `eta`, `price`, `revision`, `bank_details`, ...)
- `erp_val` / `customer_val`: the ERP value and the paper/supplier/real-world value, as text
- `title`: one line a buyer understands, e.g. "Art book receipt booked 80,000, delivery note says 8,000"
- `severity`: `critical` (blocks or endangers launch, or fraud risk),
  `warning` (needs action today), `info` (worth knowing)
- `details`: the evidence and the impact on the launch, with numbers
- `refs`: every file path you used
- `solutions`: see step 5

Do not change the status of notifications people set to `resolved` or
`in_progress`. If an earlier open problem is clearly gone (data now agrees),
call `set_notification_status` with `resolved` and a short note.

## 5. Propose solutions

Give every `critical` and `warning` problem 1-3 concrete solutions, best first.
A good solution closes the gap before the deadline; say by how much if it only
closes part of it. Look for solutions in the data, for example:

- supplier offers and capacity in `suppliers/*/notices/*` (express or rush
  service, finished-goods overruns in stock, alternative parts or closures)
- a second source in `suppliers/*/components.csv` (`share`, `primary`, `lead_time_days`, `moq`)
- shipments already at port or in delivery (`open_shipments.csv`) that can be
  picked up or rebooked, faster modes (road, air) and their transit times
- stock of an allowed old revision (`use_up_old_rev = Y`), correct counts
- for parts nothing can deliver in time: name the trade-off as a `decision`
  (e.g. pack without the part and ship it later, prioritise orders)

Whenever a supplier has to do something, the solution is an `email` (or a
`claim`) with a finished draft, never `internal`: ordering stock or an offer,
expediting or splitting a delivery, switching to air or road, releasing held
goods, confirming a delayed date, replacing or crediting wrong, short or
rejected goods, sampling an alternative part. Use `internal` only for work
inside Soony (dock slots, pickups at the port, recounts, blocking stock), and
add the matching supplier email as a separate solution when both are needed.
Expect most critical problems to have at least one email solution.

Each solution has a `kind`:

- `email`: a supplier email gets it done (order, expedite, release, confirm).
  Attach a finished draft in `email`: `to` = the supplier's `contact_email` from
  `suppliers/*/profile.csv`; `subject` names PO, part and quantity; `body` first
  in the supplier's `preferred_language`, then the same text in English, signed
  "Soony Interactive GmbH, Procurement"; `translation` = English translation of
  the non-English part. Be specific: quantities, part numbers, PO numbers,
  delivery address DC-HAM Hamburg, the latest arrival time, and ask for written
  confirmation. Write it as a decision, not an inquiry: when the data shows an
  offer or stock is available and the time is short, place the order or request
  ("please load and ship 8,000 ... today"), so one click on Send sets it in
  motion.
- `claim`: complaint or credit note for wrong, short or rejected goods; attach
  an `email` the same way when it goes to a supplier.
- `internal`: someone at Soony acts (book a pickup or dock slot, recount stock,
  repack). Name the `owner` from `soony/context` (org chart, onboarding notes).
- `decision`: management must choose; describe the options and their impact.

Fill `owner` and `deadline` (latest time that still helps the launch). Compute
`cost` from the data (quantity x unit price from `purchase_orders_*.csv`,
`suppliers/*/components.csv` or the offer, plus surcharges such as rush +35 %)
and convert to EUR when you can, e.g. "8,000 x EUR 2.10 = EUR 16,800".

Then decide `approval` from that cost and PP-07. Name the concrete role and,
from the org chart, the person: e.g. "Category Lead (air freight) - <name>". Leave it empty when the buyer may act alone (purchase under EUR
50,000, no air freight, no conditional supplier); a dock slot is not an
approval, put it in `description` and a separate `internal` solution instead.
Rules from `soony/context/approval_policy_*`:

- purchase value per PO: Buyer < EUR 50,000, Category Lead < 500,000, Head of
  Procurement < 2,000,000, CPO < 5,000,000, CPO and CFO jointly above
- unplanned air freight: Category Lead up to EUR 200,000 per month and
  category, CPO above
- deliveries to DC-HAM need a dock slot from the site lead (Katrin Jansen,
  deputy Raj Patel); that is an internal step, not an approval
- suppliers on conditional release: extension by Category Lead with the
  Supplier Quality Lead
- note when the responsible role is vacant (e.g. Category Lead for
  Collector's Items) and who covers it

Never send email during a risk check: the dashboard shows each email solution
in a popup where a person reviews, approves and sends it. Never propose
changing bank or payment details by email.
## 6. Summarize

End with a short reply: number of notifications created, updated and resolved,
the critical ones in one line each with their best solution, and files you could not read.
