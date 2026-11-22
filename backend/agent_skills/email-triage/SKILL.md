---
name: email-triage
description: Analyze one received email (usually a supplier reply) for the Grand Heist 6 launch, record the analysis for the inbox, and update the related notifications. Use when given a received email to analyze.
---

# Triage a received email

You get one received email (Message-ID, sender, subject, body) and, if it is a
reply, the email we sent. Goal: a buyer understands it in ten seconds, and the
dashboard reflects what it changes for the launch (Sunday 22 Nov 2026, 20:00,
DC-HAM Hamburg).

## 1. Understand

- Detect the language; if it is not English, translate the whole email.
- Who is the sender? Match the address against `suppliers/*/profile.csv`
  (`contact_email`) to find the supplier id and name.
- What does the sender commit to or state as fact: quantities, part numbers,
  PO numbers, dates and times (truck departure, ETA), prices and surcharges?
  Note anything conditional ("if you confirm by 10:00").
- What is missing or risky compared with what we asked for and what the launch
  needs (arrival after the pack-out cutoff, fewer units, price above the
  offer, new conditions, requests to change bank details: that is always a
  critical fraud risk, never act on it).

## 2. Connect to notifications

Call `list_notifications` and find the notifications this email is about
(same supplier, part, PO or shipment). Then:

- Re-report each related notification with `report_notification` (same
  `kind` and `subject` as the existing key) so its `details` include what the
  email changes, e.g. "Karton confirmed 8,000 books, truck leaves 14:00, ETA
  23:00", and adjust `severity` if the risk is now lower or higher.
- Only if the email clearly solves the problem in time, call
  `set_notification_status` with `resolved` and a short note citing the email.
  If it solves it only partly, leave it open and say what is still missing.
- If a reply is needed (confirm, push back, ask for a written commitment),
  add it as an `email` solution with a finished draft on that notification
  (same language rules as the risk-check skill). Never send email yourself.

### When a supplier cannot (fully) deliver

Classify the answer as `outcome`: `confirmed` (everything we asked), `partial`
(only part, or later than needed), `declined` (cannot), `question` (asks us
something) or `other`. For each related notification call
`set_supplier_state` with the supplier, the state (`confirmed`, `partial`,
`declined`) and what it can deliver, e.g. "4,000 by 18:00".

On `declined` or `partial`, draft plan B right away (a person still clicks Send):

1. Work out the quantity still missing.
2. Call `sourcing_options` for the part and take the best supplier that has
   not declined (see `suppliers:` in `list_notifications`).
3. Re-report the notification with a new `email` solution to that supplier
   (`stage: "now"`, `supplier_id` set) for the missing quantity, with the
   same draft rules as the risk check (its language, deadline, DC-HAM
   address). Conditional or same-category suppliers need `approval` (PP-07).
4. Put the step in `details`, e.g. "Hwaseong declined 4,000; asking Boise Semi."

If no supplier is left, add a `decision` solution instead (pack without the
part and ship it later, or prioritise orders).

If no notification fits and the email reveals a new problem, report a new one.

## 3. Record

Call `record_email_analysis` once with the Message-ID exactly as given, a short
English `summary`, `language`, `translation` (if not English), `commitments`,
`risks`, one concrete `next_step`, the `notification_keys` you linked, the
`outcome` and the sender's `supplier_id`.

Reply with one line: what the email means for the launch.
