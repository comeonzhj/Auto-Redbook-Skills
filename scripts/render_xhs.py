#!/usr/bin/env python3
"""
小红书卡片渲染脚本 - Python 版本
将 Markdown 文件渲染为小红书风格的图片卡片

使用方法:
    python render_xhs.py <markdown_file> [--output-dir <output_directory>]

依赖安装:
    pip install markdown pyyaml pillow playwright
    playwright install chromium
"""

import argparse
import asyncio
import os
import re
import sys
import tempfile
from pathlib import Path

try:
    import markdown
    import yaml
    from playwright.async_api import async_playwright
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("请运行: pip install markdown pyyaml playwright && playwright install chromium")
    sys.exit(1)


# 获取脚本所在目录
SCRIPT_DIR = Path(__file__).parent.parent
ASSETS_DIR = SCRIPT_DIR / "assets"

# 卡片尺寸配置 (3:4 比例)
CARD_WIDTH = 1080
CARD_HEIGHT = 1440


def parse_markdown_file(file_path: str) -> dict:
    """解析 Markdown 文件，提取 YAML 头部和正文内容"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 解析 YAML 头部
    yaml_pattern = r'^---\s*\n(.*?)\n---\s*\n'
    yaml_match = re.match(yaml_pattern, content, re.DOTALL)
    
    metadata = {}
    body = content
    
    if yaml_match:
        try:
            metadata = yaml.safe_load(yaml_match.group(1)) or {}
        except yaml.YAMLError:
            metadata = {}
        body = content[yaml_match.end():]
    
    return {
        'metadata': metadata,
        'body': body.strip()
    }


def split_content_by_separator(body: str) -> list:
    """按照 --- 分隔符拆分正文为多张卡片内容"""
    # 使用 --- 作为分隔符，但要排除 YAML 头部的 ---
    parts = re.split(r'\n---+\n', body)
    return [part.strip() for part in parts if part.strip()]


def convert_markdown_to_html(md_content: str) -> str:
    """将 Markdown 转换为 HTML"""
    # 处理 tags（以 # 开头的标签）
    tags_pattern = r'((?:#[\w\u4e00-\u9fa5]+\s*)+)$'
    tags_match = re.search(tags_pattern, md_content, re.MULTILINE)
    tags_html = ""
    
    if tags_match:
        tags_str = tags_match.group(1)
        md_content = md_content[:tags_match.start()].strip()
        tags = re.findall(r'#([\w\u4e00-\u9fa5]+)', tags_str)
        if tags:
            tags_html = '<div class="tags-container">'
            for tag in tags:
                tags_html += f'<span class="tag">#{tag}</span>'
            tags_html += '</div>'
    
    # 转换 Markdown 为 HTML
    html = markdown.markdown(
        md_content,
        extensions=['extra', 'codehilite', 'tables', 'nl2br']
    )
    
    return html + tags_html


def load_template(template_name: str) -> str:
    """加载 HTML 模板"""
    template_path = ASSETS_DIR / template_name
    with open(template_path, 'r', encoding='utf-8') as f:
        return f.read()


def generate_cover_html(metadata: dict) -> str:
    """生成封面 HTML"""
    template = load_template('cover.html')
    
    emoji = metadata.get('emoji', '📝')
    title = metadata.get('title', '标题')
    subtitle = metadata.get('subtitle', '')
    
    # 限制标题和副标题长度
    if len(title) > 15:
        title = title[:15]
    if len(subtitle) > 15:
        subtitle = subtitle[:15]
    
    html = template.replace('{{EMOJI}}', emoji)
    html = html.replace('{{TITLE}}', title)
    html = html.replace('{{SUBTITLE}}', subtitle)
    
    return html


def generate_card_html(content: str, page_number: int = 1, total_pages: int = 1) -> str:
    """生成正文卡片 HTML"""
    template = load_template('card.html')
    
    html_content = convert_markdown_to_html(content)
    
    page_text = f"{page_number}/{total_pages}" if total_pages > 1 else ""
    
    html = template.replace('{{CONTENT}}', html_content)
    html = html.replace('{{PAGE_NUMBER}}', page_text)
    
    return html


async def render_html_to_image(html_content: str, output_path: str, width: int = CARD_WIDTH, height: int = CARD_HEIGHT):
    """使用 Playwright 将 HTML 渲染为图片"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': width, 'height': height})
        
        # 创建临时 HTML 文件
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
            f.write(html_content)
            temp_html_path = f.name
        
        try:
            await page.goto(f'file://{temp_html_path}')
            await page.wait_for_load_state('networkidle')
            
            # 等待字体加载
            await page.wait_for_timeout(500)
            
            # 获取实际内容高度
            content_height = await page.evaluate('''() => {
                const container = document.querySelector('.card-container') || document.querySelector('.cover-container');
                return container ? container.scrollHeight : document.body.scrollHeight;
            }''')
            
            # 确保高度至少为 1440px（3:4 比例）
            actual_height = max(height, content_height)
            
            # 截图
            await page.screenshot(
                path=output_path,
                clip={'x': 0, 'y': 0, 'width': width, 'height': actual_height},
                type='png'
            )
            
            print(f"  ✅ 已生成: {output_path}")
            
        finally:
            os.unlink(temp_html_path)
            await browser.close()


async def render_markdown_to_cards(md_file: str, output_dir: str):
    """主渲染函数：将 Markdown 文件渲染为多张卡片图片"""
    print(f"\n🎨 开始渲染: {md_file}")
    
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    # 解析 Markdown 文件
    data = parse_markdown_file(md_file)
    metadata = data['metadata']
    body = data['body']
    
    # 分割正文内容
    card_contents = split_content_by_separator(body)
    total_cards = len(card_contents)
    
    print(f"  📄 检测到 {total_cards} 张正文卡片")
    
    # 生成封面
    if metadata.get('emoji') or metadata.get('title'):
        print("  📷 生成封面...")
        cover_html = generate_cover_html(metadata)
        cover_path = os.path.join(output_dir, 'cover.png')
        await render_html_to_image(cover_html, cover_path)
    
    # 生成正文卡片
    for i, content in enumerate(card_contents, 1):
        print(f"  📷 生成卡片 {i}/{total_cards}...")
        card_html = generate_card_html(content, i, total_cards)
        card_path = os.path.join(output_dir, f'card_{i}.png')
        await render_html_to_image(card_html, card_path)
    
    print(f"\n✨ 渲染完成！图片已保存到: {output_dir}")
    return total_cards


def main():
    parser = argparse.ArgumentParser(
        description='将 Markdown 文件渲染为小红书风格的图片卡片'
    )
    parser.add_argument(
        'markdown_file',
        help='Markdown 文件路径'
    )
    parser.add_argument(
        '--output-dir', '-o',
        default=os.getcwd(),
        help='输出目录（默认为当前工作目录）'
    )
    
    args = parser.parse_args()
    
    if not os.path.exists(args.markdown_file):
        print(f"❌ 错误: 文件不存在 - {args.markdown_file}")
        sys.exit(1)
    
    asyncio.run(render_markdown_to_cards(args.markdown_file, args.output_dir))


if __name__ == '__main__':
    main()
