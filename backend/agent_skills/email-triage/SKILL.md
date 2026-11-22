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

If no notification fits and the email reveals a new problem, report a new one.

## 3. Record

Call `record_email_analysis` once with the Message-ID exactly as given, a short
English `summary`, `language`, `translation` (if not English), `commitments`,
`risks`, one concrete `next_step`, and the `notification_keys` you linked.

Reply with one line: what the email means for the launch.
