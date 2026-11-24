import sys, subprocess, time, json
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(['python3', '-m', 'http.server', '8766', '--bind', '127.0.0.1', '-d', '/home/claude/maymani/gorod'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        for q in (1, 2):
            ctx = br.new_context(viewport={'width': 900, 'height': 600})
            pg = ctx.new_page()
            pg.add_init_script("localStorage.setItem('moe_gorod_gfx', JSON.stringify({q:%d,fps:false}))" % q)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto('http://127.0.0.1:8766/index.html')
            pg.wait_for_function('window.__gorod && window.__gorod.state', timeout=60000)
            time.sleep(2)
            r = pg.evaluate('''() => { const g = window.__gorod, sc = g.scene; const tri = () => sc.meshes.reduce((s, m) => s + (m.isEnabled() && m.getTotalIndices ? m.getTotalIndices() / 3 * Math.max(1, m.thinInstanceCount || 1) : 0), 0);
              const n0 = tri(), c0 = sc.meshes.length; g.buy(); g.place('res','2x2',58,58); g.finishAll(); return new Promise(res => setTimeout(() => res({before: Math.round(n0), after: Math.round(tri()), meshes: sc.meshes.length - c0, top: sc.meshes.map(m => [m.name, Math.round(m.getTotalIndices ? m.getTotalIndices() / 3 : 0), m.thinInstanceCount || 0, m.isEnabled()]).sort((a, b) => b[1] - a[1]).slice(0, 6)}), 1500)); }''')
            print('q', q, r, errs)
            ctx.close()
        br.close()
finally:
    srv.terminate()
