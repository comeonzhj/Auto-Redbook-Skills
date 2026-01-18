#!/usr/bin/env python3
"""
小红书笔记发布脚本
将生成的图片卡片发布到小红书

使用方法:
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png card_2.png

环境变量:
    在同目录下创建 .env 文件，配置 XHS_COOKIE：
    XHS_COOKIE=your_cookie_string_here

依赖安装:
    pip install xhs python-dotenv
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    from xhs import XhsClient
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("请运行: pip install xhs python-dotenv")
    sys.exit(1)


def load_cookie():
    """从 .env 文件加载 Cookie"""
    # 尝试从当前目录加载 .env
    env_path = Path.cwd() / '.env'
    if env_path.exists():
        load_dotenv(env_path)
    
    # 也尝试从脚本目录加载
    script_env = Path(__file__).parent.parent / '.env'
    if script_env.exists():
        load_dotenv(script_env)
    
    cookie = os.getenv('XHS_COOKIE')
    if not cookie:
        print("❌ 错误: 未找到 XHS_COOKIE 环境变量")
        print("请在当前目录创建 .env 文件，添加以下内容：")
        print("XHS_COOKIE=your_cookie_string_here")
        sys.exit(1)
    
    return cookie


def create_client(cookie: str) -> XhsClient:
    """创建小红书客户端"""
    try:
        # 使用本地签名
        from xhs.help import sign as local_sign
        
        def sign_func(uri, data=None, a1="", web_session=""):
            return local_sign(uri, data, a1=a1)
        
        client = XhsClient(cookie=cookie, sign=sign_func)
        return client
    except Exception as e:
        print(f"❌ 创建客户端失败: {e}")
        sys.exit(1)


def validate_images(image_paths: list) -> list:
    """验证图片文件是否存在"""
    valid_images = []
    for path in image_paths:
        if os.path.exists(path):
            valid_images.append(os.path.abspath(path))
        else:
            print(f"⚠️ 警告: 图片不存在 - {path}")
    
    if not valid_images:
        print("❌ 错误: 没有有效的图片文件")
        sys.exit(1)
    
    return valid_images


def publish_note(client: XhsClient, title: str, desc: str, images: list, 
                 is_private: bool = False, post_time: str = None):
    """发布图文笔记"""
    try:
        print(f"\n🚀 准备发布笔记...")
        print(f"  📌 标题: {title}")
        print(f"  📝 描述: {desc[:50]}..." if len(desc) > 50 else f"  📝 描述: {desc}")
        print(f"  🖼️ 图片数量: {len(images)}")
        
        result = client.create_image_note(
            title=title,
            desc=desc,
            files=images,
            is_private=is_private,
            post_time=post_time
        )
        
        print("\n✨ 笔记发布成功！")
        if isinstance(result, dict):
            note_id = result.get('note_id') or result.get('id')
            if note_id:
                print(f"  📎 笔记ID: {note_id}")
                print(f"  🔗 链接: https://www.xiaohongshu.com/explore/{note_id}")
        
        return result
        
    except Exception as e:
        print(f"\n❌ 发布失败: {e}")
        sys.exit(1)


def get_user_info(client: XhsClient):
    """获取当前登录用户信息"""
    try:
        info = client.get_self_info()
        print(f"\n👤 当前用户: {info.get('nickname', '未知')}")
        return info
    except Exception as e:
        print(f"⚠️ 无法获取用户信息: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description='将图片发布为小红书笔记'
    )
    parser.add_argument(
        '--title', '-t',
        required=True,
        help='笔记标题（不超过20字）'
    )
    parser.add_argument(
        '--desc', '-d',
        default='',
        help='笔记描述/正文内容'
    )
    parser.add_argument(
        '--images', '-i',
        nargs='+',
        required=True,
        help='图片文件路径（可以多个）'
    )
    parser.add_argument(
        '--private',
        action='store_true',
        help='是否设为私密笔记'
    )
    parser.add_argument(
        '--post-time',
        default=None,
        help='定时发布时间（格式：2024-01-01 12:00:00）'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='仅验证，不实际发布'
    )
    
    args = parser.parse_args()
    
    # 验证标题长度
    if len(args.title) > 20:
        print(f"⚠️ 警告: 标题超过20字，将被截断")
        args.title = args.title[:20]
    
    # 加载 Cookie
    cookie = load_cookie()
    
    # 验证图片
    valid_images = validate_images(args.images)
    
    # 创建客户端
    client = create_client(cookie)
    
    # 获取用户信息（验证 Cookie 有效性）
    get_user_info(client)
    
    if args.dry_run:
        print("\n🔍 验证模式 - 不会实际发布")
        print(f"  📌 标题: {args.title}")
        print(f"  📝 描述: {args.desc}")
        print(f"  🖼️ 图片: {valid_images}")
        print("\n✅ 验证通过，可以发布")
        return
    
    # 发布笔记
    publish_note(
        client=client,
        title=args.title,
        desc=args.desc,
        images=valid_images,
        is_private=args.private,
        post_time=args.post_time
    )


if __name__ == '__main__':
    main()
