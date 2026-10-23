# Shrimp Guard

公開互動作品網站：https://shrimp-guard.us.ci/

首頁與 `/projects/` 都是作品入口，包含時光之城、光影台灣、此刻台灣的聲音、瀏覽器 AI 實驗室、Emergence World，以及航程風浪（含沖繩上岸）。

## 建置與檢查

網站透過 GitHub Pages 的既有 `gh-pages` 分支發佈。唯一候選輸出建置器是 `scripts/build_publication.py`；不要執行 Hugo 產生發佈輸出。

- `publication/` 是不可手改的已發佈基準，內容由 `verification/baseline.json` 的 SHA-256 驗證。
- `overlays/` 提供已審查的修改。`scripts/build_projects_entry.py` 同時產生首頁與作品頁。
- `verification/remove.json` 指定退役路徑；每個刪除檔案都必須精確列在 `verification/allowlist.json` 的 `deleted`。退役內容留在 frozen baseline 作為比對依據，不會進入候選輸出。
- `.github/workflows/publication.yml` 只驗證與上傳 review artifact，不會部署。

在沒有 `public/` 的 checkout 執行；若已有輸出，先移到新的 ignored 備份位置：

```sh
python3 scripts/build_projects_entry.py
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/build_publication.py
```

可選 DOM 與瀏覽器檢查使用環境中現有的 jsdom、Playwright 與 Chromium，不新增網站依賴：

```sh
JSDOM_MODULE=/path/to/node_modules/jsdom node scripts/test_merge_dom.cjs
python3 -m http.server 8765 --directory public --bind 127.0.0.1
# 另一個 terminal：
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright BROWSER_EXECUTABLE=/path/to/chrome node scripts/browser-check.cjs
```

本次精簡內容、驗證狀態與發佈交接見 [MERGE-NOTES.md](MERGE-NOTES.md)。原發佈安全與 rollback 流程見 [PUBLICATION-REVIEW.md](PUBLICATION-REVIEW.md)。Release 需另有授權；本次未 prepare、release 或 push。
