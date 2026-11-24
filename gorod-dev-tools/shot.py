# usage: python3 -I shot.py OUTPREFIX [cat size dist era]
# Serves /home/claude/maymani/gorod, builds one finished building at the map centre and saves screenshots from 4 yaws.
import sys, subprocess, time, json, os
from playwright.sync_api import sync_playwright
out = sys.argv[1]; cat = sys.argv[2] if len(sys.argv) > 2 else 'res'; size = sys.argv[3] if len(sys.argv) > 3 else '2x2'
dist = float(sys.argv[4]) if len(sys.argv) > 4 else 5.0; era = int(sys.argv[5]) if len(sys.argv) > 5 else 0
srv = subprocess.Popen(['python3', '-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', '/home/claude/maymani/gorod'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        DSF = float(os.environ.get('DSF', '1'))
        pg = br.new_page(viewport={'width': 1100, 'height': 760}, device_scale_factor=DSF)
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
        pg.goto('http://127.0.0.1:8765/index.html')
        pg.wait_for_function('window.__gorod && window.__gorod.state', timeout=60000)
        time.sleep(2)
        info = pg.evaluate('''([cat,size,dist,era]) => {
          const g = window.__gorod; const N = g.size();
          if (era) g.setEra(era);
          const x = Math.floor(N/2) + 8, z = Math.floor(N/2) + 8;
          try { g.buy(); } catch(e) {}
          g.place(cat, size, x, z); g.finishAll();
          const L = document.getElementById('loading'); if (L) L.style.display='none';
          document.querySelectorAll('.modal,#modal,.overlay').forEach(e=>e.style.display='none');
          const b = g.state().buildings.filter(q => q.x === x && q.z === z)[0];
          return {N, x, z, b: b && {id:b.id, cat:b.cat, size:b.size, x:b.x, z:b.z}};
        }''', [cat, size, dist, era])
        print(info)
        for name, yaw in (('f', 0.0), ('r', 1.5707963), ('b', 3.1415926), ('l', 4.712389)):
            pg.evaluate('''([yaw,dist,info]) => { const g = window.__gorod; const c = g.cam; c.yaw = yaw + Math.PI/4*0; c.tx = info.x + 1 - info.N/2; c.tz = info.z + 1 - info.N/2; c.dist = dist; g.updateCam(); }''', [yaw, dist, info])
            time.sleep(1.5)
            clip = json.loads(os.environ['CLIP']) if os.environ.get('CLIP') else None
            pg.screenshot(path=f'{out}_{name}.png', clip=clip)
        print('\n'.join(logs[:20]))
        br.close()
finally:
    srv.terminate()
