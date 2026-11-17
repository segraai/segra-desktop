# segra-documents

Document tools that Segra Desktop has built in:

- `read_document`: reads the text of a PDF, or of a scanned or photographed document (.png, .jpg, .jpeg). Pages without a text layer are read with offline OCR (tesseract.js, bundled English data, network blocked). Each page says whether its text came from the PDF or from OCR, with an OCR confidence score. The host (Segra Desktop) may pass an optional `remoteOcr` hook to `createSegraDocumentTools({ remoteOcr })`; when it returns text for a page image the page is marked `segra-ocr` (Segra's private TEE OCR model, for enabled accounts; images go only to the attested enclave). If the hook is absent, throws or returns nothing, offline OCR is used as above.
- `write_workbook`: writes an Excel (.xlsx) workbook. The tool description tells the model to put every total and calculation in as a formula, and to note where each figure came from.

## How Segra Desktop uses it

The app does not install this folder as a plugin. Its build (`apps/examples/desktop-app/scripts/build-desktop-runtime.ts`) copies it into the app's resources with a production install of its dependencies, and the desktop backend (`sidecar/document-tools.ts`) imports `tools/index.ts` at runtime and adds the tools to every local session. See "Built-in document tools" in the desktop app's README.

## Using it from the CLI

`index.ts` is a plugin entry, so the CLI can load the same tools:

```sh
cd plugins/segra-documents && bun install
segra plugin install /path/to/segra-desktop/plugins/segra-documents
```

Plugin install runs `npm install`, so it needs npm on `PATH`.

## Layout

- `tools/index.ts`: `SEGRA_DOCUMENT_TOOLS`, the tool definitions. Free of `@cline/core` imports so the app can wrap them with its own copy of core.
- `tools/document.ts`, `tools/document-core.ts`, `tools/document-ocr-worker.cjs`: `read_document`.
- `tools/workbook.ts`, `tools/workbook-core.ts`: `write_workbook`.
- `index.ts`: the plugin entry for the CLI.
- `data/eng.traineddata.gz`: English OCR data.
- `fixtures/`, `scripts/`: test files and dev scripts. They are not copied into the app.
- `SPIKE_REPORT.md`: the November 2026 test of these tools in the plugin runtime (written when the folder was `segra-accountant`).

## Tests

```sh
cd plugins/segra-documents && bun install && bun test
```
