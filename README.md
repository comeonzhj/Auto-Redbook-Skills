# 📕 md2Redbook

> 将 Markdown 文档一键转换为精美的小红书图片卡片

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ 功能特性

- 🎨 **精美卡片** - 小红书风格的封面和正文卡片，3:4 比例，1080×1440px
- 📝 **Markdown 支持** - 完整支持标题、列表、引用、代码块、图片等元素
- 🔀 **自动分页** - 使用 `---` 分隔符自动拆分为多张卡片
- 🐍 **双语言脚本** - 提供 Python 和 Node.js 两种渲染方案
- 📤 **一键发布** - 支持直接发布到小红书（需配置 Cookie）
- 🎯 **命令行工具** - 终端直接运行，无需浏览器交互

## 📸 效果预览

| 封面卡片 | 正文卡片 |
|:---:|:---:|
| ![封面示例](https://via.placeholder.com/270x360/3450E4/ffffff?text=Cover) | ![正文示例](https://via.placeholder.com/270x360/667eea/ffffff?text=Card) |

## 🚀 快速开始

### 安装依赖

**Python 版本：**

```bash
pip install markdown pyyaml playwright python-dotenv xhs
playwright install chromium
```

**Node.js 版本：**

```bash
cd md2Redbook
npm install
npx playwright install chromium
```

### 创建 Markdown 文档

```markdown
---
emoji: "🚀"
title: "5个效率神器"
subtitle: "让工作效率翻倍"
---

## 神器一：Notion 📝

全能型笔记工具，支持数据库、看板、日历等多种视图。

---

## 神器二：Raycast ⚡

Mac 上的效率启动器，比 Spotlight 强大 100 倍！

---

#效率工具 #生产力 #神器推荐
```

### 渲染图片

**Python：**

```bash
python scripts/render_xhs.py your_note.md --output-dir ./output
```

**Node.js：**

```bash
node scripts/render_xhs.js your_note.md --output-dir ./output
```

### 输出结果

```
output/
├── cover.png      # 封面图片
├── card_1.png     # 第一张正文卡片
├── card_2.png     # 第二张正文卡片
└── ...
```

## 📖 Markdown 格式说明

### YAML 头部（封面信息）

```yaml
---
emoji: "🎯"           # 封面装饰 Emoji
title: "大标题文字"    # 不超过 15 字
subtitle: "副标题文案"  # 不超过 15 字
---
```

### 正文分页

使用 `---` 分隔线拆分为多张卡片：

```markdown
第一张卡片内容...

---

第二张卡片内容...

---

第三张卡片内容...
```

### 标签

在正文末尾添加 SEO 标签：

```markdown
#标签1 #标签2 #标签3 #标签4 #标签5
```

## 📤 发布到小红书

### 1. 配置 Cookie

复制 `env.example.txt` 为 `.env`，填入小红书 Cookie：

```bash
cp env.example.txt .env
```

编辑 `.env` 文件：

```
XHS_COOKIE=your_cookie_string_here
```

**获取 Cookie 方法：**

1. 在浏览器中登录 [小红书](https://www.xiaohongshu.com)
2. 打开开发者工具（F12）
3. 在 Network 标签中查看任意请求的 Cookie 头
4. 复制完整的 cookie 字符串

### 2. 发布笔记

```bash
python scripts/publish_xhs.py \
  --title "笔记标题" \
  --desc "笔记描述内容" \
  --images cover.png card_1.png card_2.png
```

**可选参数：**

| 参数 | 说明 |
|------|------|
| `--private` | 设为私密笔记 |
| `--post-time "2024-01-01 12:00:00"` | 定时发布 |
| `--dry-run` | 仅验证，不实际发布 |

## 🎨 自定义样式

### 修改背景渐变

编辑 `assets/card.html` 中的 `.card-container`：

```css
.card-container {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
```

**预设渐变色：**

| 名称 | 渐变值 |
|------|--------|
| 紫蓝 | `#667eea → #764ba2` |
| 粉红 | `#f093fb → #f5576c` |
| 青蓝 | `#4facfe → #00f2fe` |
| 绿色 | `#43e97b → #38f9d7` |
| 橙黄 | `#fa709a → #fee140` |

### 修改封面样式

编辑 `assets/cover.html` 中的样式。

## 📁 项目结构

```
md2Redbook/
├── SKILL.md              # 技能描述（AI Agent 使用）
├── README.md             # 项目文档
├── requirements.txt      # Python 依赖
├── package.json          # Node.js 依赖
├── env.example.txt       # Cookie 配置示例
├── assets/
│   ├── cover.html        # 封面 HTML 模板
│   ├── card.html         # 正文卡片 HTML 模板
│   ├── styles.css        # 共用样式表
│   └── example.md        # 示例 Markdown
└── scripts/
    ├── render_xhs.py     # Python 渲染脚本
    ├── render_xhs.js     # Node.js 渲染脚本
    └── publish_xhs.py    # 小红书发布脚本
```

## 🤖 作为 AI Skill 使用

本项目也是一个 AI 技能包，可以被 Claude 等 AI Agent 使用：

1. 将 `md2Redbook` 目录添加到 AI 的技能库
2. AI 会根据 `SKILL.md` 中的说明自动使用此技能
3. 当用户需要创建小红书笔记时，AI 会：
   - 撰写符合小红书风格的内容
   - 生成 Markdown 文档
   - 调用脚本渲染图片
   - （可选）发布到小红书

## ⚠️ 注意事项

1. **Cookie 安全** - Cookie 包含登录凭证，请勿泄露或提交到版本控制
2. **Cookie 有效期** - 小红书 Cookie 会过期，需定期更新
3. **发布频率** - 避免频繁发布，以免触发平台限制
4. **图片尺寸** - 渲染的图片为 1080×1440px，符合小红书推荐比例

## 🙏 致谢

- [Playwright](https://playwright.dev/) - 浏览器自动化渲染
- [Marked](https://marked.js.org/) - Markdown 解析
- [xhs](https://github.com/ReaJason/xhs) - 小红书 API 客户端

## 📄 License

MIT License © 2024
