# usage: python3 -I add_model.py models3d.js key part.json [key part.json ...]
# Adds (or replaces) models in js/models3d.js, keeping the wrapper comment and the other entries.
import sys, json, re
path = sys.argv[1]
s = open(path, encoding='utf8').read()
m = re.match(r'(?s)(.*?\(function\(\)\{\s*window\.MODELS3D\s*=\s*)(\{.*\})(;\s*\}\)\(\);\s*)$', s)
assert m, 'wrapper not recognised'
head, body, tail = m.group(1), m.group(2), m.group(3)
M = json.loads(body)
args = sys.argv[2:]
for i in range(0, len(args), 2):
    k, p = args[i], args[i + 1]
    d = json.load(open(p))
    M[k] = {kk: d[kk] for kk in ('pos', 'nor', 'uv', 'idx', 'tex', 'mask') if kk in d}
    print('set', k, 'tris', len(d['idx']) // 3)
out = head + json.dumps(M, separators=(',', ':'), ensure_ascii=False) + tail
open(path, 'w', encoding='utf8').write(out)
print('keys', list(M.keys()), 'bytes', len(out.encode('utf8')))
