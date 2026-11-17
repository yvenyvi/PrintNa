"""Open the built PrintNa prototype in a Windows desktop window."""

from pathlib import Path
from itertools import groupby
import sys
from threading import Lock


def main() -> None:
    root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
    index = root / "frontend" / "dist" / "index.html"
    if not index.is_file():
        raise SystemExit("Build the frontend first with npm run build in the frontend folder.")

    import webview

    window = webview.create_window("PrintNa", str(index), width=1200, height=850, min_size=(760, 600))
    print_lock = Lock()
    accepted_sizes: dict[str, tuple[float, float]] = {}

    def open_printer_settings() -> None:
        from System import Action
        from Microsoft.Web.WebView2.Core import CoreWebView2PrintDialogKind

        form = window.native

        def show_dialog() -> None:
            form.webview.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.System)

        form.Invoke(Action(show_dialog))

    def list_printers() -> list[str]:
        from System.Drawing.Printing import PrinterSettings

        settings = PrinterSettings()
        return sorted(PrinterSettings.InstalledPrinters, key=lambda name: (name != settings.PrinterName, name))

    def edit_printing_preferences(printer: str) -> dict | None:
        from System import Action
        from System.Drawing.Printing import PrinterSettings
        import win32con
        import win32print

        if printer not in list_printers():
            raise ValueError("Printer unavailable")
        form = window.native
        result = []

        def show_preferences() -> None:
            handle = win32print.OpenPrinter(printer)
            try:
                mode = win32print.GetPrinter(handle, 2)["pDevMode"]
                flags = win32con.DM_IN_PROMPT | win32con.DM_IN_BUFFER | win32con.DM_OUT_BUFFER
                if win32print.DocumentProperties(form.Handle.ToInt64(), handle, printer, mode, mode, flags) != 1:
                    return
                driver = PrinterSettings()
                driver.PrinterName = printer
                # Standard paper codes can coexist with stale custom dimensions.
                paper = next((size for size in driver.PaperSizes
                              if size.RawKind == mode.PaperSize and 0 < size.RawKind < 256), None)
                if paper is not None:
                    dimensions = sorted((paper.Width * 0.254, paper.Height * 0.254))
                    dimensions = [round(value, 1) for value in dimensions]
                elif mode.PaperWidth > 0 and mode.PaperLength > 0:
                    dimensions = sorted((mode.PaperWidth / 10, mode.PaperLength / 10))
                else:
                    raise ValueError("The driver did not return paper dimensions")
                accepted_sizes[printer] = tuple(dimensions)
                result.append(dict(width=dimensions[0], height=dimensions[1],
                                   landscape=mode.Orientation == 2, grayscale=mode.Color == 1))
            finally:
                win32print.ClosePrinter(handle)

        form.Invoke(Action(show_preferences))
        return result[0] if result else None

    def print_sheets(printer: str, sheets: list[dict]) -> str:
        import win32print
        from System import Action
        from System.Drawing.Printing import PrinterSettings
        from Microsoft.Web.WebView2.Core import (
            CoreWebView2PrintColorMode, CoreWebView2PrintMediaSize,
            CoreWebView2PrintOrientation, CoreWebView2PrintStatus,
        )

        if not print_lock.acquire(blocking=False):
            return "A print job is already being sent."
        try:
            driver = PrinterSettings()
            driver.PrinterName = printer
            if printer not in list_printers() or not driver.IsValid:
                return "The selected printer is unavailable."
            supported = [sorted((size.Width * 0.254, size.Height * 0.254)) for size in driver.PaperSizes]
            default_paper = driver.DefaultPageSettings.PaperSize
            supported.append(sorted((default_paper.Width * 0.254, default_paper.Height * 0.254)))
            handle = win32print.OpenPrinter(printer)
            try:
                mode = win32print.GetPrinter(handle, 2)["pDevMode"]
                if mode and mode.PaperSize >= 256 and mode.PaperWidth > 0 and mode.PaperLength > 0:
                    supported.append(sorted((mode.PaperWidth / 10, mode.PaperLength / 10)))
            finally:
                win32print.ClosePrinter(handle)
            if printer in accepted_sizes:
                supported.append(accepted_sizes[printer])
            settings = []
            for sheet in sheets:
                width, height = float(sheet["width"]), float(sheet["height"])
                if not any(abs(width - w) <= 0.5 and abs(height - h) <= 0.5 for w, h in supported):
                    return f"{printer} does not list {width:g} × {height:g} mm paper. Open Printing preferences to choose or define the correct size."
                if not sheet["grayscale"] and not driver.SupportsColor:
                    return f"{printer} only supports black and white. Set the sheets to black and white or choose a color printer."
                settings.append((width, height, bool(sheet["landscape"]), bool(sheet["grayscale"])))

            form = window.native
            next_page = 1
            for (width, height, landscape, grayscale), run in groupby(settings):
                last_page = next_page + sum(1 for _ in run) - 1
                tasks = []

                def submit() -> None:
                    core = form.webview.CoreWebView2
                    options = core.Environment.CreatePrintSettings()
                    options.PrinterName = printer
                    options.MediaSize = CoreWebView2PrintMediaSize.Custom
                    options.PageWidth = width / 25.4
                    options.PageHeight = height / 25.4
                    options.Orientation = CoreWebView2PrintOrientation.Landscape if landscape else CoreWebView2PrintOrientation.Portrait
                    options.ColorMode = CoreWebView2PrintColorMode.Grayscale if grayscale else CoreWebView2PrintColorMode.Color
                    options.ScaleFactor = 1.0
                    options.MarginTop = options.MarginBottom = options.MarginLeft = options.MarginRight = 0.0
                    options.ShouldPrintHeaderAndFooter = False
                    options.ShouldPrintBackgrounds = True
                    options.PagesPerSide = 1
                    options.PageRanges = f"{next_page}-{last_page}"
                    tasks.append(core.PrintAsync(options))

                try:
                    form.Invoke(Action(submit))
                    result = tasks[0].GetAwaiter().GetResult()
                    if result != CoreWebView2PrintStatus.Succeeded:
                        raise RuntimeError(str(result))
                except Exception:
                    sent = f" Sheets 1–{next_page - 1} were already sent." if next_page > 1 else ""
                    return f"Windows could not print sheets {next_page}–{last_page} on {printer}.{sent}"
                next_page = last_page + 1
            return ""
        finally:
            print_lock.release()

    window.expose(open_printer_settings, edit_printing_preferences, list_printers, print_sheets)
    webview.start(gui="edgechromium", http_server=True)


if __name__ == "__main__":
    main()
