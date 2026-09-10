#!/usr/bin/env python3
"""
Transcribe OpenPEPPOL's rendering data into TypeScript — decision 0205.

**Nothing is typed by hand.** Decision 0200 found that a hand-copied
list drifts: writing the permission set into SQL I invented five that do
not exist and omitted five that do, then missed an entire namespace
correcting it. The code lists here are 262 codes across three lists and
sixty labels, and a person transcribing them would be worse.

So this reads the XSLT's own `codelists` and `labels` variables and its
`<style>` block, and writes them out.

    python3 scripts/extract-peppol-render-data.py path/to/stylesheet-ubl.xslt

The stylesheet is fetched rather than vendored, so re-running against a
newer release is how this stays current.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / "workers/vf-app/src/peppol-render-data.ts"


def variable_block(source: str, name: str) -> str:
    """The contents of an `xsl:variable`, as XML."""
    start = source.index(f'<xsl:variable name="{name}"')
    end = source.index("</xsl:variable>", start) + len("</xsl:variable>")
    raw = source[start:end]
    return raw[raw.index(">") + 1 : raw.rindex("</xsl:variable>")]


def main(path: str) -> int:
    source = Path(path).read_text(encoding="utf-8")

    css = re.search(r"<style[^>]*>(.*?)</style>", source, re.S)
    if not css:
        print("no <style> block found — has the stylesheet changed shape?", file=sys.stderr)
        return 1

    codelists = {}
    for cl in ET.fromstring(f"<root>{variable_block(source, 'codelists')}</root>").findall("cl"):
        codelists[cl.get("id")] = {
            c.get("id"): {t.get("id"): (t.text or "") for t in c.findall("t")}
            for c in cl.findall("c")
        }

    labels = {}
    for g in ET.fromstring(f"<root>{variable_block(source, 'labels')}</root>").findall("g"):
        labels[g.get("id")] = {
            f.get("id"): {t.get("id"): (t.text or "") for t in f.findall("t")}
            for f in g.findall("f")
        }

    header = '''/**
 * The Peppol rendering's own data — decision 0205.
 *
 * **Extracted from OpenPEPPOL's `stylesheet-ubl.xslt`, not invented.**
 * The code lists, the labels and the stylesheet are that document's
 * work, and this file is a transcription so a TypeScript renderer can
 * use what an XSLT 2.0 processor would have.
 *
 * **Nothing here was typed by hand.** Decision 0200 found that a
 * hand-copied list drifts, and this is 262 codes and sixty labels.
 *
 * Source: https://github.com/OpenPEPPOL/peppol-bis-invoice-3
 * Regenerate: `python3 scripts/extract-peppol-render-data.py <stylesheet>`
 */

/**
 * The languages the official stylesheet ships. **English and
 * Norwegian**, which is what OpenPEPPOL provides — a German customer
 * gets English until somebody translates the labels, and that is a
 * fact about the upstream artefact rather than about this renderer.
 */
export type PeppolLanguage = "en" | "no";

'''

    compact = lambda d: json.dumps(d, ensure_ascii=False, separators=(",", ":"))

    TARGET.write_text(
        header
        + "/** ISO 3166 countries, UNCL1001 document types, and the credit-note variant. */\n"
        + "export const CODE_LISTS: Record<string, Record<string, Record<string, string>>> =\n  "
        + compact(codelists)
        + ";\n\n"
        + "/** The stylesheet's own words, by section and field. */\n"
        + "export const LABELS: Record<string, Record<string, Record<string, string>>> =\n  "
        + compact(labels)
        + ";\n\n"
        + "/**\n * The official stylesheet's CSS, verbatim.\n *\n"
        + " * **This is the design, and it is theirs.** Emitting the same markup\n"
        + " * with the same rules is what makes a rendering recognisable as a\n"
        + " * Peppol document rather than as ours.\n */\n"
        + "export const PEPPOL_CSS =\n  "
        + json.dumps(css.group(1))
        + ";\n",
        encoding="utf-8",
    )

    print(f"code lists: {sorted(codelists)}")
    print(f"labels: {sum(len(v) for v in labels.values())} in {len(labels)} groups")
    print(f"css: {len(css.group(1))} chars")
    print(f"written to {TARGET}")
    return 0

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
