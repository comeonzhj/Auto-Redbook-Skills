#!/usr/bin/env python3
"""
小红书笔记发布脚本 - 增强版
支持直接发布（本地签名）和通过 API 服务发布两种方式

使用方法:
    # 直接发布（使用本地签名）
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png
    
    # 通过 API 服务发布
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png --api-mode

环境变量:
    在同目录或项目根目录下创建 .env 文件，配置：
    
    # 必需：小红书 Cookie
    XHS_COOKIE=your_cookie_string_here
    
    # 可选：API 服务地址（使用 --api-mode 时需要）
    XHS_API_URL=http://localhost:5005

依赖安装:
    pip install xhs python-dotenv requests
"""

import argparse
import os
import sys
import json
import re
from pathlib import Path
from typing import List, Optional, Dict, Any

try:
    from dotenv import load_dotenv
    import requests
except ImportError as e:
    print(f": {e}")
    print(": pip install python-dotenv requests")
    sys.exit(1)


def load_cookie() -> str:
    """从 .env 文件加载 Cookie"""
    # 尝试从多个位置加载 .env
    env_paths = [
        Path.cwd() / '.env',
        Path(__file__).parent.parent / '.env',
        Path(__file__).parent.parent.parent / '.env',
    ]
    
    for env_path in env_paths:
        if env_path.exists():
            load_dotenv(env_path)
            break
    
    cookie = os.getenv('XHS_COOKIE')
    if not cookie:
        print(" :  XHS_COOKIE ")
        print(" .env ")
        print("XHS_COOKIE=your_cookie_string_here")
        print("\nCookie ")
        print("1. https://www.xiaohongshu.com")
        print("2. F12")
        print("3.  Network  Cookie ")
        print("4.  cookie ")
        sys.exit(1)
    
    return cookie


def ensure_no_proxy_for_xhs():
    """Ensure xiaohongshu domains bypass system proxies."""
    no_proxy = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    domains = ["xiaohongshu.com", "edith.xiaohongshu.com"]
    existing = [d.strip() for d in no_proxy.split(",") if d.strip()]
    for d in domains:
        if d not in existing:
            existing.append(d)
    value = ",".join(existing)
    os.environ["NO_PROXY"] = value
    os.environ["no_proxy"] = value


def parse_cookie(cookie_string: str) -> Dict[str, str]:
    """解析 Cookie 字符串为字典"""
    cookies = {}
    for item in cookie_string.split(';'):
        item = item.strip()
        if '=' in item:
            key, value = item.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies


def validate_cookie(cookie_string: str) -> bool:
    """验证 Cookie 是否包含必要的字段"""
    cookies = parse_cookie(cookie_string)
    
    # 检查必需的 cookie 字段
    required_fields = ['a1', 'web_session']
    missing = [f for f in required_fields if f not in cookies]
    
    if missing:
        print(f" Cookie : {', '.join(missing)}")
        print(" Cookie  a1  web_session ")
        return False
    
    return True


def get_api_url() -> str:
    """获取 API 服务地址"""
    return os.getenv('XHS_API_URL', 'http://localhost:5005')


def validate_images(image_paths: List[str]) -> List[str]:
    """验证图片文件是否存在"""
    valid_images = []
    for path in image_paths:
        if os.path.exists(path):
            valid_images.append(os.path.abspath(path))
        else:
            print(f" :  - {path}")
    
    if not valid_images:
        print(" : ")
        sys.exit(1)
    
    return valid_images


class LocalPublisher:
    """本地发布模式：直接使用 xhs 库"""
    
    def __init__(self, cookie: str):
        self.cookie = cookie
        self.client = None
        
    def init_client(self):
        """初始化 xhs 客户端"""
        try:
            from xhs import XhsClient
            from xhs.help import sign as local_sign
        except ImportError:
            print(" :  xhs ")
            print(": pip install xhs")
            sys.exit(1)
        
        # 解析 a1 值
        cookies = parse_cookie(self.cookie)
        a1 = cookies.get('a1', '')
        
        def sign_func(uri, data=None, ctime=None, a1_param="", b1_param="", **kwargs):
            # 兼容不同版本 xhs 的签名参数
            a1_val = a1 or a1_param
            return local_sign(uri, data, ctime=ctime, a1=a1_val, b1=b1_param)
        
        self.client = XhsClient(cookie=self.cookie, sign=sign_func)
        
    def get_user_info(self) -> Optional[Dict[str, Any]]:
        """获取当前登录用户信息"""
        try:
            info = self.client.get_self_info()
            print(f" : {info.get('nickname', '')}")
            return info
        except Exception as e:
            print(f" : {e}")
            return None
    
    def publish(self, title: str, desc: str, images: List[str], 
                is_private: bool = False, post_time: str = None) -> Dict[str, Any]:
        """发布图文笔记"""
        print(f"\n ...")
        print(f"   : {title}")
        print(f"   : {desc[:50]}..." if len(desc) > 50 else f"   : {desc}")
        print(f"   : {len(images)}")
        
        try:
            result = self.client.create_image_note(
                title=title,
                desc=desc,
                files=images,
                is_private=is_private,
                post_time=post_time
            )
            
            print("\n ")
            if isinstance(result, dict):
                note_id = result.get('note_id') or result.get('id')
                if note_id:
                    print(f"   ID: {note_id}")
                    print(f"   : https://www.xiaohongshu.com/explore/{note_id}")
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            print(f"\n : {error_msg}")
            
            # 提供具体的错误排查建议
            if 'sign' in error_msg.lower() or 'signature' in error_msg.lower():
                print("\n ")
                print("1.  Cookie  a1  web_session ")
                print("2. Cookie ")
                print("3.  --api-mode  API ")
            elif 'cookie' in error_msg.lower():
                print("\n Cookie ")
                print("1.  Cookie ")
                print("2. Cookie ")
                print("3.  Cookie ")
            
            raise


class ApiPublisher:
    """API 发布模式：通过 xhs-api 服务发布"""
    
    def __init__(self, cookie: str, api_url: str = None):
        self.cookie = cookie
        self.api_url = api_url or get_api_url()
        self.session_id = 'md2redbook_session'
        
    def init_client(self):
        """初始化 API 客户端"""
        print(f"  API : {self.api_url}")
        
        # 健康检查
        try:
            resp = requests.get(f"{self.api_url}/health", timeout=5)
            if resp.status_code != 200:
                raise Exception("API 服务不可用")
        except requests.exceptions.RequestException as e:
            print(f"  API : {e}")
            print(f"\n  xhs-api ")
            print(f"   cd xhs-api && python app_full.py")
            sys.exit(1)
        
        # 初始化 session
        try:
            resp = requests.post(
                f"{self.api_url}/init",
                json={
                    "session_id": self.session_id,
                    "cookie": self.cookie
                },
                timeout=30
            )
            result = resp.json()
            
            if resp.status_code == 200 and result.get('status') == 'success':
                print(f" API ")
                user_info = result.get('user_info', {})
                if user_info:
                    print(f" : {user_info.get('nickname', '')}")
            elif result.get('status') == 'warning':
                print(f" {result.get('message')}")
            else:
                raise Exception(result.get('error', '初始化失败'))
                
        except Exception as e:
            print(f" API : {e}")
            sys.exit(1)
    
    def get_user_info(self) -> Optional[Dict[str, Any]]:
        """获取当前登录用户信息"""
        try:
            resp = requests.post(
                f"{self.api_url}/user/info",
                json={"session_id": self.session_id},
                timeout=10
            )
            if resp.status_code == 200:
                result = resp.json()
                if result.get('status') == 'success':
                    info = result.get('user_info', {})
                    print(f" : {info.get('nickname', '')}")
                    return info
            return None
        except Exception as e:
            print(f" : {e}")
            return None
    
    def publish(self, title: str, desc: str, images: List[str], 
                is_private: bool = False, post_time: str = None) -> Dict[str, Any]:
        """发布图文笔记"""
        print(f"\n API ...")
        print(f"   : {title}")
        print(f"   : {desc[:50]}..." if len(desc) > 50 else f"   : {desc}")
        print(f"   : {len(images)}")
        
        try:
            payload = {
                "session_id": self.session_id,
                "title": title,
                "desc": desc,
                "files": images,
                "is_private": is_private
            }
            if post_time:
                payload["post_time"] = post_time
            
            resp = requests.post(
                f"{self.api_url}/publish/image",
                json=payload,
                timeout=120
            )
            result = resp.json()
            
            if resp.status_code == 200 and result.get('status') == 'success':
                print("\n ")
                publish_result = result.get('result', {})
                if isinstance(publish_result, dict):
                    note_id = publish_result.get('note_id') or publish_result.get('id')
                    if note_id:
                        print(f"   ID: {note_id}")
                        print(f"   : https://www.xiaohongshu.com/explore/{note_id}")
                return publish_result
            else:
                raise Exception(result.get('error', '发布失败'))
                
        except Exception as e:
            error_msg = str(e)
            print(f"\n : {error_msg}")
            raise


def main():
    # Ensure UTF-8 output on Windows consoles
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser(
        description='将图片发布为小红书笔记',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  # 基本用法
  python publish_xhs.py -t "我的标题" -d "正文内容" -i cover.png card_1.png card_2.png
  
  # 使用 API 模式
  python publish_xhs.py -t "我的标题" -d "正文内容" -i *.png --api-mode
  
  # 设为私密笔记
  python publish_xhs.py -t "我的标题" -d "正文内容" -i *.png --private
  
  # 定时发布
  python publish_xhs.py -t "我的标题" -d "正文内容" -i *.png --post-time "2024-12-01 10:00:00"
'''
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
        '--api-mode',
        action='store_true',
        help='使用 API 模式发布（需要 xhs-api 服务运行）'
    )
    parser.add_argument(
        '--api-url',
        default=None,
        help='API 服务地址（默认: http://localhost:5005）'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='仅验证，不实际发布'
    )
    
    args = parser.parse_args()
    
    # 验证标题长度
    if len(args.title) > 20:
        print(f" : 20")
        args.title = args.title[:20]
    
    # 加载 Cookie
    # Ensure XHS domains bypass proxy
    ensure_no_proxy_for_xhs()
    cookie = load_cookie()
    
    # 验证 Cookie 格式
    validate_cookie(cookie)
    
    # 验证图片
    valid_images = validate_images(args.images)
    
    if args.dry_run:
        print("\n  - ")
        print(f"   : {args.title}")
        print(f"   : {args.desc}")
        print(f"   : {valid_images}")
        print(f"   : {args.private}")
        print(f"   : {args.post_time or ''}")
        print(f"   : {'API' if args.api_mode else ''}")
        print("\n ")
        return
    
    # 选择发布方式
    if args.api_mode:
        publisher = ApiPublisher(cookie, args.api_url)
    else:
        publisher = LocalPublisher(cookie)
    
    # 初始化客户端
    publisher.init_client()
    
    # 发布笔记
    try:
        publisher.publish(
            title=args.title,
            desc=args.desc,
            images=valid_images,
            is_private=args.private,
            post_time=args.post_time
        )
    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
