# Vendored: tesseract.js 6.0.1, tesseract.js-core 6.0.0, trained data 4.0.0_best_int

Decision 0698: scanned pages are read into words with positions by Tesseract,
**in the browser**, so a field clicked shows where its value is on a scan and a
lasso round part of a scan gives text. Nothing about a document leaves this
deployment's origin to do it, and it costs no Workers AI allowance.

| File | From | Licence |
| --- | --- | --- |
| `tesseract.esm.min.js`, `worker.min.js` | `tesseract.js@6.0.1` `dist/` | Apache-2.0 (`LICENSE.md`) |
| `core/tesseract-core-lstm.wasm.js`, `core/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@6.0.0` | Apache-2.0 (`core/LICENSE`) |
| `lang/eng.traineddata.gz`, `lang/deu.traineddata.gz` | `@tesseract.js-data/eng@1.0.0`, `@tesseract.js-data/deu@1.0.0`, `4.0.0_best_int/` | Apache-2.0 (tessdata_best, Google) |

Unmodified. Only the LSTM cores are kept (the worker is created with OEM 1,
LSTM only, and picks the SIMD core where the browser has SIMD): the legacy
cores add 9 MB and are never loaded.

`best_int` rather than `fast` or `best`: integer-quantised `best` models, close
to `best` in accuracy at a third of the size. English and German, the two
interface languages; another language is one more `.traineddata.gz` here and
its code in `ocr.js`'s `LANGUAGES`.

The browser downloads the core and the trained data **once**: tesseract.js
keeps the trained data in IndexedDB, and the core is an ordinary cached file.

To update: `npm pack` each package at the new version, replace the files above,
bump the versions here.
