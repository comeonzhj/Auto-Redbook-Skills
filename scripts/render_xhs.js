#!/usr/bin/env node
/**
 * 小红书卡片渲染脚本 - Node.js 增强版
 * 支持多种排版样式和智能分页策略
 * 
 * 使用方法:
 *     node render_xhs.js <markdown_file> [options]
 * 
 * 选项:
 *     --output-dir, -o     输出目录（默认为当前工作目录）
 *     --theme, -t          排版主题：default, playful-geometric, neo-brutalism, 等
 *     --mode, -m           分页模式：separator, auto-fit, auto-split, dynamic
 *     --width, -w          图片宽度（默认 1080）
 *     --height, -h         图片高度（默认 1440）
 *     --dpr                设备像素比（默认 2）
 * 
 * 依赖安装:
 *     npm install marked yaml playwright
 *     npx playwright install chromium
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const yaml = require('yaml');
const { chromium } = require('playwright');

// 获取脚本所在目录
const SCRIPT_DIR = path.dirname(__dirname);
const ASSETS_DIR = path.join(SCRIPT_DIR, 'assets');
const THEMES_DIR = path.join(ASSETS_DIR, 'themes');

// 默认卡片尺寸配置 (3:4 比例)
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1440;
const MAX_HEIGHT = 2160;

// 可用主题列表
const AVAILABLE_THEMES = [
    'default',
    'playful-geometric',
    'neo-brutalism',
    'botanical',
    'professional',
    'retro',
    'terminal',
    'sketch'
];

// 分页模式
const PAGING_MODES = ['separator', 'auto-fit', 'auto-split', 'dynamic'];

// 主题背景色
const THEME_BACKGROUNDS = {
    'default': 'linear-gradient(180deg, #f3f3f3 0%, #f9f9f9 100%)',
    'playful-geometric': 'linear-gradient(135deg, #8B5CF6 0%, #F472B6 100%)',
    'neo-brutalism': 'linear-gradient(135deg, #FF4757 0%, #FECA57 100%)',
    'botanical': 'linear-gradient(135deg, #4A7C59 0%, #8FBC8F 100%)',
    'professional': 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)',
    'retro': 'linear-gradient(135deg, #D35400 0%, #F39C12 100%)',
    'terminal': 'linear-gradient(135deg, #0D1117 0%, #161B22 100%)',
    'sketch': 'linear-gradient(135deg, #555555 0%, #888888 100%)'
};

// 封面标题文字渐变（随主题变化）
const THEME_TITLE_GRADIENTS = {
    'default': 'linear-gradient(180deg, #111827 0%, #4B5563 100%)',
    'playful-geometric': 'linear-gradient(180deg, #7C3AED 0%, #F472B6 100%)',
    'neo-brutalism': 'linear-gradient(180deg, #000000 0%, #FF4757 100%)',
    'botanical': 'linear-gradient(180deg, #1F2937 0%, #4A7C59 100%)',
    'professional': 'linear-gradient(180deg, #1E3A8A 0%, #2563EB 100%)',
    'retro': 'linear-gradient(180deg, #8B4513 0%, #D35400 100%)',
    'terminal': 'linear-gradient(180deg, #39D353 0%, #58A6FF 100%)',
    'sketch': 'linear-gradient(180deg, #111827 0%, #6B7280 100%)',
};

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        markdownFile: null,
        outputDir: process.cwd(),
        theme: 'default',
        mode: 'separator',
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        maxHeight: MAX_HEIGHT,
        dpr: 2
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];

        switch (arg) {
            case '--output-dir':
            case '-o':
                options.outputDir = nextArg;
                i++;
                break;
            case '--theme':
            case '-t':
                options.theme = nextArg;
                i++;
                break;
            case '--mode':
            case '-m':
                options.mode = nextArg;
                i++;
                break;
            case '--width':
            case '-w':
                options.width = parseInt(nextArg);
                i++;
                break;
            case '--height':
                options.height = parseInt(nextArg);
                i++;
                break;
            case '--max-height':
                options.maxHeight = parseInt(nextArg);
                i++;
                break;
            case '--dpr':
                options.dpr = parseInt(nextArg);
                i++;
                break;
            case '--help':
                printHelp();
                process.exit(0);
            default:
                if (!arg.startsWith('-')) {
                    options.markdownFile = arg;
                }
        }
    }

    return options;
}

/**
 * 打印帮助信息
 */
function printHelp() {
    console.log(`
小红书卡片渲染脚本 - Node.js 版本

使用方法:
    node render_xhs.js <markdown_file> [options]

选项:
    --output-dir, -o     输出目录（默认为当前工作目录）
    --theme, -t          排版主题
    --mode, -m           分页模式
    --width, -w          图片宽度（默认 1080）
    --height             图片高度（默认 1440）
    --max-height         最大高度（默认 2160）
    --dpr                设备像素比（默认 2）

可用主题: ${AVAILABLE_THEMES.join(', ')}
分页模式: ${PAGING_MODES.join(', ')}
`);
}

/**
 * 解析 Markdown 文件
 */
function parseMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // 解析 YAML 头部
    const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    
    let metadata = {};
    let body = content;
    
    if (yamlMatch) {
        try {
            metadata = yaml.parse(yamlMatch[1]) || {};
        } catch (e) {
            metadata = {};
        }
        body = content.slice(yamlMatch[0].length);
    }
    
    return { metadata, body: body.trim() };
}

/**
 * 按分隔符拆分内容
 */
function splitContentBySeparator(body) {
    const parts = body.split(/\n---+\n/);
    return parts.map(p => p.trim()).filter(p => p);
}

/**
 * 加载主题 CSS
 */
function loadThemeCss(theme) {
    const themeFile = path.join(THEMES_DIR, `${theme}.css`);
    if (fs.existsSync(themeFile)) {
        return fs.readFileSync(themeFile, 'utf-8');
    }
    const defaultFile = path.join(THEMES_DIR, 'default.css');
    if (fs.existsSync(defaultFile)) {
        return fs.readFileSync(defaultFile, 'utf-8');
    }
    return '';
}

/**
 * 生成封面 HTML
 */
function generateCoverHtml(metadata, theme, width, height) {
    const emoji = metadata.emoji || '📝';
    let title = metadata.title || '标题';
    let subtitle = metadata.subtitle || '';
    
    if (title.length > 15) title = title.slice(0, 15);
    if (subtitle.length > 15) subtitle = subtitle.slice(0, 15);
    
    const bg = THEME_BACKGROUNDS[theme] || THEME_BACKGROUNDS['default'];
    const titleBg = THEME_TITLE_GRADIENTS[theme] || THEME_TITLE_GRADIENTS['default'];
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${width}, height=${height}">
    <title>小红书封面</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Noto Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            width: ${width}px;
            height: ${height}px;
            overflow: hidden;
        }
        
        .cover-container {
            width: ${width}px;
            height: ${height}px;
            background: ${bg};
            position: relative;
            overflow: hidden;
        }
        
        .cover-inner {
            position: absolute;
            width: ${Math.floor(width * 0.88)}px;
            height: ${Math.floor(height * 0.91)}px;
            left: ${Math.floor(width * 0.06)}px;
            top: ${Math.floor(height * 0.045)}px;
            background: #F3F3F3;
            border-radius: 25px;
            display: flex;
            flex-direction: column;
            padding: ${Math.floor(width * 0.074)}px ${Math.floor(width * 0.079)}px;
        }
        
        .cover-emoji {
            font-size: ${Math.floor(width * 0.167)}px;
            line-height: 1.2;
            margin-bottom: ${Math.floor(height * 0.035)}px;
        }
        
        .cover-title {
            font-weight: 900;
            font-size: ${Math.floor(width * 0.12)}px;
            line-height: 1.4;
            background: ${titleBg};
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            flex: 1;
            display: flex;
            align-items: flex-start;
            word-break: break-all;
        }
        
        .cover-subtitle {
            font-weight: 350;
            font-size: ${Math.floor(width * 0.067)}px;
            line-height: 1.4;
            color: #000000;
            margin-top: auto;
        }
    </style>
</head>
<body>
    <div class="cover-container">
        <div class="cover-inner">
            <div class="cover-emoji">${emoji}</div>
            <div class="cover-title">${title}</div>
            <div class="cover-subtitle">${subtitle}</div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * 将 Markdown/HTML 中的本地图片内联为 base64 data URI
 * （page.setContent 的页面是 about:blank，Chromium 禁止其加载 file:// 资源，
 *   绝对路径也无效；内联 base64 是唯一稳妥方案）
 */
function rewriteLocalImages(md, baseDir) {
    const toDataUri = (p) => {
        if (/^(https?:|data:|file:)/i.test(p)) return p;
        const abs = path.resolve(baseDir, p);
        try {
            const buf = fs.readFileSync(abs);
            const ext = path.extname(abs).toLowerCase();
            const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                : ext === '.webp' ? 'image/webp'
                : ext === '.svg' ? 'image/svg+xml'
                : 'image/png';
            return `data:${mime};base64,` + buf.toString('base64');
        } catch (e) {
            console.warn('  ⚠️ 图片读取失败:', p);
            return p;
        }
    };
    let out = md.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, a, p, b) => a + toDataUri(p) + b);
    out = out.replace(/(src=["'])([^"']+)(["'])/g, (m, a, p, b) => a + toDataUri(p) + b);
    return out;
}

/**
 * 生成正文卡片 HTML
 */
function generateCardHtml(content, theme, pageNumber, totalPages, width, height, mode, mdDir) {
    const htmlContent = marked.parse(rewriteLocalImages(content, mdDir || '.'));
    const themeCss = loadThemeCss(theme);
    const pageText = totalPages > 1 ? `${pageNumber}/${totalPages}` : '';
    const bg = THEME_BACKGROUNDS[theme] || THEME_BACKGROUNDS['default'];
    
    let containerStyle, innerStyle, contentStyle;
    
    if (mode === 'auto-fit') {
        containerStyle = `
            width: ${width}px;
            height: ${height}px;
            background: ${bg};
            position: relative;
            padding: 50px;
            overflow: hidden;
        `;
        innerStyle = `
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 60px;
            height: calc(${height}px - 100px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        contentStyle = 'flex: 1; overflow: hidden;';
    } else if (mode === 'dynamic') {
        containerStyle = `
            width: ${width}px;
            min-height: ${height}px;
            background: ${bg};
            position: relative;
            padding: 50px;
        `;
        innerStyle = `
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 60px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
        `;
        contentStyle = '';
    } else {
        containerStyle = `
            width: ${width}px;
            min-height: ${height}px;
            background: ${bg};
            position: relative;
            padding: 50px;
            overflow: hidden;
        `;
        innerStyle = `
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 60px;
            min-height: calc(${height}px - 100px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
        `;
        contentStyle = '';
    }
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${width}">
    <title>小红书卡片</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Noto Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            width: ${width}px;
            overflow: hidden;
            background: transparent;
        }
        
        .card-container { ${containerStyle} }
        .card-inner { ${innerStyle} }
        .card-content { line-height: 1.7; ${contentStyle} }
        /* auto-fit 用：对整个内容块做 transform 缩放 */
        .card-content-scale { transform-origin: top left; will-change: transform; }
        
        ${themeCss}
        
        .page-number {
            position: absolute;
            bottom: 80px;
            right: 80px;
            font-size: 36px;
            color: rgba(255, 255, 255, 0.8);
            font-weight: 500;
        }
    </style>
</head>
<body>
    <div class="card-container">
        <div class="card-inner">
            <div class="card-content">
                <div class="card-content-scale">
                    ${htmlContent}
                </div>
            </div>
        </div>
        <div class="page-number">${pageText}</div>
    </div>
</body>
</html>`;
}

/**
 * 渲染 HTML 为图片
 */
async function renderHtmlToImage(htmlContent, outputPath, width, height, mode, maxHeight, dpr) {
    const browser = await chromium.launch();
    const viewportHeight = mode !== 'dynamic' ? height : maxHeight;
    const page = await browser.newPage({
        viewport: { width, height: viewportHeight },
        deviceScaleFactor: dpr
    });
    
    await page.setContent(htmlContent);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    
    let actualHeight;
    
    if (mode === 'auto-fit') {
        await page.evaluate(() => {
            const viewportContent = document.querySelector('.card-content');
            const scaleEl = document.querySelector('.card-content-scale');
            if (!viewportContent || !scaleEl) return;

            // reset
            scaleEl.style.transform = 'none';
            scaleEl.style.width = '';
            scaleEl.style.height = '';

            const availableWidth = viewportContent.clientWidth;
            const availableHeight = viewportContent.clientHeight;

            const rect = scaleEl.getBoundingClientRect();
            const contentWidth = Math.max(scaleEl.scrollWidth, rect.width);
            const contentHeight = Math.max(scaleEl.scrollHeight, rect.height);

            if (!contentWidth || !contentHeight || !availableWidth || !availableHeight) return;

            const scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);

            // expand layout box to avoid clip
            scaleEl.style.width = (availableWidth / scale) + 'px';

            scaleEl.style.transformOrigin = 'top left';
            scaleEl.style.transform = `translate(0px, 0px) scale(${scale})`;
        });
        await page.waitForTimeout(100);
        actualHeight = height;
    } else if (mode === 'dynamic') {
        const contentHeight = await page.evaluate(() => {
            const container = document.querySelector('.card-container');
            return container ? container.scrollHeight : document.body.scrollHeight;
        });
        actualHeight = Math.max(height, Math.min(contentHeight, maxHeight));
    } else {
        const contentHeight = await page.evaluate(() => {
            const container = document.querySelector('.card-container');
            return container ? container.scrollHeight : document.body.scrollHeight;
        });
        actualHeight = Math.max(height, contentHeight);
    }
    
    await page.screenshot({
        path: outputPath,
        clip: { x: 0, y: 0, width, height: actualHeight },
        type: 'png'
    });
    
    await browser.close();
    console.log(`  ✅ 已生成: ${outputPath} (${width}x${actualHeight})`);
    return actualHeight;
}

/**
 * 主渲染函数
 */
async function renderMarkdownToCards(options) {
    const { markdownFile, outputDir, theme, mode, width, height, maxHeight, dpr } = options;
    
    console.log(`\n🎨 开始渲染: ${markdownFile}`);
    console.log(`  📐 主题: ${theme}`);
    console.log(`  📏 模式: ${mode}`);
    console.log(`  📐 尺寸: ${width}x${height}`);
    
    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // 解析 Markdown 文件
    const { metadata, body } = parseMarkdownFile(markdownFile);
    
    // 分割内容
    const cardContents = splitContentBySeparator(body);
    const totalCards = cardContents.length;
    
    console.log(`  📄 检测到 ${totalCards} 张正文卡片`);
    
    // 生成封面
    if (metadata.emoji || metadata.title) {
        console.log('  📷 生成封面...');
        const coverHtml = generateCoverHtml(metadata, theme, width, height);
        const coverPath = path.join(outputDir, 'cover.png');
        await renderHtmlToImage(coverHtml, coverPath, width, height, 'separator', maxHeight, dpr);
    }
    
    // 生成正文卡片
    for (let i = 0; i < cardContents.length; i++) {
        const content = cardContents[i];
        console.log(`  📷 生成卡片 ${i + 1}/${totalCards}...`);
        const cardHtml = generateCardHtml(content, theme, i + 1, totalCards, width, height, mode, path.dirname(path.resolve(markdownFile)));
        const cardPath = path.join(outputDir, `card_${i + 1}.png`);
        await renderHtmlToImage(cardHtml, cardPath, width, height, mode, maxHeight, dpr);
    }
    
    console.log(`\n✨ 渲染完成！图片已保存到: ${outputDir}`);
}

/**
 * 主函数
 */
async function main() {
    const options = parseArgs();
    
    if (!options.markdownFile) {
        console.error('❌ 错误: 请提供 Markdown 文件路径');
        printHelp();
        process.exit(1);
    }
    
    if (!fs.existsSync(options.markdownFile)) {
        console.error(`❌ 错误: 文件不存在 - ${options.markdownFile}`);
        process.exit(1);
    }
    
    if (!AVAILABLE_THEMES.includes(options.theme)) {
        console.error(`❌ 错误: 不支持的主题 - ${options.theme}`);
        console.error(`可用主题: ${AVAILABLE_THEMES.join(', ')}`);
        process.exit(1);
    }
    
    if (!PAGING_MODES.includes(options.mode)) {
        console.error(`❌ 错误: 不支持的分页模式 - ${options.mode}`);
        console.error(`可用模式: ${PAGING_MODES.join(', ')}`);
        process.exit(1);
    }
    
    await renderMarkdownToCards(options);
}

main().catch(console.error);
