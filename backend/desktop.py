"""Open the built PrintNa prototype in a Windows desktop window."""

from pathlib import Path
import sys


def main() -> None:
    root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
    index = root / "frontend" / "dist" / "index.html"
    if not index.is_file():
        raise SystemExit("Build the frontend first with npm run build in the frontend folder.")

    import webview

    window = webview.create_window("PrintNa", str(index), width=1200, height=850, min_size=(760, 600))

    def open_printer_settings() -> None:
        from System import Action
        from Microsoft.Web.WebView2.Core import CoreWebView2PrintDialogKind

        form = window.native

        def show_dialog() -> None:
            form.webview.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.System)

        form.Invoke(Action(show_dialog))

    window.expose(open_printer_settings)
    webview.start(gui="edgechromium", http_server=True)


if __name__ == "__main__":
    main()
