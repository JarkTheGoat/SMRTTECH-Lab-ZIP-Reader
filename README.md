# SMRTTECH Lab ZIP Reader

A static browser tool for reading SMRTTECH 3CC3 and 3DE3 lab submission ZIP packages and standalone `completion.json` files.

## Features

- Supports `3cc3-lab-completion-v1` and `3de3-lab-completion-v1` records.
- Reads ZIP packages locally in the browser.
- Lists packaged evidence and previews supported images.
- Produces completion reports, grading summaries, CSV gradebooks, and detailed JSON reports.
- Recognizes complete and partial lab submissions.
- Applies the revised 3DE3 Lab 2 rubric for stages 0-9, NAND/XOR/XNOR outputs, board references, project naming, and `.v` evidence.

## Privacy

Selected files are processed locally by client-side JavaScript. This static site does not upload submission packages to a server. Closing or refreshing the page clears the active in-page results.

## Limitations

Reports assist instructor review; they are not a replacement for human assessment. Client-generated completion records and hashes are not tamper-proof.

## GitHub Pages

The site is served directly from the repository's `main` branch root.

## Tests

Run the complete compatibility suite with `npm test`. The tests use Node's built-in test runner and require no installed packages.
