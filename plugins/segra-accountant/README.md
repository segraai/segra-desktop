# segra-accountant

A Cline plugin with tools for Canadian accountants in Segra Desktop: reading PDFs and scans, and writing Excel workbooks. This is an experiment, so the tool set is expected to change.

Layout:

- `index.ts`: default-exports the `AgentPlugin` and registers all tools in `setup`.
- `tools/ping.ts`: `accountant_ping` health-check tool.
- `tools/workbook.ts`: Excel tools (exceljs), currently a stub.
- `tools/document.ts`: PDF and OCR tools (pdfjs-dist, pdf-lib, tesseract.js), currently a stub.
- `fixtures/`: sample input files for testing.
- `scripts/`: helper scripts.
- `package.json`: declares the plugin for the Cline host. `@cline/core` is a peer dependency provided by the host.
