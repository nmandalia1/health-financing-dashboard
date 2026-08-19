"""
pipeline_gui.py — Graphical interface for the Health Financing Dashboard pipeline.
Run with: python3 pipeline_gui.py
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import threading
import subprocess
import sys
import os
import queue
import time

# ── Colours & fonts ────────────────────────────────────────────────────────────
BG          = "#1e1e2e"
PANEL       = "#2a2a3e"
ACCENT      = "#6c8ebf"
ACCENT2     = "#5a9e6f"
TEXT        = "#e0e0f0"
TEXT_DIM    = "#888899"
WARNING     = "#e0a050"
ERROR_COL   = "#c0504d"
SUCCESS     = "#5a9e6f"
BORDER      = "#3a3a5a"

FONT_HEAD   = ("Helvetica Neue", 18, "bold")
FONT_SUB    = ("Helvetica Neue", 11)
FONT_BODY   = ("Helvetica Neue", 10)
FONT_MONO   = ("Menlo", 10)
FONT_BTN    = ("Helvetica Neue", 11, "bold")
FONT_LABEL  = ("Helvetica Neue", 10, "bold")

# ── Source definitions ─────────────────────────────────────────────────────────
SOURCES = [
    {
        "key":      "world_bank",
        "label":    "World Bank",
        "detail":   "55 indicators — health financing, outcomes, macro, demographics",
        "time":     "~5–8 min",
        "auto":     True,
    },
    {
        "key":      "who_gho",
        "label":    "WHO Global Health Observatory",
        "detail":   "40 indicators — UHC, mortality, NCD, HIV/TB/malaria, workforce",
        "time":     "~8–12 min",
        "auto":     True,
    },
    {
        "key":      "imf",
        "label":    "IMF",
        "detail":   "14 indicators — GDP, govt finance, debt, inflation",
        "time":     "~2–4 min",
        "auto":     True,
    },
    {
        "key":      "global_fund",
        "label":    "Global Fund",
        "detail":   "Grant budgets & results — HIV, TB, Malaria by country",
        "time":     "~4–6 min",
        "auto":     True,
    },
    {
        "key":      "ghed",
        "label":    "WHO GHED",
        "detail":   "20 health financing indicators (requires manual download first)",
        "time":     "~1 min",
        "auto":     False,
    },
]


class PipelineGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Health Financing Dashboard — Data Pipeline")
        self.root.configure(bg=BG)
        self.root.geometry("860x760")
        self.root.minsize(760, 640)

        self.log_queue   = queue.Queue()
        self.is_running  = False
        self.source_vars = {}   # key → StringVar (status text)
        self.source_bars = {}   # key → ttk.Progressbar
        self.source_btns = {}   # key → tk.Button

        self._build_ui()
        self._check_packages()
        self._poll_log()

    # ── UI construction ────────────────────────────────────────────────────────

    def _build_ui(self):
        # Header
        header = tk.Frame(self.root, bg=BG, pady=18)
        header.pack(fill="x", padx=24)

        tk.Label(header, text="🌍  Health Financing Dashboard",
                 font=FONT_HEAD, bg=BG, fg=TEXT).pack(anchor="w")
        tk.Label(header, text="Fetch and process global health & macroeconomic data from 4 public APIs",
                 font=FONT_SUB, bg=BG, fg=TEXT_DIM).pack(anchor="w", pady=(2, 0))

        ttk.Separator(self.root).pack(fill="x", padx=24)

        # Two-column layout
        body = tk.Frame(self.root, bg=BG)
        body.pack(fill="both", expand=True, padx=24, pady=12)

        left  = tk.Frame(body, bg=BG)
        right = tk.Frame(body, bg=BG)
        left.pack(side="left", fill="both", expand=True)
        right.pack(side="right", fill="both", expand=True, padx=(16, 0))

        # ── Left: source cards ─────────────────────────────────────────────────
        tk.Label(left, text="DATA SOURCES", font=FONT_LABEL,
                 bg=BG, fg=TEXT_DIM).pack(anchor="w", pady=(4, 8))

        for src in SOURCES:
            self._build_source_card(left, src)

        # ── Left: action buttons ───────────────────────────────────────────────
        btn_row = tk.Frame(left, bg=BG, pady=14)
        btn_row.pack(fill="x")

        self.run_all_btn = tk.Button(
            btn_row, text="▶  Run All Sources",
            font=FONT_BTN, bg=ACCENT, fg="white",
            relief="flat", padx=16, pady=10,
            activebackground="#5577aa", cursor="hand2",
            command=self._run_all,
        )
        self.run_all_btn.pack(side="left", fill="x", expand=True)

        tk.Button(
            btn_row, text="📁  Open Data Folder",
            font=FONT_BTN, bg=PANEL, fg=TEXT,
            relief="flat", padx=12, pady=10,
            activebackground=BORDER, cursor="hand2",
            command=self._open_folder,
        ).pack(side="left", padx=(8, 0))

        # ── Left: overall progress ─────────────────────────────────────────────
        prog_frame = tk.Frame(left, bg=BG)
        prog_frame.pack(fill="x", pady=(0, 4))

        self.overall_label = tk.Label(prog_frame, text="Ready", font=FONT_BODY,
                                      bg=BG, fg=TEXT_DIM)
        self.overall_label.pack(anchor="w")

        style = ttk.Style()
        style.theme_use("default")
        style.configure("Overall.Horizontal.TProgressbar",
                        troughcolor=PANEL, background=ACCENT,
                        thickness=8, borderwidth=0)

        self.overall_bar = ttk.Progressbar(prog_frame, style="Overall.Horizontal.TProgressbar",
                                           mode="determinate", maximum=100)
        self.overall_bar.pack(fill="x", pady=(4, 0))

        # GHED info box
        ghed_box = tk.Frame(left, bg=PANEL, pady=10, padx=12)
        ghed_box.pack(fill="x", pady=(8, 0))

        tk.Label(ghed_box, text="ℹ  WHO GHED requires a manual download",
                 font=("Helvetica Neue", 10, "bold"), bg=PANEL, fg=WARNING).pack(anchor="w")
        tk.Label(ghed_box,
                 text="Go to https://apps.who.int/nha/database/ → Data Explorer → Download data\n"
                      "Save the file as:  data/manual_downloads/GHED_data.xlsx",
                 font=FONT_BODY, bg=PANEL, fg=TEXT_DIM, justify="left").pack(anchor="w", pady=(4, 0))

        # ── Right: log panel ───────────────────────────────────────────────────
        tk.Label(right, text="ACTIVITY LOG", font=FONT_LABEL,
                 bg=BG, fg=TEXT_DIM).pack(anchor="w", pady=(4, 8))

        log_frame = tk.Frame(right, bg=BORDER, bd=1, relief="flat")
        log_frame.pack(fill="both", expand=True)

        self.log_box = scrolledtext.ScrolledText(
            log_frame,
            font=FONT_MONO, bg="#12121f", fg="#c8d0e8",
            insertbackground=TEXT, relief="flat",
            wrap="word", padx=10, pady=10,
            state="disabled",
        )
        self.log_box.pack(fill="both", expand=True)

        # Tag colours for log
        self.log_box.tag_config("ok",      foreground=SUCCESS)
        self.log_box.tag_config("warn",    foreground=WARNING)
        self.log_box.tag_config("err",     foreground=ERROR_COL)
        self.log_box.tag_config("head",    foreground=ACCENT, font=("Menlo", 10, "bold"))
        self.log_box.tag_config("dim",     foreground=TEXT_DIM)
        self.log_box.tag_config("default", foreground="#c8d0e8")

        # Clear log button
        tk.Button(right, text="Clear log", font=FONT_BODY,
                  bg=PANEL, fg=TEXT_DIM, relief="flat", padx=8, pady=4,
                  activebackground=BORDER, cursor="hand2",
                  command=self._clear_log).pack(anchor="e", pady=(6, 0))

    def _build_source_card(self, parent, src):
        key = src["key"]

        card = tk.Frame(parent, bg=PANEL, pady=10, padx=12)
        card.pack(fill="x", pady=4)

        # Top row: label + status + run button
        top = tk.Frame(card, bg=PANEL)
        top.pack(fill="x")

        status_var = tk.StringVar(value="● Waiting")
        self.source_vars[key] = status_var

        name_label = tk.Label(top, text=src["label"], font=FONT_LABEL,
                               bg=PANEL, fg=TEXT)
        name_label.pack(side="left")

        status_label = tk.Label(top, textvariable=status_var,
                                font=FONT_BODY, bg=PANEL, fg=TEXT_DIM)
        status_label.pack(side="left", padx=(10, 0))
        self.source_vars[key + "_label"] = status_label

        time_label = tk.Label(top, text=src["time"], font=FONT_BODY,
                               bg=PANEL, fg=TEXT_DIM)
        time_label.pack(side="right")

        run_btn = tk.Button(
            top, text="Run",
            font=("Helvetica Neue", 9), bg=BORDER, fg=TEXT,
            relief="flat", padx=10, pady=3,
            activebackground=ACCENT, cursor="hand2",
            command=lambda k=key: self._run_source(k),
        )
        run_btn.pack(side="right", padx=(0, 8))
        self.source_btns[key] = run_btn

        # Detail text
        tk.Label(card, text=src["detail"], font=FONT_BODY,
                 bg=PANEL, fg=TEXT_DIM).pack(anchor="w", pady=(3, 6))

        # Progress bar
        style_name = f"{key}.Horizontal.TProgressbar"
        s = ttk.Style()
        s.configure(style_name, troughcolor=BORDER, background=ACCENT2,
                    thickness=4, borderwidth=0)

        bar = ttk.Progressbar(card, style=style_name, mode="indeterminate", length=100)
        bar.pack(fill="x")
        self.source_bars[key] = bar

    # ── Package check ──────────────────────────────────────────────────────────

    def _check_packages(self):
        self._log("Checking Python packages...\n", "dim")

        def _check():
            missing = []
            for pkg in ["wbgapi", "pandas", "requests", "pycountry", "tqdm", "pyarrow"]:
                try:
                    __import__(pkg)
                except ImportError:
                    missing.append(pkg)

            if missing:
                self._log(f"Installing missing packages: {', '.join(missing)}\n", "warn")
                self._log("This may take a minute on first run...\n", "warn")
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "install",
                     "wbgapi", "pandas", "requests", "pyarrow",
                     "openpyxl", "tqdm", "pycountry", "plotly"],
                    capture_output=True, text=True
                )
                if result.returncode == 0:
                    self._log("✓ All packages installed.\n\n", "ok")
                else:
                    self._log(f"✗ Package install failed:\n{result.stderr}\n", "err")
            else:
                self._log("✓ All packages already installed.\n\n", "ok")

        threading.Thread(target=_check, daemon=True).start()

    # ── Pipeline runners ───────────────────────────────────────────────────────

    def _run_all(self):
        if self.is_running:
            return
        auto_sources = [s["key"] for s in SOURCES if s["auto"]]
        self._run_sources(auto_sources)

    def _run_source(self, key):
        if self.is_running:
            self._log("⚠ A pipeline is already running. Please wait.\n", "warn")
            return
        self._run_sources([key])

    def _run_sources(self, keys):
        self.is_running = True
        self.run_all_btn.config(state="disabled", text="⏳  Running...")

        for s in SOURCES:
            if s["key"] in keys:
                self.source_btns[s["key"]].config(state="disabled")

        def _worker():
            total   = len(keys)
            done    = 0

            for key in keys:
                src = next(s for s in SOURCES if s["key"] == key)

                self._set_status(key, "⟳ Running...", ACCENT)
                self.source_bars[key].start(12)

                self._log(f"\n{'─'*48}\n", "dim")
                self._log(f"  Fetching: {src['label']}\n", "head")
                self._log(f"{'─'*48}\n", "dim")

                t0 = time.time()
                ok = self._run_pipeline_source(key)
                elapsed = int(time.time() - t0)
                mins, secs = elapsed // 60, elapsed % 60

                self.source_bars[key].stop()
                self.source_bars[key]["value"] = 100 if ok else 0

                if ok:
                    self._set_status(key, "✓ Complete", SUCCESS)
                    self._log(f"\n  ✓ {src['label']} done in {mins}m {secs}s\n", "ok")
                else:
                    self._set_status(key, "✗ Failed", ERROR_COL)
                    self._log(f"\n  ✗ {src['label']} failed after {mins}m {secs}s\n", "err")

                done += 1
                pct  = int((done / total) * 100)
                self.root.after(0, lambda p=pct: self._set_overall(p))

            self._log(f"\n{'═'*48}\n", "dim")
            self._log("  Pipeline complete. Data saved to data/processed/\n", "ok")
            self._log(f"{'═'*48}\n\n", "dim")

            self.root.after(0, self._on_done)

        threading.Thread(target=_worker, daemon=True).start()

    def _run_pipeline_source(self, key: str) -> bool:
        """Run a single pipeline source, streaming output to the log."""
        script = f"""
import sys, os
sys.path.insert(0, r'{os.path.dirname(os.path.abspath(__file__))}')
os.chdir(r'{os.path.dirname(os.path.abspath(__file__))}')

try:
    from pipeline.config import START_YEAR, END_YEAR
"""
        if key == "world_bank":
            script += """
    from pipeline.world_bank import fetch_world_bank
    fetch_world_bank(save=True)
"""
        elif key == "who_gho":
            script += """
    from pipeline.who_gho import fetch_who_gho
    fetch_who_gho(save=True)
"""
        elif key == "imf":
            script += """
    from pipeline.imf import fetch_imf
    fetch_imf(save=True)
"""
        elif key == "global_fund":
            script += """
    from pipeline.global_fund import fetch_global_fund
    fetch_global_fund(save=True)
"""
        elif key == "ghed":
            script += """
    from pipeline.ghed import process_ghed
    process_ghed(save=True)
"""
        script += """
    # Rebuild master
    from pipeline.utils import load_all_sources, save_data
    from pipeline.config import PROCESSED_DIR
    master = load_all_sources(PROCESSED_DIR)
    if not master.empty:
        save_data(master, 'master', PROCESSED_DIR)
    print("__PIPELINE_OK__")
except Exception as e:
    print(f"__PIPELINE_ERROR__: {e}")
    import traceback
    traceback.print_exc()
"""
        try:
            proc = subprocess.Popen(
                [sys.executable, "-c", script],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            success = False
            for line in proc.stdout:
                line = line.rstrip("\n")
                if "__PIPELINE_OK__" in line:
                    success = True
                elif "__PIPELINE_ERROR__" in line:
                    self._log(f"  {line}\n", "err")
                elif line.strip():
                    tag = "ok" if ("✓" in line or "Saved" in line) else \
                          "warn" if ("⚠" in line or "Warning" in line or "Failed" in line) else \
                          "default"
                    self._log(f"  {line}\n", tag)

            proc.wait()
            return success

        except Exception as e:
            self._log(f"  Error running {key}: {e}\n", "err")
            return False

    def _on_done(self):
        self.is_running = False
        self.run_all_btn.config(state="normal", text="▶  Run All Sources")
        self.overall_label.config(text="All done ✓")
        for s in SOURCES:
            self.source_btns[s["key"]].config(state="normal")

        if messagebox.askyesno(
            "Pipeline complete",
            "All data has been fetched and saved.\n\nWould you like to open the data folder now?"
        ):
            self._open_folder()

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _set_status(self, key, text, colour):
        def _do():
            self.source_vars[key].set(text)
            lbl = self.source_vars.get(key + "_label")
            if lbl:
                lbl.config(fg=colour)
        self.root.after(0, _do)

    def _set_overall(self, pct):
        self.overall_bar["value"] = pct
        self.overall_label.config(
            text=f"Progress: {pct}%",
            fg=SUCCESS if pct == 100 else TEXT_DIM
        )

    def _log(self, msg, tag="default"):
        self.log_queue.put((msg, tag))

    def _poll_log(self):
        try:
            while True:
                msg, tag = self.log_queue.get_nowait()
                self.log_box.config(state="normal")
                self.log_box.insert("end", msg, tag)
                self.log_box.see("end")
                self.log_box.config(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self._poll_log)

    def _clear_log(self):
        self.log_box.config(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.config(state="disabled")

    def _open_folder(self):
        folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "processed")
        os.makedirs(folder, exist_ok=True)
        if sys.platform == "darwin":
            subprocess.run(["open", folder])
        elif sys.platform == "win32":
            subprocess.run(["explorer", folder])


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    root = tk.Tk()
    app  = PipelineGUI(root)
    root.mainloop()
