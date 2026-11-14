# PrintNa

Resize. Arrange. Print.

React and TypeScript provide the editor. The Windows prototype opens the
built frontend in pywebview using WebView2. Images selected for a job stay
in memory. Use the pywebview bridge for local project operations when
Save and Open are implemented.

From the project folder, set up and launch the Windows prototype:

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe backend/desktop.py
```

The prototype opens the print dialog with **Print sheet**. Match the paper
size in the dialog and choose **Actual size** or **100%**.

The editor previews the sheet and lets the operator crop images, enter exact
print sizes, duplicate a selected image, or fit multiple images on one
page. Changing the paper or orientation recomputes the layout. Store physical
measurements as integer micrometers so an inch is exactly 25,400 units.
Use the same computed placements for the preview and print output.

SQLite stores saved layouts and preferences in `data/printna.db` during
development. The Windows package will use `%LOCALAPPDATA%\PrintNa\data`
so updates to the installed app preserve shop data. Each layout
has a versioned JSON document containing paper dimensions, orientation,
spacing, margins, and image placement. Store copies of
images used in saved layouts under `data/images/` and record their relative
paths in the layout. Keep the database and image folder together for backups.

The paper selector will offer A4, Letter, Legal, Folio, photo sizes, and custom
dimensions. Display the preset dimensions so the operator can match the
stock and printer settings. Print via the operating system's print dialog
and export print-ready PDFs. For exact-size jobs, print at 100% scale.
Borderless output depends on the printer and selected media.

Run the initializer from the project folder. It can be run again after the
database has been created and uses Python's built-in SQLite support.

```powershell
python backend/database.py
```
