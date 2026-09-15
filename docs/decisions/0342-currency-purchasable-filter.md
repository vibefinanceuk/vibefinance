# 0342 — Filtered to What a Company Actually Purchases With

**Status: built.** "Some of the currencies in the list are strange —
such as Bond Markets Unit European... Is there a way to filter out
currencies which are not really currencies that companies purchase
with?"

---

## The distinction, checked directly rather than assumed

ISO 4217 itself already draws this exact line, in its own published
tables — the standard's own scope explicitly "includes funds and
precious metals" as something separate from ordinary currency, and
its own Wikipedia summary describes precisely the categories the
reported example belongs to: "supranational currencies, procedural
purposes, and several things which are 'similar to' currencies."
Nothing here is a judgement call this decision invented; it is what
the standard itself already separates out.

**Excluded, 22 codes:**
- The four precious metals — XAU (gold), XAG (silver), XPD
  (palladium), XPT (platinum) — each one troy ounce of the metal, not
  a currency at all.
- The four historical bond-markets units (XBA–XBD) — the exact
  example reported live, "Bond Markets Unit European Composite Unit"
  among them.
- The IMF's own Special Drawing Right (XDR), the Asian Development
  Bank's own unit of account (XUA), and the ALBA bloc's own regional
  settlement unit (XSU) — real financial instruments, none of them
  something a supplier is ever paid in directly.
- The code reserved for testing (XTS) and the code meaning no
  currency is involved at all (XXX).
- The nine codes ISO 4217's own "funds" table lists separately from
  ordinary currency: Chile's UF, Colombia's UVR, and Mexico's UDI
  (each an inflation-indexed accounting unit, distinct from the real,
  circulating peso each country actually spends — CLP, COP, MXN,
  none of them touched); Uruguay's two (UYI, UYW, alongside its own
  real peso, UYU); Switzerland's WIR pair (CHE, CHW — a
  complementary-currency network's own settlement units, distinct
  from the Swiss franc, CHF, untouched); Bolivia's Mvdol (BOV); and
  the next-day US Dollar settlement code (USN).

**Kept, deliberately.** Every supranational currency still actually
circulated and spent by real countries and territories — the CFA
Franc BEAC and BCEAO (XAF, XOF), the East Caribbean Dollar (XCD), the
CFP Franc (XPF), and the newly introduced Caribbean guilder (XCG) —
stays. These begin with the same "X" prefix as the excluded codes for
the same reason (ISO 3166 never assigns country codes starting with
"X", so ISO 4217 uses that prefix for anything not tied to one
specific country) but are real currencies a real supplier is paid in,
not funds or metals borrowing a currency-shaped code.

## What changed

`PEPPOL_CURRENCIES` (178 entries, decision 0340's own full ISO 4217
list) became `PURCHASABLE_CURRENCIES` (156) — the constant's own name
changed along with its scope, since it no longer describes the full
standard, only the part of it a business actually transacts in.
Nothing else moved: the same function, the same four places it is
used, the same code-and-name display.

## What has coverage

Both of decision 0340's own tests, which counted 178 options, updated
to the real count of 156. A new, dedicated test names the exact
reported example (a Bond Markets Unit code) alongside gold, the
Special Drawing Right, the test code, the no-currency code, and one
of ISO 4217's own funds — confirming each is genuinely absent — while
confirming two real, still-circulating supranational currencies are
not swept up by the same filter. Probed directly: reintroducing one
excluded code failed exactly the test built to catch it.

`vf-app`: unchanged. `vf-ui`: 63 Worker (unchanged), 499 browser (was
498).
