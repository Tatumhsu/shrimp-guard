# Shrimp Guard

AI 應用與發展趨勢個人研究部落格。

**網址：** https://shrimp-guard.us.ci

## 內容方向

- AI 應用案例分析
- 新工具與技術觀察
- 產業趨勢追蹤

## 技術架構

- **Hugo**（靜態網站生成器）
- **PaperMod 主題**
- **Cloudflare Pages**（托管）
- **GitHub Actions**（自動部署）

## 寫作方式

文章使用 Markdown 格式，放在 `content/posts/` 目錄。

文章開頭的 Front Matter 格式：

```yaml
---
title: "文章標題"
date: 2026-05-05
categories: ["AI 應用"]
tags: ["標籤1", "標籤2"]
description: "文章描述"
draft: false
---
```

## 本地預覽

```bash
cd /root/shrimp-guard
hugo server
```

## 部署

推送到 `main` 分支後，GitHub Actions 會自動構建並部署到 Cloudflare Pages。# 更新 Tue May  5 11:26:04 PM JST 2026
