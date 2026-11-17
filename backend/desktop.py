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

    def print_sheets(printer: str, sheets: list[dict]) -> str:
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
            settings = []
            for sheet in sheets:
                width, height = float(sheet["width"]), float(sheet["height"])
                if not any(abs(width - w) <= 0.5 and abs(height - h) <= 0.5 for w, h in supported):
                    return f"{printer} does not list {width:g} × {height:g} mm paper. Choose a supported size or add it in the printer driver."
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

    window.expose(open_printer_settings, list_printers, print_sheets)
    webview.start(gui="edgechromium", http_server=True)


if __name__ == "__main__":
    main()
