#!/usr/bin/env python3
"""使用仓库内置的 Creator 纯 HTTP 签名链路发布小红书图文笔记。"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BUILTIN_PUBLISHER_ROOT = PROJECT_ROOT / "vendor" / "xhs_publish_runtime"


def load_project_env() -> None:
    """按调用目录、项目目录的顺序加载 .env。"""
    for env_path in (Path.cwd() / ".env", PROJECT_ROOT / ".env"):
        if env_path.is_file():
            load_dotenv(env_path)
            return


def load_creator_cookie() -> str:
    """读取 Creator Cookie。"""
    load_project_env()
    cookie = os.getenv("XHS_CREATOR_COOKIE")
    if cookie:
        return cookie.strip()

    raise RuntimeError(
        "未找到 XHS_CREATOR_COOKIE。请从已登录的 "
        "https://creator.xiaohongshu.com 获取完整 Cookie，并写入 .env。"
    )


def parse_cookie(cookie_string: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for item in cookie_string.split(";"):
        if "=" not in item:
            continue
        key, value = item.strip().split("=", 1)
        values[key.strip()] = value.strip()
    return values


def validate_creator_cookie(cookie_string: str) -> None:
    cookies = parse_cookie(cookie_string)
    if not cookies.get("a1"):
        raise ValueError("Creator Cookie 缺少 a1")

    auth_keys = (
        "customer-sso-sid",
        "access-token-creator.xiaohongshu.com",
        "galaxy_creator_session_id",
        "web_session",
    )
    if not any(cookies.get(key) for key in auth_keys):
        raise ValueError(
            "Creator Cookie 缺少登录凭证；请复制创作服务平台请求中的完整 Cookie"
        )


def validate_runtime() -> None:
    if not BUILTIN_PUBLISHER_ROOT.is_dir():
        raise RuntimeError(f"内置发布模块缺失: {BUILTIN_PUBLISHER_ROOT}")
    if shutil.which("node") is None:
        raise RuntimeError("未找到 Node.js；本地签名运行时需要 Node.js 18+")


def validate_images(paths: list[str]) -> list[Path]:
    images: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"图片不存在: {raw_path}")
        images.append(path)
    if not 1 <= len(images) <= 15:
        raise ValueError("图片数量必须为 1–15 张")
    return images


def parse_post_time(value: str | None) -> str | None:
    """将本地时间或已有毫秒时间戳规范化为 13 位字符串。"""
    if not value:
        return None
    if value.isdigit() and len(value) == 13:
        return value
    try:
        moment = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise ValueError(
            "--post-time 必须是 13 位毫秒时间戳或 YYYY-MM-DD HH:MM:SS"
        ) from exc
    return str(int(moment.timestamp() * 1000))


def build_proxies(proxy: str | None) -> dict[str, str] | None:
    proxy = proxy or os.getenv("XHS_PROXY")
    if not proxy:
        return None
    return {"http": proxy, "https": proxy}


def import_builtin_publisher():
    """从当前仓库加载自包含发布模块。"""
    root = str(BUILTIN_PUBLISHER_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        from apis.xhs_creator_apis import XHS_Creator_Apis
        from xhs_utils.xhs_creator import XHSCreatorAuth
    except ImportError as exc:
        raise RuntimeError(
            f"发布依赖缺失: {exc}。请执行 pip install -r requirements.txt && npm install"
        ) from exc
    return XHSCreatorAuth, XHS_Creator_Apis


def find_note_id(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    for key in ("note_id", "noteId", "id"):
        value = result.get(key)
        if value:
            return str(value)
    for key in ("data", "result"):
        nested = find_note_id(result.get(key))
        if nested:
            return nested
    return None


def publish(args: argparse.Namespace, images: list[Path], post_time: str | None) -> dict:
    validate_runtime()
    cookie = load_creator_cookie()
    validate_creator_cookie(cookie)
    XHSCreatorAuth, XHS_Creator_Apis = import_builtin_publisher()

    proxies = build_proxies(args.proxy)
    auth = XHSCreatorAuth.from_cookie(cookie, proxies=proxies)
    try:
        api = XHS_Creator_Apis(auth).bootstrap(proxies=proxies)
        note = {
            "title": args.title,
            "desc": args.desc,
            "media_type": "image",
            # 内置上传接口接收二进制内容，不传外部文件路径。
            "images": [path.read_bytes() for path in images],
            "type": 0 if args.public else 1,
            "postTime": post_time,
            "topics": args.topics,
            "location": args.location,
        }
        success, message, result = api.post_note(note, proxies=proxies)
        if not success:
            detail = json.dumps(result, ensure_ascii=False, default=str)
            raise RuntimeError(f"{message}: {detail}")
        return result or {}
    finally:
        auth.close()


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="使用内置 Creator HTTP 签名链路发布小红书图文笔记",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  # 默认仅自己可见
  python scripts/publish_xhs.py -t "标题" -d "正文" -i cover.png card_1.png

  # 公开发布，并添加话题
  python scripts/publish_xhs.py -t "标题" -d "正文" -i *.png --public --topics AI 效率工具

  # 按本机时区定时发布
  python scripts/publish_xhs.py -t "标题" -d "正文" -i *.png --public \
    --post-time "2026-08-14 10:00:00"
''',
    )
    parser.add_argument("--title", "-t", required=True, help="笔记标题（不超过 20 字）")
    parser.add_argument("--desc", "-d", default="", help="笔记正文")
    parser.add_argument("--images", "-i", nargs="+", required=True, help="图片路径")
    parser.add_argument("--public", action="store_true", help="公开发布；默认仅自己可见")
    parser.add_argument(
        "--post-time",
        help="定时发布时间：YYYY-MM-DD HH:MM:SS 或 13 位毫秒时间戳",
    )
    parser.add_argument("--topics", nargs="*", default=[], help="话题名称，不要带 #")
    parser.add_argument("--location", help="地点关键词")
    parser.add_argument("--proxy", help="HTTP/HTTPS 代理，例如 http://127.0.0.1:7890")
    parser.add_argument("--dry-run", action="store_true", help="仅做本地参数验证，不登录或发布")
    return parser


def main() -> int:
    args = create_parser().parse_args()
    try:
        if len(args.title) > 20:
            raise ValueError("标题不能超过 20 字")
        images = validate_images(args.images)
        post_time = parse_post_time(args.post_time)

        if args.dry_run:
            print("✅ 参数验证通过，不会登录或发布")
            print(f"标题: {args.title}")
            print(f"图片: {len(images)} 张")
            print(f"可见性: {'公开' if args.public else '仅自己可见'}")
            print(f"发布时间: {post_time or '立即发布'}")
            return 0

        print("正在验证 Creator 登录态并上传素材...")
        result = publish(args, images, post_time)
        print("✅ 小红书笔记发布成功")
        note_id = find_note_id(result)
        if note_id:
            print(f"笔记链接: https://www.xiaohongshu.com/explore/{note_id}")
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
