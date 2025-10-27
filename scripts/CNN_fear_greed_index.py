#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CNN Fear and Greed Index Data Fetcher
获取CNN恐慌贪婪指数数据并保存到本地
"""

import requests
import json
import os
from datetime import datetime
from pathlib import Path


def fetch_fear_greed_index():
    """
    从CNN获取恐慌贪婪指数数据
    """
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"

    # 添加浏览器请求头，模拟真实浏览器访问
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.cnn.com/',
        'Origin': 'https://www.cnn.com',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
    }

    try:
        print(f"正在获取数据: {url}")
        response = requests.get(url, headers=headers, timeout=15)

        print(f"响应状态码: {response.status_code}")

        response.raise_for_status()  # 检查请求是否成功

        data = response.json()
        print("数据获取成功!")
        return data

    except requests.exceptions.HTTPError as e:
        print(f"HTTP错误: {e}")
        print(f"响应内容: {response.text[:500]}")  # 打印前500个字符
        return None
    except requests.exceptions.RequestException as e:
        print(f"请求失败: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"JSON解析失败: {e}")
        print(f"响应内容: {response.text[:500]}")
        return None


def save_data(data):
    """
    保存数据到 /data 目录
    """
    if data is None:
        print("没有数据可保存")
        return False

    # 获取脚本所在目录的父目录（根目录）
    script_dir = Path(__file__).resolve().parent  # /scripts
    root_dir = script_dir.parent  # 根目录
    data_dir = root_dir / "data"

    # 创建data目录（如果不存在）
    data_dir.mkdir(exist_ok=True)

    # 同时保存一个最新版本（覆盖）
    latest_filepath = data_dir / "fear_greed_index.json"

    try:
        # 保存最新版本
        with open(latest_filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"最新数据已保存到: {latest_filepath}")

        return True

    except Exception as e:
        print(f"保存文件失败: {e}")
        return False


def display_current_index(data):
    """
    显示当前的恐慌贪婪指数
    """
    if data is None:
        return

    try:
        # 尝试提取当前指数值
        if 'fear_and_greed' in data:
            current_score = data['fear_and_greed'].get('score')
            current_rating = data['fear_and_greed'].get('rating')
            timestamp = data['fear_and_greed'].get('timestamp')

            if current_score and current_rating:
                print("\n" + "=" * 50)
                print(f"当前恐慌贪婪指数: {current_score}")
                print(f"评级: {current_rating}")
                if timestamp:
                    print(f"时间: {timestamp}")
                print("=" * 50 + "\n")

                # 显示评级说明
                print("指数说明:")
                print("  0-25:   极度恐慌 (Extreme Fear)")
                print("  25-45:  恐慌 (Fear)")
                print("  45-55:  中性 (Neutral)")
                print("  55-75:  贪婪 (Greed)")
                print("  75-100: 极度贪婪 (Extreme Greed)")
                print()
    except Exception as e:
        print(f"解析指数数据时出错: {e}")


def main():
    """
    主函数
    """
    print("=" * 60)
    print("CNN Fear and Greed Index 数据获取工具")
    print("=" * 60 + "\n")

    # 获取数据
    data = fetch_fear_greed_index()

    # 显示当前指数
    display_current_index(data)

    # 保存数据
    if save_data(data):
        print("\n任务完成!")
    else:
        print("\n任务失败!")
        exit(1)


if __name__ == "__main__":
    main()
