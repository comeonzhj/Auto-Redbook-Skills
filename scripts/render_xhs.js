#!/usr/bin/env node
/**
 * 小红书卡片渲染脚本 - Node.js 版本
 * 将 Markdown 文件渲染为小红书风格的图片卡片
 * 
 * 使用方法:
 *   node render_xhs.js <markdown_file> [--output-dir <output_directory>]
 * 
 * 依赖安装:
 *   npm install marked js-yaml playwright
 *   npx playwright install chromium
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { marked } = require('marked');
const yaml = require('js-yaml');

// 获取脚本所在目录
const SCRIPT_DIR = path.dirname(__dirname);
const ASSETS_DIR = path.join(SCRIPT_DIR, 'assets');

// 卡片尺寸配置 (3:4 比例)
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1440;

/**
 * 解析 Markdown 文件，提取 YAML 头部和正文内容
 */
function parseMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // 解析 YAML 头部
    const yamlPattern = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const yamlMatch = content.match(yamlPattern);
    
    let metadata = {};
    let body = content;
    
    if (yamlMatch) {
        try {
            metadata = yaml.load(yamlMatch[1]) || {};
        } catch (e) {
            metadata = {};
        }
        body = content.slice(yamlMatch[0].length);
    }
    
    return {
        metadata,
        body: body.trim()
    };
}

/**
 * 按照 --- 分隔符拆分正文为多张卡片内容
 */
function splitContentBySeparator(body) {
    const parts = body.split(/\n---+\n/);
    return parts.filter(part => part.trim()).map(part => part.trim());
}

/**
 * 将 Markdown 转换为 HTML
 */
function convertMarkdownToHtml(mdContent) {
    // 处理 tags（以 # 开头的标签）
    const tagsPattern = /((?:#[\w\u4e00-\u9fa5]+\s*)+)$/m;
    const tagsMatch = mdContent.match(tagsPattern);
    let tagsHtml = "";
    
    if (tagsMatch) {
        const tagsStr = tagsMatch[1];
        mdContent = mdContent.slice(0, tagsMatch.index).trim();
        const tags = tagsStr.match(/#([\w\u4e00-\u9fa5]+)/g);
        if (tags) {
            tagsHtml = '<div class="tags-container">';
            for (const tag of tags) {
                tagsHtml += `<span class="tag">${tag}</span>`;
            }
            tagsHtml += '</div>';
        }
    }
    
    // 转换 Markdown 为 HTML
    const html = marked.parse(mdContent, {
        breaks: true,
        gfm: true
    });
    
    return html + tagsHtml;
}

/**
 * 加载 HTML 模板
 */
function loadTemplate(templateName) {
    const templatePath = path.join(ASSETS_DIR, templateName);
    return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * 生成封面 HTML
 */
function generateCoverHtml(metadata) {
    let template = loadTemplate('cover.html');
    
    let emoji = metadata.emoji || '📝';
    let title = metadata.title || '标题';
    let subtitle = metadata.subtitle || '';
    
    // 限制标题和副标题长度
    if (title.length > 15) {
        title = title.slice(0, 15);
    }
    if (subtitle.length > 15) {
        subtitle = subtitle.slice(0, 15);
    }
    
    template = template.replace('{{EMOJI}}', emoji);
    template = template.replace('{{TITLE}}', title);
    template = template.replace('{{SUBTITLE}}', subtitle);
    
    return template;
}

/**
 * 生成正文卡片 HTML
 */
function generateCardHtml(content, pageNumber = 1, totalPages = 1) {
    let template = loadTemplate('card.html');
    
    const htmlContent = convertMarkdownToHtml(content);
    const pageText = totalPages > 1 ? `${pageNumber}/${totalPages}` : '';
    
    template = template.replace('{{CONTENT}}', htmlContent);
    template = template.replace('{{PAGE_NUMBER}}', pageText);
    
    return template;
}

/**
 * 使用 Playwright 将 HTML 渲染为图片
 */
async function renderHtmlToImage(htmlContent, outputPath, width = CARD_WIDTH, height = CARD_HEIGHT) {
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width, height }
    });
    
    // 设置 HTML 内容
    await page.setContent(htmlContent, {
        waitUntil: 'networkidle'
    });
    
    // 等待字体加载
    await page.waitForTimeout(500);
    
    // 获取实际内容高度
    const contentHeight = await page.evaluate(() => {
        const container = document.querySelector('.card-container') || document.querySelector('.cover-container');
        return container ? container.scrollHeight : document.body.scrollHeight;
    });
    
    // 确保高度至少为 1440px（3:4 比例）
    const actualHeight = Math.max(height, contentHeight);
    
    // 截图
    await page.screenshot({
        path: outputPath,
        clip: { x: 0, y: 0, width, height: actualHeight },
        type: 'png'
    });
    
    console.log(`  ✅ 已生成: ${outputPath}`);
    
    await browser.close();
}

/**
 * 主渲染函数：将 Markdown 文件渲染为多张卡片图片
 */
async function renderMarkdownToCards(mdFile, outputDir) {
    console.log(`\n🎨 开始渲染: ${mdFile}`);
    
    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // 解析 Markdown 文件
    const data = parseMarkdownFile(mdFile);
    const { metadata, body } = data;
    
    // 分割正文内容
    const cardContents = splitContentBySeparator(body);
    const totalCards = cardContents.length;
    
    console.log(`  📄 检测到 ${totalCards} 张正文卡片`);
    
    // 生成封面
    if (metadata.emoji || metadata.title) {
        console.log('  📷 生成封面...');
        const coverHtml = generateCoverHtml(metadata);
        const coverPath = path.join(outputDir, 'cover.png');
        await renderHtmlToImage(coverHtml, coverPath);
    }
    
    // 生成正文卡片
    for (let i = 0; i < cardContents.length; i++) {
        const pageNum = i + 1;
        console.log(`  📷 生成卡片 ${pageNum}/${totalCards}...`);
        const cardHtml = generateCardHtml(cardContents[i], pageNum, totalCards);
        const cardPath = path.join(outputDir, `card_${pageNum}.png`);
        await renderHtmlToImage(cardHtml, cardPath);
    }
    
    console.log(`\n✨ 渲染完成！图片已保存到: ${outputDir}`);
    return totalCards;
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('用法: node render_xhs.js <markdown_file> [--output-dir <output_directory>]');
        process.exit(1);
    }
    
    let markdownFile = null;
    let outputDir = process.cwd();
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--output-dir' || args[i] === '-o') {
            outputDir = args[i + 1];
            i++;
        } else if (!args[i].startsWith('-')) {
            markdownFile = args[i];
        }
    }
    
    if (!markdownFile) {
        console.error('❌ 错误: 请指定 Markdown 文件');
        process.exit(1);
    }
    
    if (!fs.existsSync(markdownFile)) {
        console.error(`❌ 错误: 文件不存在 - ${markdownFile}`);
        process.exit(1);
    }
    
    return { markdownFile, outputDir };
}

// 主函数
async function main() {
    const { markdownFile, outputDir } = parseArgs();
    await renderMarkdownToCards(markdownFile, outputDir);
}

main().catch(error => {
    console.error('❌ 渲染失败:', error.message);
    process.exit(1);
});
