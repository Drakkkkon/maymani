#!/usr/bin/env python3
"""Лёгкие детали для игры «Мое_город» из GLB нейросети Hunyuan3D.
  inspect in.glb                    — размеры и распределение вершин
  bake in.glb out.json [опции]      — рельефная сетка по карте глубины + цвет, запечённый ортографической проекцией спереди
  preview out.json out.png          — проверочные виды лёгкой модели (спереди, сбоку сверху, справа)
Система координат результата: x по центру, y от 0 вверх (высота = --height), z от 0 (задняя плоскость у стены) вперёд.
"""
import sys, json, struct, base64, io, math, argparse
import numpy as np
import cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None


def load_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF', 'not a GLB'
    jl, jt = struct.unpack('<II', b[12:20])
    js = json.loads(b[20:20 + jl].decode('utf8'))
    o = 20 + jl
    bl, bt = struct.unpack('<II', b[o:o + 8])
    binb = b[o + 8:o + 8 + bl]
    prim = js['meshes'][0]['primitives'][0]
    CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(i):
        a = js['accessors'][i]
        bv = js['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        fmt, sz = CT[a['componentType']]
        n = a['count'] * NC[a['type']]
        arr = np.frombuffer(binb, dtype='<' + fmt, count=n, offset=off)
        return arr.reshape(a['count'], NC[a['type']]) if NC[a['type']] > 1 else arr.copy()
    pos = acc(prim['attributes']['POSITION']).astype(np.float64)
    nd = [n for n in js.get('nodes', []) if 'mesh' in n]
    if nd:
        nd = nd[0]
        if 'scale' in nd:
            pos = pos * np.array(nd['scale'])
        if 'rotation' in nd:
            qx, qy, qz, qw = nd['rotation']
            R = np.array([[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
                          [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
                          [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]])
            pos = pos @ R.T
        if 'translation' in nd:
            pos = pos + np.array(nd['translation'])
    uv = acc(prim['attributes']['TEXCOORD_0']).astype(np.float64)
    idx = acc(prim['indices']).astype(np.int64).reshape(-1, 3)
    mat = js['materials'][prim.get('material', 0)]
    ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    img = js['images'][js['textures'][ti]['source']]
    bv = js['bufferViews'][img['bufferView']]
    raw = binb[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    return pos, uv, idx, im, js


def inspect(path):
    pos, uv, idx, im, js = load_glb(path)
    mn, mx = pos.min(0), pos.max(0)
    print('verts', len(pos), 'tris', len(idx), 'tex', im.size)
    print('min', mn.round(4), 'max', mx.round(4), 'size', (mx - mn).round(4))
    for k, nm in enumerate('xyz'):
        span = mx[k] - mn[k]
        print(nm, 'verts within 1%% of min: %d, of max: %d' % ((pos[:, k] < mn[k] + 0.01 * span).sum(), (pos[:, k] > mx[k] - 0.01 * span).sum()))


def rasterize(pos, uv, idx, im, wpx, hpx, x0, y0, x1, y1, ss=2):
    """Ортографический вид: x вправо, y вверх, камера смотрит с +z. Возвращает цвет RGB, маску, глубину (все в hpx*ss x wpx*ss)."""
    W, H = wpx * ss, hpx * ss
    sx = W / (x1 - x0); sy = H / (y1 - y0)
    P = np.stack([(pos[:, 0] - x0) * sx, (y1 - pos[:, 1]) * sy], 1)
    z = pos[:, 2]
    order = np.argsort(z[idx].mean(1))  # дальние сначала
    ids = np.zeros((H, W, 3), np.uint8)
    SH = 4
    Q = np.round(P * (1 << SH)).astype(np.int32)
    for t in order:
        v = int(t) + 1
        cv2.fillConvexPoly(ids, Q[idx[t]], (v & 255, (v >> 8) & 255, (v >> 16) & 255), lineType=cv2.LINE_8, shift=SH)
    tid = ids[:, :, 0].astype(np.int64) | (ids[:, :, 1].astype(np.int64) << 8) | (ids[:, :, 2].astype(np.int64) << 16)
    mask = tid > 0
    t = np.where(mask, tid - 1, 0)
    tri = idx[t]
    gx, gy = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    a = P[tri[..., 0]]; b = P[tri[..., 1]]; c = P[tri[..., 2]]
    v0 = b - a; v1 = c - a
    d = v0[..., 0] * v1[..., 1] - v0[..., 1] * v1[..., 0]
    d = np.where(np.abs(d) < 1e-9, 1e-9, d)
    pxv = np.stack([gx, gy], -1) - a
    l1 = (pxv[..., 0] * v1[..., 1] - pxv[..., 1] * v1[..., 0]) / d
    l2 = (v0[..., 0] * pxv[..., 1] - v0[..., 1] * pxv[..., 0]) / d
    l = np.stack([1 - l1 - l2, l1, l2], -1)
    l = np.clip(l, 0.0, 1.0)
    l = l / np.maximum(l.sum(-1, keepdims=True), 1e-9)
    uu = (l[..., None] * uv[tri]).sum(2)
    tw, th = im.size
    col = cv2.remap(np.asarray(im), (uu[..., 0] * tw - 0.5).astype(np.float32), (uu[..., 1] * th - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    zz = (l * z[tri]).sum(-1)
    return col, mask, zz


def fill_background(col, mask):
    return cv2.inpaint(col, (~mask).astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)


def relief_mesh(depth, mask, nx, ny, ss, mn, mx):
    """Сетка высот (nx+1)x(ny+1) узлов по карте глубины + юбка по периметру до плоскости стены."""
    Z = np.zeros((ny + 1, nx + 1))
    H, W = depth.shape
    for j in range(ny + 1):
        for i in range(nx + 1):
            ci = i * ss; cj = j * ss
            sl = (slice(max(cj - 1, 0), min(cj + 1, H)), slice(max(ci - 1, 0), min(ci + 1, W)))
            m = mask[sl]
            Z[j, i] = depth[sl][m].max() if m.any() else 0.0
    xs = mn[0] + (mx[0] - mn[0]) * np.arange(nx + 1) / nx
    ys = mx[1] - (mx[1] - mn[1]) * np.arange(ny + 1) / ny
    gx, gy = np.meshgrid(xs, ys)
    pts = np.stack([gx.ravel(), gy.ravel(), np.maximum(Z, 0).ravel()], 1)
    vid = lambda i, j: j * (nx + 1) + i
    faces = []
    for j in range(ny):
        for i in range(nx):
            a0, b0, c0, d0 = vid(i, j), vid(i + 1, j), vid(i, j + 1), vid(i + 1, j + 1)
            faces += [(a0, c0, b0), (b0, c0, d0)] if (i + j) % 2 == 0 else [(a0, c0, d0), (a0, d0, b0)]
    ring = [vid(i, 0) for i in range(nx + 1)] + [vid(nx, j) for j in range(1, ny + 1)] + \
           [vid(i, ny) for i in range(nx - 1, -1, -1)] + [vid(0, j) for j in range(ny - 1, 0, -1)]
    start = len(pts)
    pts = np.vstack([pts, np.array([[pts[r][0], pts[r][1], 0.0] for r in ring])])
    n_ = len(ring)
    for k in range(n_):
        t0, t1 = ring[k], ring[(k + 1) % n_]
        b0, b1 = start + k, start + (k + 1) % n_
        faces += [(t0, b0, t1), (t1, b0, b1)]
    return pts.astype(np.float32), np.array(faces, np.int32)


def relief_blocks(depth, mask, gw, gh, ss, mn, mx, levels=6, min_area=3, zscale=1.0, dropdown=True, med=3, rowmed=False):
    """Блочный рельеф: сетка ячеек -> несколько уровней глубины -> «жадное» объединение в прямоугольники.
    Выдаёт чистую угловатую геометрию (как у моделлера): верхние грани уровней и боковые стенки между ними."""
    from scipy import ndimage
    from scipy.cluster.vq import kmeans2
    H, W = depth.shape
    Zc = np.zeros((gh, gw))
    for j in range(gh):
        for i in range(gw):
            sl = (slice(j * ss, (j + 1) * ss), slice(i * ss, (i + 1) * ss))
            m = mask[sl]
            Zc[j, i] = np.max(depth[sl][m]) if m.sum() * 2 >= m.size else 0.0
    if rowmed:   # профиль по высоте: в каждой строке — медианная глубина (карниз, плинтус: одинаковый вдоль всей длины)
        for j in range(gh):
            nzr = Zc[j][Zc[j] > 1e-4]
            Zc[j, :] = np.median(nzr) if len(nzr) * 2 >= gw else 0.0
    vals = Zc[Zc > 1e-4].reshape(-1, 1)
    np.random.seed(1)
    cent, lab = kmeans2(vals, levels, minit='++', seed=1)
    cent = np.sort(cent.reshape(-1))
    # индекс уровня: 0 — стена
    lev = np.zeros((gh, gw), int)
    nz = Zc > 1e-4
    lev[nz] = 1 + np.argmin(np.abs(Zc[nz][:, None] - cent[None, :]), axis=1)
    zlev = np.concatenate([[0.0], cent]) * zscale
    lev = ndimage.median_filter(lev, size=med, mode='nearest')
    # мелкие области -> соседний уровень
    for it in range(2):
        for L in range(0, len(zlev)):
            lab_, n = ndimage.label(lev == L)
            for c in range(1, n + 1):
                reg = lab_ == c
                if reg.sum() < min_area:
                    ring = ndimage.binary_dilation(reg) & ~reg
                    nb = lev[ring]
                    if len(nb):
                        lev[reg] = np.bincount(nb).argmax()
    xs = mn[0] + (mx[0] - mn[0]) * np.arange(gw + 1) / gw
    ys = mx[1] - (mx[1] - mn[1]) * np.arange(gh + 1) / gh
    verts, faces = [], []
    def quad(p, nrm):
        if dropdown and nrm[1] < 0: return   # снизу грани не видны (камера сверху)
        a = np.array(p, float); n = np.cross(a[1] - a[0], a[2] - a[0])
        order = [0, 1, 2, 3] if np.dot(n, nrm) > 0 else [0, 3, 2, 1]
        b = len(verts)
        for k in order: verts.append(a[k])
        faces.extend([(b, b + 1, b + 2), (b, b + 2, b + 3)])
    # верхние грани: жадные прямоугольники по уровню
    for L in range(1, len(zlev)):
        used = np.zeros((gh, gw), bool); m = lev == L
        for j in range(gh):
            for i in range(gw):
                if m[j, i] and not used[j, i]:
                    i1 = i
                    while i1 + 1 < gw and m[j, i1 + 1] and not used[j, i1 + 1]: i1 += 1
                    j1 = j
                    while j1 + 1 < gh and m[j1 + 1, i:i1 + 1].all() and not used[j1 + 1, i:i1 + 1].any(): j1 += 1
                    used[j:j1 + 1, i:i1 + 1] = True
                    z = zlev[L]
                    quad([(xs[i], ys[j], z), (xs[i1 + 1], ys[j], z), (xs[i1 + 1], ys[j1 + 1], z), (xs[i], ys[j1 + 1], z)], (0, 0, 1))
    # боковые стенки: вертикальные линии сетки (между ячейками по x)
    pad = np.pad(lev, 1, constant_values=0)
    for i in range(gw + 1):
        j = 0
        while j < gh:
            l, r = pad[j + 1, i], pad[j + 1, i + 1]
            if l != r:
                j1 = j
                while j1 + 1 < gh and pad[j1 + 2, i] == l and pad[j1 + 2, i + 1] == r: j1 += 1
                zl, zr = zlev[l], zlev[r]; lo, hi = min(zl, zr), max(zl, zr); nx_ = 1 if zl > zr else -1
                quad([(xs[i], ys[j], lo), (xs[i], ys[j], hi), (xs[i], ys[j1 + 1], hi), (xs[i], ys[j1 + 1], lo)], (nx_, 0, 0))
                j = j1 + 1
            else:
                j += 1
    # горизонтальные линии сетки (между ячейками по y)
    for j in range(gh + 1):
        i = 0
        while i < gw:
            up, dn = pad[j, i + 1], pad[j + 1, i + 1]
            if up != dn:
                i1 = i
                while i1 + 1 < gw and pad[j, i1 + 2] == up and pad[j + 1, i1 + 2] == dn: i1 += 1
                zu, zd = zlev[up], zlev[dn]; lo, hi = min(zu, zd), max(zu, zd); ny_ = -1 if zu > zd else 1
                quad([(xs[i], ys[j], lo), (xs[i1 + 1], ys[j], lo), (xs[i1 + 1], ys[j], hi), (xs[i], ys[j], hi)], (0, ny_, 0))
                i = i1 + 1
            else:
                i += 1
    return np.array(verts, np.float32), np.array(faces, np.int32), zlev, lev


def finish(sp, sf, x0, x1, y0, y1, crease):
    """Дубли вершин по граням, нормали (сглаживание по углу), планарные UV спереди."""
    keep = [f for f in sf if f[0] != f[1] and f[1] != f[2] and f[0] != f[2]]
    P, N, UV, I = [], [], [], []
    for f in keep:
        p = sp[f].astype(np.float64)
        n = np.cross(p[1] - p[0], p[2] - p[0]); L = np.linalg.norm(n)
        if L < 1e-12:
            continue
        n /= L; b = len(P)
        for q in p:
            P.append(q); N.append(n); UV.append(((q[0] - x0) / (x1 - x0), (y1 - q[1]) / (y1 - y0)))
        I += [b, b + 1, b + 2]
    P = np.array(P); N = np.array(N)
    if crease > 0:
        key = {}
        for i, q in enumerate(P):
            key.setdefault(tuple(np.round(q, 4)), []).append(i)
        cosT = math.cos(math.radians(crease)); sm = N.copy()
        for lst in key.values():
            for i in lst:
                acc = np.zeros(3)
                for j in lst:
                    if np.dot(N[i], N[j]) >= cosT:
                        acc += N[j]
                L = np.linalg.norm(acc)
                if L > 0:
                    sm[i] = acc / L
        N = sm
    return P, N, np.array(UV), I


def bake(a):
    pos, uv, idx, im, js = load_glb(a.inp)
    ax = {'x': 0, 'y': 1, 'z': 2}
    fa, fs = ax[a.front[1]], (1 if a.front[0] == '+' else -1)
    ua = ax[a.up]
    ra = ({0, 1, 2} - {fa, ua}).pop()
    P = np.stack([pos[:, ra], pos[:, ua], pos[:, fa] * fs], 1)
    tri = idx.copy()
    if np.linalg.det(np.eye(3)[[ra, ua, fa]]) * fs < 0:
        P[:, 0] *= -1; tri = tri[:, [0, 2, 1]]
    if a.mirror:
        P[:, 0] *= -1; tri = tri[:, [0, 2, 1]]
    mn, mx = P.min(0), P.max(0)
    k = a.height / (mx[1] - mn[1])
    P = (P - np.array([(mn[0] + mx[0]) / 2, mn[1], mn[2]])) * k
    mn, mx = P.min(0), P.max(0)
    print('normalized size', (mx - mn).round(4), 'tris', len(tri))
    hpx = a.tex
    wpx = int(round(hpx * (mx[0] - mn[0]) / (mx[1] - mn[1]))); wpx += wpx % 2
    ss = 2
    col, mask, zz = rasterize(P, uv, tri, im, wpx, hpx, mn[0], mn[1], mx[0], mx[1], ss=ss)
    colf = fill_background(col, mask)
    small = cv2.resize(colf, (wpx, hpx), interpolation=cv2.INTER_AREA)
    gh = a.grid
    gw = max(2, int(round(gh * (mx[0] - mn[0]) / (mx[1] - mn[1]))))
    colg, maskg, zg = rasterize(P, uv, tri, im, gw, gh, mn[0], mn[1], mx[0], mx[1], ss=ss)
    if a.mode == 'blocks':
        pts, faces, zlev, lev = relief_blocks(zg, maskg, gw, gh, ss, mn, mx, levels=a.levels, min_area=a.minarea, dropdown=not a.keepdown, med=a.med, rowmed=a.rowmed)
        print('blocks grid', gw, 'x', gh, 'levels', np.round(zlev, 3).tolist(), 'tris', len(faces))
        sp, sf = pts, faces
    else:
        pts, faces = relief_mesh(zg, maskg, gw, gh, ss, mn, mx)
        print('relief grid', gw, 'x', gh, 'tris', len(faces))
        import fast_simplification as fs_
        sp, sf = fs_.simplify(pts, faces, target_count=a.tris, agg=a.agg)
        print('simplified tris', len(sf))
    Pn, Nn, UVn, I = finish(sp, sf, mn[0], mx[0], mn[1], mx[1], a.crease)
    r = lambda arr, d=4: [round(float(v), d) for v in np.array(arr).reshape(-1)]
    ok, jpg = cv2.imencode('.jpg', cv2.cvtColor(small, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, a.quality])
    data = {'pos': r(Pn), 'nor': r(Nn, 3), 'uv': r(UVn, 5), 'idx': [int(i) for i in I],
            'tex': 'data:image/jpeg;base64,' + base64.b64encode(jpg.tobytes()).decode(),
            'size': [float(mx[0] - mn[0]), float(mx[1] - mn[1]), float(mx[2] - mn[2])]}
    if a.mask:
        m8 = cv2.erode(mask.astype(np.uint8) * 255, np.ones((3, 3), np.uint8), iterations=2)   # на 1 пиксель внутрь: без светлой каймы от закрашенного фона
        mk = cv2.resize(m8, (wpx, hpx), interpolation=cv2.INTER_AREA)
        ok2, png = cv2.imencode('.png', mk)
        data['mask'] = 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode()
        print('mask png bytes', len(png), 'transparent share', round(float((mk < 128).mean()), 3))
    json.dump(data, open(a.out, 'w'))
    if a.png:
        Image.fromarray(small).save(a.png)
    print('wrote', a.out, 'tris', len(I) // 3, 'tex', small.shape, 'jpg bytes', len(jpg))


def preview(path, outpng):
    d = json.load(open(path))
    pos = np.array(d['pos']).reshape(-1, 3); nor = np.array(d['nor']).reshape(-1, 3); uv = np.array(d['uv']).reshape(-1, 2)
    idx = np.array(d['idx']).reshape(-1, 3)
    raw = base64.b64decode(d['tex'].split(',', 1)[1])
    tex = np.asarray(Image.open(io.BytesIO(raw)).convert('RGB'))
    th, tw = tex.shape[:2]
    sz = d['size']
    views = [(0, 0), (-35, 25), (40, 20), (-75, 10)]
    S = 360
    tiles = []
    for yaw, pitch in views:
        ya, pa = math.radians(yaw), math.radians(pitch)
        cy, sy_, cp, sp_ = math.cos(ya), math.sin(ya), math.cos(pa), math.sin(pa)
        c = np.array([0, sz[1] / 2, sz[2] / 2])
        q = pos - c
        x1 = q[:, 0] * cy + q[:, 2] * sy_; z1 = -q[:, 0] * sy_ + q[:, 2] * cy; y1 = q[:, 1]
        y2 = y1 * cp - z1 * sp_; z2 = y1 * sp_ + z1 * cp
        n = nor
        nx1 = n[:, 0] * cy + n[:, 2] * sy_; nz1 = -n[:, 0] * sy_ + n[:, 2] * cy; ny1 = n[:, 1]
        ny2 = ny1 * cp - nz1 * sp_; nz2 = ny1 * sp_ + nz1 * cp
        sc = S * 0.8 / max(sz[1], sz[0])
        X = x1 * sc + S / 2; Y = S / 2 - y2 * sc
        order = np.argsort(z2[idx].mean(1))
        img = np.full((S, S, 3), 70, np.uint8)
        L = np.array([-0.3, 0.6, 0.75]); L /= np.linalg.norm(L)
        for t in order:
            f = idx[t]
            pts = np.stack([X[f], Y[f]], 1)
            a_ = pts[1] - pts[0]; b_ = pts[2] - pts[0]
            if a_[0] * b_[1] - a_[1] * b_[0] > 0:
                continue
            nn = np.array([nx1[f].mean(), ny2[f].mean(), nz2[f].mean()]); nn /= (np.linalg.norm(nn) + 1e-9)
            sh = 0.45 + 0.55 * max(0.0, float(nn @ L))
            u = uv[f, 0].mean(); v = uv[f, 1].mean()
            cc = tex[min(th - 1, max(0, int(v * th))), min(tw - 1, max(0, int(u * tw)))].astype(float) * sh
            cv2.fillConvexPoly(img, np.round(pts).astype(np.int32), tuple(int(max(0, min(255, x))) for x in cc), lineType=cv2.LINE_AA)
        tiles.append(img)
    Image.fromarray(np.hstack(tiles)).save(outpng)
    print('preview', outpng, 'tris', len(idx))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd'); ap.add_argument('inp'); ap.add_argument('out', nargs='?')
    ap.add_argument('--tris', type=int, default=300)
    ap.add_argument('--tex', type=int, default=384, help='высота картинки, px')
    ap.add_argument('--grid', type=int, default=120, help='ячеек сетки высот по высоте')
    ap.add_argument('--front', default='+z'); ap.add_argument('--up', default='y')
    ap.add_argument('--height', type=float, default=1.0)
    ap.add_argument('--png', default=None)
    ap.add_argument('--quality', type=int, default=84)
    ap.add_argument('--agg', type=int, default=7)
    ap.add_argument('--crease', type=float, default=45)
    ap.add_argument('--mirror', action='store_true')
    ap.add_argument('--mode', default='blocks')
    ap.add_argument('--maskout', default='', help='save coverage mask (PNG data URL) into the json as mask')
    ap.add_argument('--keepdown', action='store_true')
    ap.add_argument('--rowmed', action='store_true', help='profile mode: one depth per row (cornice, plinth)')
    ap.add_argument('--mask', action='store_true', help='add alpha mask (PNG, grayscale) from model coverage')
    ap.add_argument('--med', type=int, default=3)
    ap.add_argument('--levels', type=int, default=6)
    ap.add_argument('--minarea', type=int, default=3)
    a = ap.parse_args()
    if a.cmd == 'inspect': inspect(a.inp)
    elif a.cmd == 'bake': bake(a)
    elif a.cmd == 'preview': preview(a.inp, a.out)
