"""One-shot re-tint: cool blue/purple theme -> neutral gray + white accent.

Maps Tailwind classes and inline colors across the renderer to the neutral
palette sampled from the reference UI (#161616 bg, #2b2b2b panels, #d4d4d4
text, white primary buttons). Status colors (green/red/amber) and the brand
cube gradient are intentionally untouched.
"""
import io, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "src", "renderer", "src")
FILES = []
for base, dirs, names in os.walk(ROOT):
    for n in names:
        if n.endswith((".tsx", ".ts", ".css")):
            FILES.append(os.path.join(base, n))
FILES.append(os.path.join(ROOT, "..", "..", "index.html"))
FILES.append(os.path.join(ROOT, "styles.css"))

# Ordered (old, new) literal replacements.
REPLACEMENTS = [
    # Tailwind accent classes: purple -> near-white neutral steps
    ("purple-200", "neutral-100"),
    ("purple-300", "neutral-200"),
    ("purple-400", "neutral-300"),
    ("purple-500", "neutral-300"),
    ("purple-600", "neutral-400"),
    # Tailwind cool gray -> pure neutral (same step)
    ("slate-", "neutral-"),
    # Purple/indigo inline rgba -> white/neutral overlays (keep alpha + spacing)
    ("rgba(168, 85, 247,", "rgba(255, 255, 255,"),
    ("rgba(168,85,247,", "rgba(255,255,255,"),
    ("rgba(99, 102, 241,", "rgba(163, 163, 163,"),
    ("rgba(99,102,241,", "rgba(163,163,163,"),
    # Accent gradient hexes (indigo->purple->pink) -> light neutral ramp
    ("#6366f1", "#f5f5f5"),
    ("#7273f3", "#ffffff"),
    ("#a855f7", "#e5e5e5"),
    ("#b366f9", "#f0f0f0"),
    ("#ec4899", "#a3a3a3"),
    ("#f060a3", "#bfbfbf"),
    ("#c084fc", "#e5e5e5"),
    ("#c4b5fd", "#e5e5e5"),
    ("#e9d5ff", "#f5f5f5"),
    ("#a5b4fc", "#d4d4d4"),
    # Slate-family hexes -> neutral hexes
    ("#f1f5f9", "#e5e5e5"),
    ("#f8fafc", "#f5f5f5"),
    ("#e2e8f0", "#e5e5e5"),
    ("#cbd5e1", "#d4d4d4"),
    ("#94a3b8", "#a3a3a3"),
    ("#8b93a3", "#a3a3a3"),
    ("#64748b", "#737373"),
    ("#475569", "#525252"),
    ("#334155", "#404040"),
    ("#1e293b", "#262626"),
    ("#0f172a", "#171717"),
    # Blue-tinted dark surfaces -> neutral dark
    ("#101218", "#171717"),
    ("#12141a", "#1a1a1a"),
    ("#12131a", "#1a1a1a"),
    ("#0b0c10", "#141414"),
    ("#0a0b0f", "#141414"),
    ("rgba(15, 16, 22,", "rgba(23, 23, 23,"),
    ("rgba(15,16,22,", "rgba(23,23,23,"),
    ("rgba(16, 18, 24,", "rgba(23, 23, 23,"),
    ("rgba(16,18,24,", "rgba(23,23,23,"),
]

total = 0
for path in FILES:
    s = io.open(path, encoding="utf-8").read()
    orig = s
    for old, new in REPLACEMENTS:
        s = s.replace(old, new)
    if s != orig:
        io.open(path, "w", encoding="utf-8", newline="").write(s)
        count = sum(orig.count(o) for o, _ in REPLACEMENTS)
        total += count
        print(f"updated {os.path.relpath(path, ROOT)} (~{count} hits)")
print(f"done, ~{total} replacements in {len(FILES)} files")
