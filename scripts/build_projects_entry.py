"""Generate overlays/projects/index.html (作品入口) from the reviewed list below. Static HTML, no JavaScript.
Public cards show only purpose, login requirement, status and update date; test results live in the release report.
Run: python3 scripts/build_projects_entry.py"""
from html import escape as e
from pathlib import Path

D = 'https://dashboard.shrimp-guard.us.ci'
CHECKED = '2026-10-13'
# group: ok 可使用 / dev 開發中 / old 舊版／暫停 (collapsed) / ask 待確認 (no open button)
WORKS = [
    dict(g='ok', name='LIFE COMPASS', desc='台股 ETF 持股、配息現金流、目標與研究紀錄。', url=D + '/one-life/', login=True, st='正式版運作中', date='10/11'),
    dict(g='ok', name='台股小鎮', of='LIFE COMPASS 裡的分頁', desc='四檔持股變成四間店：成交金額影響人潮，法人買賣成為門口隊伍。收盤資料示意動畫。', url=D + '/one-life/#town', login=True, sub=True, st='運作中', date='10/11'),
    dict(g='ok', name='航程風浪', desc='基隆—那霸示例航程：真實日夜與預報風浪的海面。', url='/room/', login=False, st='運作中', date='10/11'),
    dict(g='ok', name='沖繩上岸', of='航程風浪裡的分頁', desc='依目前位置排序那霸景點與美食，附導航。', url='/room/#landing', login=False, sub=True, st='運作中', date='10/11'),
    dict(g='ok', name='美食大蒐集', desc='全台 20,615 家店：即時搜尋、推薦、隱藏美食、夜市入口。', url=D + '/food-map/', login=True, st='運作中・每月自動更新', date='10/10'),
    dict(g='ok', name='鐵道出走沙盤', desc='平溪線半日鐵道旅行 3D 規劃。', url=D + '/rail-trip/', login=True, st='運作中・時刻表每日自動更新', date='10/07'),
    dict(g='ok', name='Fund Manager', desc='Bybit 紙上交易帳本與 AI 決策紀錄（不下真單）。', url=D + '/fund-manager/', login=True, st='V1 紙上帳本運作中・V2 300U 已停止', date='10/12'),
    dict(g='ok', name='台北捷運路線圖', desc='台北捷運路線與站點圖。', url='/taipei-mrt/', login=False, st='可瀏覽', date='07/14'),
    dict(g='ok', name='Shrimp Guard 部落格', desc='AI 應用趨勢與台股觀察文章。', url='/', login=False, st='可瀏覽', date='05/14'),
    dict(g='dev', name='LIFE COMPASS 雲端測試版', of='LIFE COMPASS 的版本', desc='雲端遷移測試，使用測試資料，不是正式個人資料。', url='https://life-compass.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/', login=False, test=True, st='測試中', date='10/12'),
    dict(g='dev', name='Emergence World', desc='五位居民的持續運行小世界。', url='https://emergence-world-preview.httpsmulticlawmoltidworkersdevcmolt32c002a10b29b0e3ad3.workers.dev/', login=False, st='公開預覽', date=None),
    dict(g='dev', name='離港前60分鐘', desc='原創手機港町探索遊戲，三種結局，可重新遊玩。目前僅限擁有者開啟。', url='https://harbor-sixty-minute-game.windy-maple-0615.chatgpt.site', login=True, access='僅擁有者 ChatGPT 帳號', btn='擁有者預覽', st='可玩測試版・私人存取', date='10/13'),
    dict(g='dev', name='Technology Tycoon', desc='AI 經營的科技公司模擬，一天等於遊戲一個月。', url=None, st='開發中・尚無可用預覽', date='10/08'),
    dict(g='old', name='小王國', desc='手機王國遊戲（建設村莊、發布懸賞、英雄自行出任務）。', url=None, st='暫停・素材成果保留', date='10/12'),
    dict(g='old', name='世界與我', desc='原入口保留中。', url='/world-impact/', login=False, st='保留中', date='10/08'),
    dict(g='old', name='美食大蒐集（公開版）', of='美食大蒐集的版本', desc='曾規劃的 GitHub Pages 公開版本。', url=None, st='暫停・正式版在美食大蒐集', date='10/10'),
    dict(g='old', name='ONE LIFE ／ AI Resident', desc='生活角色實驗，網址已由 LIFE COMPASS 接手。', url=None, st='已退役', date='10/01'),
    dict(g='old', name='AI COMMONS ／ Latticefolk', desc='多模型社群與 AI 生活世界實驗。', url=None, st='已退役', date='09/30'),
    dict(g='old', name='Fund Manager V2 300U', of='Fund Manager 的版本', desc='300 USDT 雙向持倉紙上帳本。', url=None, st='已停止・紀錄可在 Fund Manager 查看', date='10/12'),
    dict(g='ask', name='實驗槽 B', desc='目前是空白佔位頁。', url=None, st='用途待決定・暫不提供入口', date='10/01'),
    dict(g='ask', name='全球地震監控', desc='地震即時監控頁，尚未上線。', url=None, st='暫不提供入口', date='08/10'),
    dict(g='ask', name='Studio 001', desc='預覽頁，尚未上線。', url=None, st='用途待決定・暫不提供入口', date='09/08'),
]
GROUPS = [('ok', '可使用'), ('dev', '開發中'), ('old', '舊版／暫停'), ('ask', '待確認')]
assert not [w for w in WORKS if w['g'] == 'ask' and w['url']], '待確認項不可有開啟按鈕'

CSS = """
:root{color-scheme:light dark;--bg:#fff;--card:#fff;--ink:#1d1e20;--ink2:#5b5e66;--ink3:#7d8087;--line:#e3e4e8;--chip:#f2f3f5;--ok:#1d7f46;--dev:#9a5c00;--old:#6c6f77;--ask:#5b43b0;--lock:#7a5000;--pub:#0a5f85}
@media (prefers-color-scheme:dark){:root{--bg:#1d1e20;--card:#26272b;--ink:#dadadb;--ink2:#b0b2b7;--ink3:#8c8f96;--line:#38393e;--chip:#313237;--ok:#57c785;--dev:#e3a23a;--old:#a3a6ad;--ask:#ad98f2;--lock:#e5b864;--pub:#64bde4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif;line-height:1.55}
.shell{max-width:1000px;margin:auto;padding:20px 16px 40px}
nav.top{display:flex;justify-content:space-between;align-items:center}nav.top a{color:var(--ink);padding:10px 0;text-decoration:underline;text-underline-offset:4px}
h1{font-size:clamp(28px,5vw,40px);margin:18px 0 6px}.intro{color:var(--ink2);margin:0;font-size:15px}
.jump{position:sticky;top:0;z-index:2;background:var(--bg);display:flex;gap:8px;overflow-x:auto;padding:10px 0;margin-top:12px;border-bottom:1px solid var(--line)}
.jump a{flex:none;font-size:14px;padding:7px 12px;border-radius:999px;background:var(--chip);color:var(--ink);text-decoration:none;white-space:nowrap}
section{scroll-margin-top:60px}h2{display:flex;align-items:center;gap:8px;font-size:18px;margin:24px 0 10px}h2 i{width:10px;height:10px;border-radius:50%;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
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
"""
COLOR = dict(ok='var(--ok)', dev='var(--dev)', old='var(--old)', ask='var(--ask)')
LABEL = dict(GROUPS)


def card(w):
    tags = []
    if w.get('url'):
        tags.append(f'<li class="lock">{e(w.get("access", "需要登入"))}</li>' if w.get('login') else '<li class="pub">公開</li>')
    if w.get('test'):
        tags.append('<li class="test">測試資料</li>')
    tags.append(f'<li class="{w["g"]}">{LABEL[w["g"]]}</li>')
    of = f'<span class="of">{e(w["of"])}</span>' if w.get('of') else ''
    out = [f'<article class="card{" sub" if w.get("sub") else ""}">', f'<h3 class="name">{e(w["name"])}{of}</h3>', f'<p class="desc">{e(w["desc"])}</p>',
           f'<ul class="tags">{"".join(tags)}</ul>', f'<p class="st">{e(w["st"])}<time>{"更新 " + e(w["date"]) if w.get("date") else "更新日期未確認"}</time></p>']
    if w.get('url'):
        label = e(w['btn']) if w.get('btn') else f"{'開啟預覽' if w['g'] == 'dev' else '開啟'} {e(w['name'])}"
        out.append(f'<p class="open"><a href="{e(w["url"])}">{label} →</a></p>')
    out.append('</article>')
    return ''.join(out)


def build():
    jump, body = [], []
    for g, label in GROUPS:
        items = [w for w in WORKS if w['g'] == g]
        jump.append(f'<a href="#{g}">{label} {len(items)}</a>')
        grid = f'<div class="grid">{"".join(card(w) for w in items)}</div>'
        head = f'<h2><i style="background:{COLOR[g]}"></i>{label}</h2>'
        if g == 'old':
            grid = f'<details><summary>{len(items)} 項舊版與暫停作品</summary>{grid}</details>'
        body.append(f'<section id="{g}" aria-label="{label}">{head}{grid}</section>')
    return ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>作品入口 · Shrimp Guard</title><meta name="description" content="Shrimp Guard 所有作品與目前狀態。">'
            f'<style>{CSS}</style></head><body><div class="shell"><nav class="top" aria-label="網站導覽"><a href="/">Shrimp Guard</a><a href="/">返回主站</a></nav>'
            '<main><h1>作品入口</h1><p class="intro">所有作品與目前狀態。「需要登入」的作品沿用網站原有帳號；「僅擁有者 ChatGPT 帳號」為私人預覽，訪客無法開啟。</p>'
            f'<nav class="jump" aria-label="分類">{"".join(jump)}</nav>{"".join(body)}</main>'
            f'<footer>狀態核對日 {CHECKED}。「需要登入」沿用網站原有帳號；「僅擁有者 ChatGPT 帳號」僅限作品擁有者登入預覽。本頁不變更登入方式。待確認項目暫不提供入口。</footer></div></body></html>\n')


if __name__ == '__main__':
    out = Path(__file__).resolve().parents[1] / 'overlays' / 'projects' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding='utf-8')
    print(out, sum(1 for w in WORKS if w.get('url')), 'links', {g: sum(1 for w in WORKS if w['g'] == g) for g, _ in GROUPS})
