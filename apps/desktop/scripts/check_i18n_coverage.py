import io, os, re

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "renderer", "src")
ZH = os.path.join(SRC, "lib", "i18n", "zh.ts")

pattern = re.compile(r'\bt\(\s*"((?:[^"\\]|\\.)*)"')
keys = set()
for root, dirs, files in os.walk(SRC):
    for f in files:
        if not f.endswith((".tsx", ".ts")):
            continue
        s = io.open(os.path.join(root, f), encoding="utf-8").read()
        for m in pattern.finditer(s):
            keys.add(m.group(1).replace('\\"', '"'))

zh = io.open(ZH, encoding="utf-8").read()
quoted = set(m.group(1) for m in re.finditer(r'"((?:[^"\\]|\\.)*)"\s*:', zh))
bare = set(m.group(1) for m in re.finditer(r'^\s*([A-Za-z0-9_.{}$ ]+)\s*:', zh, re.M))
missing = []
for k in sorted(keys):
    if k not in quoted and k not in bare:
        missing.append(k)
print("total t() keys:", len(keys))
print("missing zh entries:", len(missing))
for k in missing:
    print("  -", k)
