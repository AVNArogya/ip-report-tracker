# IP Report tracker

A Google Sheet with two tabs, **IP Report** and **Room Categories**. Every count is calculated automatically from the patients entered in a small web app. Nothing in the report is typed by hand.

- **App:** `web/`, published with GitHub Pages on every push to `main`. Until `web/config.js` is filled in, it runs in **practice mode**: entries stay in your browser.
- **Google Sheet backend:** `backend/Code-all-in-one.gs` (Google Apps Script).
- **Setup:** [SETUP.md](SETUP.md), step by step.

## The two tabs

### Room Categories
| Column | |
|---|---|
| A–E | Category, short name (used in report headings), block (J / S / SW), location (In-house / Apartment / Hotel), **room numbers** (comma-separated). These are the only cells you type. |
| F | **Total rooms**: a formula that counts the room numbers. The **Total** and **In-house total** rows add them up (64 and 56 rooms with the list below). |
| G–J | Occupied, out of service, available and admitted, for the date chosen in `IP Report!C1`. Formulas that read the IP Report. |

Starting rooms: Economy J 1–J 12 (12) · Executive (J block) JF1–JF7 (7) · Executive (S block) 101–111, 121–122, 151–161 (24) · Deluxe 112–113 (2) · Classic villa 501–506 (6) · Deluxe villa 601–604 (4) · Royal villa 701 (1) · Apartment rooms 131, 132, 137–140 (6) · Hotel rooms 1–2 (2).

Edit a room list and everything follows: totals, the "(of N)" headings, available counts and the app's room list. To add a category, insert a row **above "Total"**.

### IP Report
- **Row 1:** pick a date in **C1** (blank = today).
- **Rows 2–3:** summary for that date: total rooms (from Room Categories), occupied, available, out of service, walk-ins, admitted, discharged, patients in house and occupancy.
- **Row 6 onwards:** one row per date, from **30 Sep 2026** (the fixed starting position) to today, or to the latest date entered, in the report's column order:

| Column | Calculated as (for each date) |
|---|---|
| Walk-in (PCE), Virtual (tele), Corporate, Clinic referral, Other | admissions that day, by the patient's source |
| Admitted: total | admissions that day |
| As planned | admitted that day, on their planned admission date (bookings) |
| Before plan | admitted that day, earlier than their planned admission date |
| Discharged: total | patients whose **actual** discharge date is that day |
| Stays extended today | stays extended that day (Extend in the app) |
| Patients in house (end of day) | admitted on or before the date, not discharged by it (2 in a shared room count 2) |
| Plan: patients in house (KR) | the KR plan for the date (set on the app's Report screen; Oct–Dec 2026 prefilled) |
| Economy (of 12) … Royal villa (of 1) | occupied rooms in that category at the end of the day |
| J block, S block, SW block | in-house rooms **out of service** in that block |
| In-house rooms occupied / vacant and available / occupancy | in-house rooms only; available = in-house total − occupied − out of service (formula) |
| Apartment rooms in use, Hotel rooms in use | occupied rooms there |
| Patients sharing a room | patients in a room with two patients |
| Discharges confirmed | patients in house whose planned discharge is the next day |
| Planned admissions: walk-in / virtual / corporate, clinic, other | bookings for the next day, by source |

Columns after these: walk-in visits (including people not admitted), **total rooms** (formula from Room Categories), total occupied, total out of service, **total available** (formula), then **admitted by category** and **out of service by category**.

Formula columns are shaded grey and linked to Room Categories, so the total room count is fixed by that tab.

## Starting position on 30 Sep (fixed)
Up to 30 Sep 2026 the figures are fixed: **49 patients in house, 47 of the 64 rooms occupied, 17 available**. Nothing needs entering for this; the 30 Sep row shows it, and entries start on 1 Oct.

- **From 1 Oct**, every admission entered adds to those figures and every discharge takes away from them.
- When one of the 49 patients from before 1 Oct leaves, enter **New entry → Discharge (admitted before 1 Oct)** with the discharge date. Patients in house go down by 1. Tick *the room is now empty* to also take 1 off the occupied rooms; leave it unticked if the patient was sharing and the room is still occupied. The room and name are optional.
- The 47 rooms aren't known room by room, so they count in the totals (patients in house, in-house rooms occupied and available, total occupied and available) but not in the per-category columns, which count patients admitted from 1 Oct.
- Admissions dated before 1 Oct are refused, because they are already in the 49.
- The figures are `OPENING` in `web/calc.js`.

## Day to day, in the app
| Screen | What you do |
|---|---|
| **New entry** | **Admission** (date, room, planned discharge), **Walk-in visit** (not admitted) or **Booking** (planned admission). Rooms show what is free on that date. A room can't be double-booked unless you tick *sharing a room*. |
| **Patients** | In house / bookings / walk-ins / discharged. **Admit** a walk-in or booking, **Discharge** (on the actual date), **Extend**, edit or delete. |
| **Rooms** | The room board for any date. Tap a room to admit, discharge, extend, or mark it out of service. |
| **Report** | Summary and category table for a date, the month's IP Report, the KR plan, CSV download. |

Every save writes to the sheet's hidden data tabs and rebuilds the IP Report straight away. Editing Room Categories or the data tabs in the sheet also rebuilds it, and a nightly trigger adds each new day's row.

**What a discharge does:** on the discharge date, *Discharged: total* goes up by 1, the room stops counting as occupied, and available rooms go up by 1. Earlier dates still count the patient as in house.

## Files
- `web/calc.js`: the column list and every calculation, used by the app and by Apps Script.
- `backend/Code.gs`: builds the tabs, saves entries, writes the report. `backend/Code-all-in-one.gs` = `calc.js` + `Code.gs`, generated by `npm run build`.
- `web/`: the app. `serve.js` runs it locally on http://localhost:8080.
- `tests/`: `npm test` checks the calculations and runs the backend against a mock spreadsheet.
