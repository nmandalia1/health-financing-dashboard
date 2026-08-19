# Health Financing Dashboard

A data pipeline and dashboard for health financing analysis using World Bank data.

## Stack
- **Language**: Python 3.x
- **Data**: pandas, pyarrow, wbgapi (World Bank API)
- **Notebooks**: Jupyter / ipywidgets
- **Visualization**: Plotly
- **Testing**: Playwright (E2E)
- **Package Manager**: pip

## Commands
- `pip install -r requirements.txt` - Install dependencies
- `python run_pipeline.py` - Run the full data pipeline
- `python pipeline_gui.py` - Launch the GUI interface
- `jupyter notebook Health_Dashboard_Pipeline.ipynb` - Open the notebook
- `bash START_HERE_Mac.command` - Mac quickstart

## Project Structure
```
pipeline/          - Core pipeline modules
data/              - Raw and processed data files
logs/              - Pipeline run logs
pipeline_gui.py    - GUI entry point
run_pipeline.py    - CLI entry point
requirements.txt   - Python dependencies
Health_Dashboard_Pipeline.ipynb - Main analysis notebook
```

## Conventions
- Conventional commits: `type(scope): message`
- Data files go in `data/`, never committed if large
- Log output goes in `logs/`
- World Bank data fetched via `wbgapi`

## Active Skills
- @~/.claude/skills/python-best-practices/SKILL.md
- @~/.claude/skills/data-engineering/SKILL.md
- @~/.claude/skills/testing-strategies/SKILL.md
- @~/.claude/skills/performance-optimization/SKILL.md
- @~/.claude/skills/security-hardening/SKILL.md

## Key Notes
- Primary data source: World Bank API (wbgapi)
- Output formats: Excel (openpyxl), Parquet (pyarrow), CSV
- Country metadata via `pycountry`
