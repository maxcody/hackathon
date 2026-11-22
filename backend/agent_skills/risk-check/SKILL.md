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

For each problem call `report_notification` with:

- `key`: stable and unique, `<check>:<main id>:<second id>`, for example
  `receipt-qty:DN-260831-382:CMP-ART-001` or `notice:SUP-0028:shutdown-2026-11`.
  The same problem must get the same key on every run, so it updates instead of
  duplicating.
- `attr`: what differs (`quantity`, `eta`, `price`, `revision`, `bank_details`, ...)
- `erp_val` / `customer_val`: the ERP value and the paper/supplier/real-world value, as text
- `title`: one line a buyer understands, e.g. "Art book receipt booked 80,000, delivery note says 8,000"
- `severity`: `critical` (blocks or endangers launch, or fraud risk),
  `warning` (needs action today), `info` (worth knowing)
- `kind`: the check name (`receipt_mismatch`, `stock_shortage`, `shipment_delay`,
  `supplier_notice`, `master_data`, `capacity`, `policy`)
- `details`: the evidence, the impact on the launch, and the recommended next step
- `refs`: every file path you used

Do not change the status of notifications people set to `resolved` or
`in_progress`. If an earlier open problem is clearly gone (data now agrees),
call `set_notification_status` with `resolved` and a short note.

Do not send email during a risk check. If a supplier should be contacted,
say so in `details`.

## 5. Summarize

End with a short reply: number of notifications created, updated and resolved,
the critical ones in one line each, and files you could not read.
