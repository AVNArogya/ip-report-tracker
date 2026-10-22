# Setting up the Google Sheet (step by step)

## A. Add the code
1. Go to https://sheets.google.com → **Blank spreadsheet**. Name it, e.g. **IP Report 2026**.
2. **File → Settings → Time zone: (GMT+05:30) India Standard Time.** Save.
3. **Extensions → Apps Script.** Click **Project Settings** (gear) → *Time zone*: **(GMT+05:30) India Standard Time**.
4. Open `backend/Code-all-in-one.gs` in this repository, click **Raw**, then **Ctrl+A**, **Ctrl+C**. In the editor's `Code.gs`, press **Ctrl+A**, **Ctrl+V** and click **Save**.

## B. Build the tabs
5. In the function dropdown choose **setup** → **Run**. Approve the permissions. If Google says it hasn't verified the app, click **Advanced → Go to … (unsafe)**: it's your own script.
6. The spreadsheet now has **IP Report** and **Room Categories**. Three data tabs are hidden: `Data: patients`, `Data: out of service` and `Data: plan`, which holds the KR plan, prefilled for Oct–Dec 2026.
7. Check the room numbers in **Room Categories**, column E.
8. Reload the spreadsheet. In the new **IP Report** menu, click **Install daily refresh**. This adds a new row each night.

## C. Connect the app
9. In Apps Script: **Project Settings → Script properties → Add script property**: `APP_KEY` = a secret phrase of your choice. Click **Save script properties**.
10. **Deploy → New deployment →** type **Web app**. *Execute as*: **Me**. *Who has access*: **Anyone**. Click **Deploy** and copy the URL that ends in `/exec`.
11. In GitHub, edit `web/config.js`: set `API_URL` to that URL and `APP_KEY` to the same phrase. Commit. GitHub Pages republishes the app in about a minute.

## D. Enter the opening balance (30 Sep)
12. In the app, open **Opening balance**. For each room occupied on 30 Sep, set the number of patients (2 for a shared room), and add names if you have them. Check the counter shows **49 patients, 47 rooms occupied, 17 available**, then click **Save opening balance**.
13. The IP Report now starts at the 30 Sep row, showing 49 in house and 47 rooms occupied. Every day from 1 Oct is calculated from there.

## Check it works
1. In the app, add an **Admission**: today, room J 1, planned discharge in 3 days.
2. In the sheet's **IP Report**, today's row shows *Walk-in (PCE)* 1, *Admitted: total* 1, *Economy (of 12)* 1 and *Total rooms available* 63. **Room Categories** shows Economy occupied 1, available 11.
3. In the app's **Patients** screen, click **Discharge** with tomorrow's date. Tomorrow's row shows *Discharged: total* 1, Economy 0 and available back to 64.

## Updating the code later
Paste the new `backend/Code-all-in-one.gs` into Apps Script and save. Then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## If something goes wrong
| Problem | Fix |
|---|---|
| The app says **Invalid app key** | `APP_KEY` must be identical in Script properties and `web/config.js`. |
| The app says **APP_KEY is not set** | Do step 9. |
| `Calc is not defined` | Paste `Code-all-in-one.gs`, not `Code.gs`. |
| No **IP Report** menu | Reload the spreadsheet. |
| The report hasn't rolled over to today | Run **IP Report → Refresh now**, then **Install daily refresh**. |
| A code change doesn't reach the app | Deploy a **New version** (see above). |
