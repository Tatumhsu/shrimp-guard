"""Generate overlays/projects/index.html (作品入口) from the reviewed list below. Static HTML, no JavaScript; motion is CSS-only (motion-prompt names #074/#079/#081/#082/#086) and off under prefers-reduced-motion.
Public cards show only purpose, login requirement, status and update date; test results live in the release report.
Run: python3 scripts/build_projects_entry.py"""
from html import escape as e
from pathlib import Path

D = 'https://dashboard.shrimp-guard.us.ci'
CHECKED = '2026-10-17'
# group: ok 可使用 / dev 開發中 / old 舊版／暫停 (collapsed) / ask 待確認 (no open button)
WORKS = [
    dict(c='live', g='ok', name='台灣此刻', pv='taiwan', desc='一個頁面看台灣上空的一切：風的流線、氣溫、降雨、PM2.5 與 48 小時預報，衛星雲圖、地震、火燒雲／觀星／雲海景點預報疊在同一張地圖；另有星空（星官與二十八宿、太空站過境）、天象曆、立體光影、天氣聲音分頁。', url=D + '/apps/taiwan/', login=True, st='運作中・整合 8 個工具', date='10/17'),
    dict(c='live', g='ok', name="God's Eye View 3D 地球", desc='開源作品（MIT）：寫實 3D 地球，即時航班、船隻、衛星、火箭發射、地震與颱風。建議用電腦開。', url=D + '/globe/', login=True, st='運作中・未加 API key（3D 建築、語音 AI 不開放）', date='10/17'),
    dict(c='ai', g='ok', name='AI 前沿日報', pv='ai-frontier', desc='每天整理 Hugging Face 熱門論文與模型、GitHub 新爆紅的 AI 開源專案，由 Claude 寫成中文解說：重點、為什麼重要、限制在哪，還有當天的趨勢總覽。', url=D + '/apps/ai-frontier/', login=True, st='運作中・可看往期', date='10/17'),
    dict(c='ai', g='dev', name='Emergence World', pv='emergence', desc='五位居民的持續運行小世界。', url='https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/', login=False, st='公開預覽', date=None),
    dict(c='ai', g='dev', name='離港前60分鐘', desc='原創手機港町探索遊戲，三種結局，可重新遊玩。目前僅限擁有者開啟。', url='https://harbor-sixty-minute-game.windy-maple-0615.chatgpt.site', login=True, access='僅擁有者 ChatGPT 帳號', btn='擁有者預覽', st='可玩測試版・私人存取', date='10/13'),
    dict(c='travel', g='ok', name='台灣鐵道', pv='rail-live', desc='一頁整合：全台每班列車此刻在哪（可切 3D 地形，山的光影跟著時間變）、週末出走找站吃美食、平溪線 3D 半日遊沙盤、台北捷運路線圖。', url=D + '/apps/rail/', login=True, st='運作中・時刻表到 12/13', date='10/17'),
    dict(c='travel', g='ok', name='航程風浪', pv='room', desc='基隆—那霸示例航程：真實日夜與預報風浪的海面。', url='/room/', login=False, st='運作中', date='10/11'),
    dict(c='travel', g='ok', name='沖繩上岸', of='航程風浪裡的分頁', desc='依目前位置排序那霸景點與美食，附導航。', url='/room/#landing', login=False, sub=True, st='運作中', date='10/11'),
    dict(c='food', g='ok', name='美食大蒐集', pv='food-map', desc='全台 20,615 家店：即時搜尋、推薦、隱藏美食、夜市入口。', url=D + '/food-map/', login=True, st='運作中・每月自動更新', date='10/10'),
    dict(c='money', g='ok', name='LIFE COMPASS', desc='台股 ETF 持股、配息現金流、目標與研究紀錄。', url=D + '/one-life/', login=True, st='正式版運作中', date='10/11'),
    dict(c='money', g='ok', name='台股小鎮', of='LIFE COMPASS 裡的分頁', desc='四檔持股變成四間店：成交金額影響人潮，法人買賣成為門口隊伍。收盤資料示意動畫。', url=D + '/one-life/#town', login=True, sub=True, st='運作中', date='10/11'),
    dict(c='money', g='ok', name='Fund Manager', desc='Bybit 紙上交易帳本與 AI 決策紀錄（不下真單）。', url=D + '/fund-manager/', login=True, st='V1 紙上帳本運作中・V2 300U 已停止', date='10/12'),
    dict(c='tools', g='ok', name='VPS 狀態', desc='主機磁碟、記憶體、服務、排程、容器，以及一鍵檢查所有作品網址。', url=D + '/apps/vps/', login=True, st='運作中', date='10/17'),
    dict(c='tools', g='ok', name='Shrimp Guard 部落格', pv='blog', desc='AI 應用趨勢與台股觀察文章。', url='/', login=False, st='可瀏覽', date='05/14'),
]
GROUPS = [('ok', '可使用'), ('dev', '開發中'), ('old', '舊版／暫停')]  # status, shown as a tag on each card
CATS = [('live', '台灣即時'), ('ai', 'AI 前沿與實驗'), ('travel', '交通與旅行'), ('food', '美食'), ('money', '投資理財'), ('tools', '工具與文章')]
assert all(w['c'] in dict(CATS) for w in WORKS) and all((w['c'] == 'old') == (w['g'] == 'old') for w in WORKS)

CSS = """
:root{color-scheme:light dark;--bg:#fff;--card:#fff;--ink:#1d1e20;--ink2:#5b5e66;--ink3:#7d8087;--line:#e3e4e8;--chip:#f2f3f5;--ok:#1d7f46;--dev:#9a5c00;--old:#6c6f77;--ask:#5b43b0;--lock:#7a5000;--pub:#0a5f85}
@media (prefers-color-scheme:dark){:root{--bg:#1d1e20;--card:#26272b;--ink:#dadadb;--ink2:#b0b2b7;--ink3:#8c8f96;--line:#38393e;--chip:#313237;--ok:#57c785;--dev:#e3a23a;--old:#a3a6ad;--ask:#ad98f2;--lock:#e5b864;--pub:#64bde4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif;line-height:1.55}
.shell{max-width:1000px;margin:auto;padding:20px 16px 40px}
nav.top{display:flex;justify-content:space-between;align-items:center}nav.top a{color:var(--ink);padding:10px 0;text-decoration:underline;text-underline-offset:4px}
h1{font-size:clamp(28px,5vw,40px);margin:18px 0 6px}.intro{color:var(--ink2);margin:0;font-size:15px}
.jump{position:sticky;top:0;z-index:2;background:var(--bg);display:flex;gap:8px;overflow-x:auto;padding:10px 0;margin-top:12px;border-bottom:1px solid var(--line)}
.jump a{flex:none;font-size:14px;padding:7px 12px;border-radius:999px;background:var(--chip);color:var(--ink);text-decoration:none;white-space:nowrap}
section{scroll-margin-top:60px}h2{font-size:18px;margin:26px 0 10px;padding-left:10px;border-left:4px solid var(--ink)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
.card.sub{border-style:dashed}
.name{font-size:18px;font-weight:700;margin:0}.of{font-size:12.5px;color:var(--ink3);font-weight:400;margin-left:6px}
.desc{font-size:14px;color:var(--ink2);margin:0}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin:0;padding:0;list-style:none}
.tags li{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--chip);color:var(--ink2)}
.tags .pub{color:var(--pub)}.tags .lock{color:var(--lock)}.tags .ok{color:var(--ok)}.tags .dev{color:var(--dev)}.tags .old{color:var(--old)}.tags .ask{color:var(--ask)}.tags .test{color:var(--dev);font-weight:700}
.st{font-size:13px;color:var(--ink2);margin:0}.st time{color:var(--ink3);margin-left:6px}
.open{margin:2px 0 0}.open a{display:inline-block;padding:8px 0;color:var(--ink);font-weight:700;text-decoration:underline;text-underline-offset:4px}
details{border:1px solid var(--line);border-radius:12px;background:var(--card)}
summary{cursor:pointer;padding:14px 16px;font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center}
summary::-webkit-details-marker{display:none}summary::after{content:"展開 ▾";font-size:13px;font-weight:500;color:var(--ink2)}details[open] summary::after{content:"收合 ▴"}
details .grid{padding:0 12px 12px}
footer{margin-top:28px;font-size:13px;color:var(--ink3);line-height:1.8}
a:focus-visible,summary:focus-visible{outline:3px solid #6797c0;outline-offset:4px}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
.pv{display:block;margin:-14px -16px 4px;border-radius:12px 12px 0 0;overflow:hidden;aspect-ratio:8/5;background:var(--chip)}
.pv img{display:block;width:100%;height:100%;object-fit:cover}
.progress{position:fixed;left:0;top:0;height:3px;width:100%;background:var(--ok);transform-origin:0 50%;transform:scaleX(0);z-index:5}
@media (prefers-reduced-motion:no-preference){
  /* #081 hover lift: up 8 px, shadow blur 6→22 px, 0.3 s ease-out */
  .card{transition:transform .3s cubic-bezier(.22,.9,.3,1),box-shadow .3s cubic-bezier(.22,.9,.3,1);box-shadow:0 2px 6px rgba(28,35,51,.08)}
  .card:hover{transform:translateY(-8px);box-shadow:0 12px 22px rgba(28,35,51,.22)}
  /* #082 image zoom on hover: fixed frame, picture to 1.06× over 0.5 s */
  .pv img{transition:transform .5s cubic-bezier(.22,.9,.3,1)}.card:hover .pv img{transform:scale(1.06)}
  /* #086 underline animation: grows from the left in 0.3 s */
  .open a{text-decoration:none;background:linear-gradient(currentColor,currentColor) 0 100%/30% 2px no-repeat;transition:background-size .3s ease-out}
  .open a:hover,.open a:focus-visible{background-size:100% 2px}
  @supports (animation-timeline:view()){
    /* #074 fade-in on scroll: up from 30 px as each card enters */
    .card{animation:rise linear both;animation-timeline:view();animation-range:entry 0% entry 35%}
    @keyframes rise{from{opacity:0;translate:0 30px}to{opacity:1;translate:0 0}}
    /* #079 scroll progress bar */
    .progress{animation:grow linear both;animation-timeline:scroll(root)}
    @keyframes grow{to{transform:scaleX(1)}}
  }
}
@media (prefers-reduced-motion:reduce){.progress{display:none}}
"""
LABEL = dict(GROUPS)


def card(w):
    tags = []
    if w.get('url'):
        tags.append(f'<li class="lock">{e(w.get("access", "需要登入"))}</li>' if w.get('login') else '<li class="pub">公開</li>')
    if w.get('test'):
        tags.append('<li class="test">測試資料</li>')
    tags.append(f'<li class="{w["g"]}">{LABEL[w["g"]]}</li>')
    of = f'<span class="of">{e(w["of"])}</span>' if w.get('of') else ''
    pv = ''
    if w.get('pv'):   # looping preview (motion-prompt idea: every item shows itself moving); still poster when reduced motion is asked
        pv = (f'<picture class="pv"><source media="(prefers-reduced-motion: reduce)" srcset="previews/{w["pv"]}.poster.webp">'
              f'<img src="previews/{w["pv"]}.webp" width="480" height="300" loading="lazy" decoding="async" alt="{e(w["name"])} 畫面預覽"></picture>')
    out = [f'<article class="card{" sub" if w.get("sub") else ""}{" has-pv" if pv else ""}">', pv, f'<h3 class="name">{e(w["name"])}{of}</h3>', f'<p class="desc">{e(w["desc"])}</p>',
           f'<ul class="tags">{"".join(tags)}</ul>', f'<p class="st">{e(w["st"])}<time>{"更新 " + e(w["date"]) if w.get("date") else "更新日期未確認"}</time></p>']
    if w.get('url'):
        label = e(w['btn']) if w.get('btn') else f"{'開啟預覽' if w['g'] == 'dev' else '開啟'} {e(w['name'])}"
        out.append(f'<p class="open"><a href="{e(w["url"])}">{label} →</a></p>')
    out.append('</article>')
    return ''.join(out)


def build():
    jump, body = [], []
    for c, label in CATS:
        items = sorted((w for w in WORKS if w['c'] == c), key=lambda w: w['g'] != 'ok')  # usable first, sub-pages stay after their parent
        jump.append(f'<a href="#{c}">{label} {len(items)}</a>')
        grid = f'<div class="grid">{"".join(card(w) for w in items)}</div>'
        head = f'<h2>{label}</h2>'
        if c == 'old':
            grid = f'<details><summary>{len(items)} 項舊版、暫停與退役作品</summary>{grid}</details>'
        body.append(f'<section id="{c}" aria-label="{label}">{head}{grid}</section>')
    return ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>作品入口 · Shrimp Guard</title><meta name="description" content="Shrimp Guard 所有作品與目前狀態。">'
            f'<style>{CSS}</style></head><body><div class="progress" aria-hidden="true"></div><div class="shell"><nav class="top" aria-label="網站導覽"><a href="/">Shrimp Guard</a><a href="/">返回主站</a></nav>'
            '<main><h1>作品入口</h1><p class="intro">所有作品依主題分類，每張卡片標出目前狀態。「需要登入」的作品沿用網站原有帳號；「僅擁有者 ChatGPT 帳號」為私人預覽，訪客無法開啟。</p>'
            f'<nav class="jump" aria-label="分類">{"".join(jump)}</nav>{"".join(body)}</main>'
            f'<footer>狀態核對日 {CHECKED}。「需要登入」沿用網站原有帳號；「僅擁有者 ChatGPT 帳號」僅限作品擁有者登入預覽。本頁不變更登入方式。</footer></div></body></html>\n')


if __name__ == '__main__':
    out = Path(__file__).resolve().parents[1] / 'overlays' / 'projects' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding='utf-8')
    print(out, sum(1 for w in WORKS if w.get('url')), 'links', {c: sum(1 for w in WORKS if w['c'] == c) for c, _ in CATS})
