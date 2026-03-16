#!/usr/bin/env python3
"""
杂志版小红书卡片渲染器

特点：
- 封面：标题 + 自动吃掉开头导语
- 正文：自动按固定页面高度分页
- 输出：cover.png, card_1.png, card_2.png...

用法:
    python scripts/render_xhs_editorial.py demos/content.md
    python scripts/render_xhs_editorial.py demos/content.md -o output
"""

import argparse
import asyncio
import html
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Tuple

try:
    import markdown
    import yaml
    from playwright.async_api import async_playwright
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("请运行: pip install markdown pyyaml playwright && playwright install chromium")
    sys.exit(1)


SCRIPT_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = SCRIPT_DIR / "assets" / "editorial"

DEFAULT_WIDTH = 1080
DEFAULT_HEIGHT = 1440
DEFAULT_DPR = 2


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_markdown_file(file_path: str) -> Dict:
    """解析 markdown，提取 YAML 头和正文"""
    content = Path(file_path).read_text(encoding="utf-8")

    yaml_pattern = r"^---\s*\n(.*?)\n---\s*\n"
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
        "metadata": metadata,
        "body": body.strip()
    }


def convert_markdown_to_html(md_content: str) -> str:
    """Markdown 转 HTML"""
    return markdown.markdown(
        md_content,
        extensions=["extra", "codehilite", "tables", "nl2br"]
    )


# def split_title_lines(title: str, max_chars: int = 9) -> List[str]:
#     """把标题拆成更适合封面的多行"""
#     title = (title or "").strip()
#     if not title:
#         return ["未命名标题"]

#     if "\n" in title:
#         lines = [x.strip() for x in title.splitlines() if x.strip()]
#         return lines[:4]

#     lines = []
#     current = ""

#     for ch in title:
#         current += ch
#         if len(current) >= max_chars and ch not in "，。！？；：、,.!?;:":
#             lines.append(current.strip())
#             current = ""

#     if current.strip():
#         lines.append(current.strip())

#     if len(lines) > 4:
#         merged = lines[:3]
#         merged.append("".join(lines[3:]))
#         lines = merged

#     return lines


# def build_title_lines_html(title: str) -> str:
#     lines = split_title_lines(title)
#     return "\n".join(
#         f'<div class="cover-title-line"><span>{html.escape(line)}</span></div>'
#         for line in lines
#     )

def build_title_lines_html(title: str) -> str:
    """封面标题 HTML（不再拆行）"""
    safe = html.escape(title.strip())
    return f'<div class="cover-title-line"><span>{safe}</span></div>'


def render_template(template: str, replacements: Dict[str, str]) -> str:
    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(f"{{{{{{{key}}}}}}}", value)
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered


def inline_editorial_css(html_doc: str, css: str) -> str:
    html_doc = html_doc.replace(
        '<link rel="stylesheet" href="../editorial/editorial.css" />',
        f"<style>\n{css}\n</style>"
    )
    html_doc = html_doc.replace(
        '<link rel="stylesheet" href="../editorial/editorial.css">',
        f"<style>\n{css}\n</style>"
    )
    return html_doc


def build_cover_html(metadata: Dict, width: int, height: int, cover_body_md: str = "") -> str:
    template = read_text_file(ASSETS_DIR / "cover.html")
    css = read_text_file(ASSETS_DIR / "editorial.css")

    title = metadata.get("title", "未命名标题")
    title_lines_html = build_title_lines_html(title)
    cover_body_html = convert_markdown_to_html(cover_body_md) if cover_body_md.strip() else ""

    html_doc = render_template(
        template,
        {
            "width": str(width),
            "height": str(height),
            "title_lines": title_lines_html,
            "cover_body": cover_body_html,
        }
    )

    return inline_editorial_css(html_doc, css)


def build_card_html(content: str, page_number: int, total_pages: int, width: int, height: int) -> str:
    template = read_text_file(ASSETS_DIR / "card.html")
    css = read_text_file(ASSETS_DIR / "editorial.css")

    html_content = convert_markdown_to_html(content)
    page_text = f"{page_number}/{total_pages}" if total_pages > 1 else ""

    html_doc = render_template(
        template,
        {
            "width": str(width),
            "height": str(height),
            "content": html_content,
            "page_number": html.escape(page_text),
        }
    )

    return inline_editorial_css(html_doc, css)


def split_blocks(body: str) -> List[str]:
    """
    把正文拆成适合自动分页的块：
    - 按空行拆
    - 去掉 standalone ---
    """
    raw_blocks = [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]
    blocks = []
    for b in raw_blocks:
        if re.fullmatch(r"-{3,}", b):
            continue
        blocks.append(b)
    return blocks

# 把一个 block 按句子切开来尝试部分塞进当前页，减少留白
def split_block_into_sentences(block: str) -> List[str]:
    """
    把一个正文块按句子拆开。
    标题不拆。
    """
    block = block.strip()
    if not block:
        return []

    if block.startswith("#"):
        return [block]

    sentences = re.findall(r'[^。！？；\n]+[。！？；]?', block)
    sentences = [s.strip() for s in sentences if s.strip()]
    return sentences if sentences else [block]

# 在当前页里尽量塞进一个 block 的一部分，返回能塞进的部分和剩余部分
async def fit_partial_block_into_page(
    current_blocks: List[str],
    block: str,
    width: int,
    height: int,
    dpr: int
) -> Tuple[List[str], str]:
    """
    尝试把一个过长 block 的一部分塞进当前页。
    返回：
      fitted_parts: 能塞进当前页的部分（可能为空）
      leftover: 剩余没塞进去的部分
    """
    parts = split_block_into_sentences(block)

    # 标题不拆
    if len(parts) == 1 and parts[0] == block and block.startswith("#"):
        return [], block

    fitted_parts: List[str] = []
    leftover_parts: List[str] = parts[:]

    for i, part in enumerate(parts):
        candidate_blocks = current_blocks + fitted_parts + [part]
        candidate_md = "\n\n".join(candidate_blocks)

        test_html = build_card_html(
            content=candidate_md,
            page_number=1,
            total_pages=1,
            width=width,
            height=height
        )

        rendered_height = await measure_html_height(
            html_content=test_html,
            width=width,
            height=height,
            dpr=dpr
        )

        if rendered_height <= height:
            fitted_parts.append(part)
            leftover_parts = parts[i + 1:]
        else:
            break

    return fitted_parts, "".join(leftover_parts).strip()


# def split_blocks(body: str) -> List[str]:
#     """
#     把正文拆成适合自动分页的块：
#     - 按空行拆
#     - 去掉 standalone ---
#     """
#     raw_blocks = [b.strip() + "。" for b in re.split(r"[。！？]\s*", body) if b.strip()]
#     blocks = []
#     for b in raw_blocks:
#         if re.fullmatch(r"-{3,}", b):
#             continue
#         blocks.append(b)
#     return blocks


async def measure_html_height(
    html_content: str,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    dpr: int = DEFAULT_DPR
) -> int:
    """只测 HTML 实际渲染高度，不截图"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={"width": width, "height": height},
            device_scale_factor=dpr
        )

        temp_html_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".html",
                delete=False,
                encoding="utf-8"
            ) as f:
                f.write(html_content)
                temp_html_path = f.name

            uri = Path(temp_html_path).resolve().as_uri()
            await page.goto(uri, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(400)

            actual_height = await page.evaluate(
                """() => {
                    const pageEl = document.querySelector('.page');
                    return pageEl ? Math.ceil(pageEl.scrollHeight) : Math.ceil(document.body.scrollHeight);
                }"""
            )
            return actual_height

        finally:
            if temp_html_path and os.path.exists(temp_html_path):
                os.unlink(temp_html_path)
            await browser.close()


async def render_html_to_image(
    html_content: str,
    output_path: str,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    dpr: int = DEFAULT_DPR,
    fixed_height: bool = True
) -> int:
    """用 Playwright 截图"""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={"width": width, "height": height},
            device_scale_factor=dpr
        )

        temp_html_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".html",
                delete=False,
                encoding="utf-8"
            ) as f:
                f.write(html_content)
                temp_html_path = f.name

            uri = Path(temp_html_path).resolve().as_uri()
            await page.goto(uri, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(800)

            content_height = await page.evaluate(
                """() => {
                    const pageEl = document.querySelector('.page');
                    return pageEl ? Math.ceil(pageEl.scrollHeight) : Math.ceil(document.body.scrollHeight);
                }"""
            )

            actual_height = height if fixed_height else max(height, content_height)

            await page.screenshot(
                path=output_path,
                clip={"x": 0, "y": 0, "width": width, "height": actual_height},
                type="png"
            )

            print(f"  ✅ 已生成: {output_path} ({width}x{actual_height})")
            return actual_height

        finally:
            if temp_html_path and os.path.exists(temp_html_path):
                os.unlink(temp_html_path)
            await browser.close()


async def split_first_page_for_cover_by_height(
    metadata: Dict,
    body: str,
    width: int,
    height: int,
    dpr: int
) -> Tuple[str, List[str]]:
    """
    自动决定封面吃多少正文。
    规则：
    - 如果开头有普通段落，就优先吃普通段落
    - 如果一上来就是第一个标题，也允许把这个标题后面的内容继续吃进封面
    - 直到封面放不下为止
    """
    blocks = split_blocks(body)
    if not blocks:
        return "", []

    cover_blocks: List[str] = []
    remaining_blocks = blocks[:]

    for i, block in enumerate(blocks):
        candidate_blocks = cover_blocks + [block]
        candidate_md = "\n\n".join(candidate_blocks)

        cover_html = build_cover_html(
            metadata=metadata,
            width=width,
            height=height,
            cover_body_md=candidate_md
        )

        rendered_height = await measure_html_height(
            html_content=cover_html,
            width=width,
            height=height,
            dpr=dpr
        )

        if rendered_height <= height:
            cover_blocks.append(block)
            remaining_blocks = blocks[i + 1:]
        else:
            break

    cover_body_md = "\n\n".join(cover_blocks).strip()
    return cover_body_md, remaining_blocks

async def paginate_blocks_for_first_cover_page(
    metadata: Dict,
    blocks: List[str],
    width: int,
    height: int,
    dpr: int
) -> Tuple[str, List[str]]:
    """
    用 cover.html 作为第一页模板，自动决定第一页能放多少正文。
    注意：
    - 不区分导语/标题
    - 正文从第一页就开始自然流入
    """
    if not blocks:
        return "", []

    first_page_blocks: List[str] = []
    remaining_blocks = blocks[:]

    for i, block in enumerate(blocks):
        candidate_blocks = first_page_blocks + [block]
        candidate_md = "\n\n".join(candidate_blocks)

        first_page_html = build_cover_html(
            metadata=metadata,
            width=width,
            height=height,
            cover_body_md=candidate_md
        )

        rendered_height = await measure_html_height(
            html_content=first_page_html,
            width=width,
            height=height,
            dpr=dpr
        )

        if rendered_height <= height:
            first_page_blocks.append(block)
            remaining_blocks = blocks[i + 1:]
        else:
            break

    first_page_md = "\n\n".join(first_page_blocks).strip()
    return first_page_md, remaining_blocks


# async def paginate_blocks_for_cards(
#     blocks: List[str],
#     width: int,
#     height: int,
#     dpr: int
# ) -> List[str]:
#     """
#     把正文块按真实渲染高度自动分页。
#     每一页固定高度 1440。
#     """
#     if not blocks:
#         return []

#     pages: List[str] = []
#     current_blocks: List[str] = []

#     for block in blocks:
#         candidate_blocks = current_blocks + [block]
#         candidate_md = "\n\n".join(candidate_blocks)

#         test_html = build_card_html(
#             content=candidate_md,
#             page_number=1,
#             total_pages=1,
#             width=width,
#             height=height
#         )

#         rendered_height = await measure_html_height(
#             html_content=test_html,
#             width=width,
#             height=height,
#             dpr=dpr
#         )

#         if rendered_height <= height:
#             current_blocks.append(block)
#         else:
#             if current_blocks:
#                 pages.append("\n\n".join(current_blocks))
#                 current_blocks = [block]
#             else:
#                 # 单个 block 太高也强行占一页
#                 pages.append(block)
#                 current_blocks = []

#     if current_blocks:
#         pages.append("\n\n".join(current_blocks))

#     return pages

# 新版分页逻辑：如果一个 block 放不下了，尝试把这个 block 拆一部分塞到当前页，减少留白
async def paginate_blocks_for_cards(
    blocks: List[str],
    width: int,
    height: int,
    dpr: int
) -> List[str]:
    """
    把正文块按真实渲染高度自动分页。
    规则：
    - 优先保持你原来的段落结构
    - 如果某个 block 放不下，就尝试把这个 block 拆一部分塞到当前页
    - 尽量减少页面底部大空白
    """
    if not blocks:
        return []

    pages: List[str] = []
    current_blocks: List[str] = []

    i = 0
    while i < len(blocks):
        block = blocks[i]

        candidate_blocks = current_blocks + [block]
        candidate_md = "\n\n".join(candidate_blocks)

        test_html = build_card_html(
            content=candidate_md,
            page_number=1,
            total_pages=1,
            width=width,
            height=height
        )

        rendered_height = await measure_html_height(
            html_content=test_html,
            width=width,
            height=height,
            dpr=dpr
        )

        # 整块能放下，直接放
        if rendered_height <= height:
            current_blocks.append(block)
            i += 1
            continue

        # 整块放不下
        if current_blocks:
            # 尝试把 block 的一部分塞进当前页，减少留白
            fitted_parts, leftover = await fit_partial_block_into_page(
                current_blocks=current_blocks,
                block=block,
                width=width,
                height=height,
                dpr=dpr
            )

            if fitted_parts:
                current_blocks.extend(fitted_parts)
                pages.append("\n\n".join(current_blocks))
                current_blocks = []

                if leftover:
                    blocks[i] = leftover
                else:
                    i += 1
            else:
                # 一点都塞不进去，就整页结束
                pages.append("\n\n".join(current_blocks))
                current_blocks = []
        else:
            # 当前页是空页，说明单个 block 本身太大
            # 那就尽量拆一部分塞进去
            fitted_parts, leftover = await fit_partial_block_into_page(
                current_blocks=[],
                block=block,
                width=width,
                height=height,
                dpr=dpr
            )

            if fitted_parts:
                pages.append("\n\n".join(fitted_parts))
                if leftover:
                    blocks[i] = leftover
                else:
                    i += 1
            else:
                # 实在拆不了（比如一个巨大标题），那就硬塞一页
                pages.append(block)
                i += 1

    if current_blocks:
        pages.append("\n\n".join(current_blocks))

    return pages




async def render_markdown_to_editorial_cards(
    md_file: str,
    output_dir: str,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    dpr: int = DEFAULT_DPR
):
    print(f"\n🎨 开始渲染杂志版: {md_file}")
    print(f"  📐 尺寸: {width}x{height}")
    print(f"  🔍 DPR: {dpr}")

    os.makedirs(output_dir, exist_ok=True)

    data = parse_markdown_file(md_file)
    metadata = data["metadata"]
    body = data["body"]

    if not body.strip():
        print("❌ 正文为空，无法生成卡片")
        return 0

    blocks = split_blocks(body)

    # 1) 第一页：用 cover.html 作为正文第一页模板
    first_page_md, remaining_blocks = await paginate_blocks_for_first_cover_page(
        metadata=metadata,
        blocks=blocks,
        width=width,
        height=height,
        dpr=dpr
    )

    # 2) 后续页：用 card.html 自动分页
    card_pages = await paginate_blocks_for_cards(
        blocks=remaining_blocks,
        width=width,
        height=height,
        dpr=dpr
    )

    total_pages = 1 + len(card_pages)
    print(f"  📄 自动分页得到 {total_pages} 页（含第一页）")

    # 3) 生成第一页
    print("  📷 生成第一页...")
    first_page_html = build_cover_html(
        metadata=metadata,
        width=width,
        height=height,
        cover_body_md=first_page_md
    )
    first_page_path = os.path.join(output_dir, "cover.png")
    await render_html_to_image(
        first_page_html,
        first_page_path,
        width,
        height,
        dpr,
        fixed_height=True
    )

    # 4) 生成后续页
    for i, page_md in enumerate(card_pages, 1):
        print(f"  📷 生成正文页 {i}/{len(card_pages)}...")
        card_html = build_card_html(
            content=page_md,
            page_number=i,
            total_pages=len(card_pages),
            width=width,
            height=height
        )
        card_path = os.path.join(output_dir, f"card_{i}.png")
        await render_html_to_image(
            card_html,
            card_path,
            width,
            height,
            dpr,
            fixed_height=True
        )

    print(f"\n✨ 渲染完成！图片已保存到: {output_dir}")
    return total_pages



def main():
    parser = argparse.ArgumentParser(
        description="将 Markdown 渲染为杂志版小红书图片卡片"
    )
    parser.add_argument("markdown_file", help="Markdown 文件路径")
    parser.add_argument(
        "--output-dir", "-o",
        default=os.getcwd(),
        help="输出目录（默认: 当前目录）"
    )
    parser.add_argument(
        "--width",
        type=int,
        default=DEFAULT_WIDTH,
        help=f"图片宽度（默认: {DEFAULT_WIDTH}）"
    )
    parser.add_argument(
        "--height",
        type=int,
        default=DEFAULT_HEIGHT,
        help=f"图片高度（默认: {DEFAULT_HEIGHT}）"
    )
    parser.add_argument(
        "--dpr",
        type=int,
        default=DEFAULT_DPR,
        help=f"设备像素比（默认: {DEFAULT_DPR}）"
    )

    args = parser.parse_args()

    if not os.path.exists(args.markdown_file):
        print(f"❌ 文件不存在: {args.markdown_file}")
        sys.exit(1)

    required_files = [
        ASSETS_DIR / "cover.html",
        ASSETS_DIR / "card.html",
        ASSETS_DIR / "editorial.css",
    ]
    missing = [str(p) for p in required_files if not p.exists()]
    if missing:
        print("❌ 缺少以下文件：")
        for p in missing:
            print(f"   - {p}")
        sys.exit(1)

    asyncio.run(
        render_markdown_to_editorial_cards(
            args.markdown_file,
            args.output_dir,
            width=args.width,
            height=args.height,
            dpr=args.dpr
        )
    )


if __name__ == "__main__":
    main()