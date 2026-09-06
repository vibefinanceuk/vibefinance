# 0124 — One font, one scale

**Status: built.** Calibri, four sizes, and form controls that stop
looking different from everything around them.

---

## The entry cells really were different

Reported: *"the field cells that permit entry seem to be larger and
perhaps Arial."*

Half right, and the half that was right is a genuine bug.

**A browser gives a form control its own font family, size, weight and
line-height.** The stylesheet set `font-family: inherit`, which fixes
one of those four and leaves the other three at the browser's defaults —
so every input and select has been slightly larger than the text beside
it since the interface existed.

`font: inherit` takes all four. `select` is the worst offender: several
platforms ignore a family set any other way.

*(The face was never Arial — `--font-sans` was the system stack, so on
a Mac it was San Francisco. But something **was** different, and it was
the size.)*

---

## Calibri, with Carlito behind it

Asked for by name. **Calibri is not on macOS or Linux** unless Office
installed it, so a bare `Calibri, sans-serif` would give Calibri on
Windows and something else everywhere else — the opposite of the
consistency being asked for.

**Carlito is metric-compatible**: the same widths and shapes, openly
licensed. A machine without Calibri gets a face that lays out
identically rather than a fallback that reflows every panel.

The system stack follows both, because a machine may have neither and
something must be readable.

**Not yet shipped as a webfont.** That is the only way to guarantee the
same face on every machine, and it means a font file in the assets —
worth doing, and worth deciding rather than assuming.

---

## Four sizes, not seven

The interface had **seven hardcoded sizes**, with 11, 12 and 13px all
in use.

That is accumulation rather than a scale: nothing said what the
difference between 12 and 13 meant, so each new panel picked whichever
looked right beside its neighbour. `index.html` also defined a
`--step-2` that existed nowhere else.

| Step | For |
| --- | --- |
| `--text-sm` 12px | Labels, captions, secondary detail |
| `--text-base` 14px | Body, fields, table cells — most of the screen |
| `--text-lg` 16px | Panel headings, a document's identity |
| `--text-xl` 20px | The one thing a screen is about |

A point above what the interface used, because **Calibri sits smaller
than the system faces at the same pixel size**.

**A size not on this list is a decision somebody should have to
justify**, and a test now refuses one.

---

## Two things the test itself taught

**Vite processes CSS before `?raw` sees it** and hands back an empty
string. A typography test reading an empty string passes everything —
worse than no test. The stylesheets come through a virtual module that
reads them from disk at config time.

**And the first version counted its own comment.** It matched
`font-family:` wherever it appeared, including in the prose explaining
why there should only be one. Comments are stripped first: *a test that
reads prose as code will keep finding things that are not there.*

---

## What is not built

- **The webfont.** Until then, "Calibri" means Calibri where it is
  installed and Carlito where that is, and neither on a machine with
  only the system stack.
- **Line height and weight are not on a scale.** Only size is.
- **Nothing checks the sign-in screen's own markup**, which carries its
  styles inline.
