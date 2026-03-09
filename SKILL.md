---
name: xhs-note-creator
description: 小红书笔记素材创作技能。当用户需要创建小红书笔记素材时使用这个技能。技能包含：根据用户的需求和提供的资料，撰写小红书笔记内容（标题+正文），生成图片卡片（封面+正文卡片），以及发布小红书笔记。支持 8 种精美排版主题和 4 种智能分页模式。
---

# 小红书笔记创作技能

根据用户提供的资料或需求，创作小红书笔记内容、生成精美图片卡片，并可选择发布到小红书。

> 详细参数文档见 `references/params.md`

---

## 工作流程

### 第一步：撰写小红书笔记内容

根据用户需求和资料，创作符合小红书风格的内容：

**标题**：不超过 20 字，吸引眼球，可用数字/疑问句/感叹号增强吸引力。

**正文**：段落清晰，点缀少量 Emoji（每段 1-2 个），短句短段，结尾附 5-10 个 SEO 标签。

---

### 第二步：生成渲染用 Markdown 文档

**注意：此 Markdown 专为图片渲染设计，禁止直接使用上一步的笔记正文。**

文档结构：

```markdown
---
emoji: "🚀"
title: "封面大标题（≤15字）"
subtitle: "封面副标题（≤15字）"
---

# 正文内容...

---

# 第二张卡片内容...（使用 --- 手动分隔时）
```

分页策略选择：
- 内容需精确切分 → 用 `---` 手动分隔，配合 `-m separator`
- 内容长短不稳定 → 生成普通 Markdown，使用 `-m auto-split`

---

### 第三步：渲染图片卡片

```bash
python scripts/render_xhs.py <markdown_file> [options]
```

**默认主题**：`sketch`（手绘素描风格）  
**默认分页**：`separator`（按 `---` 分隔）

常用示例：

```bash
# 默认（sketch 主题 + 手动分页）
python scripts/render_xhs.py content.md

# 自动分页（推荐内容长短不定时）
python scripts/render_xhs.py content.md -m auto-split

# 切换主题
python scripts/render_xhs.py content.md -t playful-geometric -m auto-split

# 固定尺寸自动缩放
python scripts/render_xhs.py content.md -m auto-fit
```

生成结果：`cover.png`（封面）+ `card_1.png`、`card_2.png`...（正文卡片）

**可用主题**（`-t`）：`sketch`、`default`、`playful-geometric`、`neo-brutalism`、`botanical`、`professional`、`retro`、`terminal`

**分页模式**（`-m`）：`separator`、`auto-fit`、`auto-split`、`dynamic`

> 完整参数说明见 `references/params.md`

---

### 第四步：发布小红书笔记（可选）

**前置条件**：配置好 `.env` 文件中的 `XHS_COOKIE`（详见 `references/params.md`）

```bash
# 默认仅自己可见（推荐先预览确认）
python scripts/publish_xhs.py --title "笔记标题" --desc "笔记描述" \
  --images cover.png card_1.png card_2.png

# 确认无误后公开发布
python scripts/publish_xhs.py --title "笔记标题" --desc "笔记描述" \
  --images cover.png card_1.png card_2.png --public
```

> **默认以「仅自己可见」发布**，加 `--public` 参数才会公开。

---

## 技能资源

### 脚本
- `scripts/render_xhs.py` — 渲染脚本（主推，8 主题 + 4 分页模式）
- `scripts/render_xhs_v2.py` — 渲染脚本 V2（备用，7 种渐变色彩风格）
- `scripts/publish_xhs.py` — 发布脚本

### 模板与样式
- `assets/cover.html` — 封面 HTML 模板
- `assets/card.html` — 正文卡片 HTML 模板
- `assets/styles.css` — 公共容器样式
- `assets/themes/` — 各主题 CSS 文件

### 参考文档
- `references/params.md` — 完整参数参考（主题/模式/发布参数）
