import requests
import time
from typing import Union
from datetime import datetime, timedelta  # <--- 新增的导入
import os  # <--- 新增的导入，用于检查文件是否存在

# ==============================================================================
# 1. 在这里配置您的投资组合和文件名
# ==============================================================================

# 您的投资组合列表
portfolio = [
    ('VOO', 46.9266),
    ('MCD', 134.2509),
    ('ASML', 77.3702),
    ('GOOGL', 861),
    ('V', 149),
    ('ADBE', 130),
    ('BRK.B', 122)
]

# 用于记录历史数据的文件名
HISTORY_FILE = 'portfolio_history.csv'  # <--- 新增：定义文件名常量

# Alpha Vantage API 密钥 (您提到可以直接使用 'YOUR_API_KEY')
API_KEY = 'YOUR_API_KEY'


# ==============================================================================
# 2. 获取股票价格的核心函数 (与您之前的版本相同)
# ==============================================================================

def get_stock_price(ticker: str) -> Union[float, None]:
    """
    使用 Alpha Vantage API 获取指定股票的最新价格。
    """
    # 注意: Alpha Vantage 免费版每分钟调用频率有限制 (通常是5次)。
    # 如果您的持仓列表较长，1秒的延时可能不够，会导致API调用失败。
    # 建议将 time.sleep 的值调高到 13 秒以上以确保稳定。
    # time.sleep(13)

    url = f'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={ticker}&apikey={API_KEY}'

    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()

        global_quote = data.get('Global Quote')
        if global_quote and '05. price' in global_quote:
            time.sleep(1)  # 保持您设置的1秒延时
            return float(global_quote['05. price'])
        else:
            print(f"警告: 无法从API响应中找到 '{ticker}' 的价格。返回内容: {data}")
            time.sleep(1)
            return None

    except requests.exceptions.RequestException as e:
        print(f"错误: 请求 '{ticker}' 时发生网络错误: {e}")
        return None
    except (ValueError, KeyError) as e:
        print(f"错误: 解析 '{ticker}' 的价格数据时出错: {e}")
        return None


# ==============================================================================
# 3. 计算总价值并打印结果 (已修改)
# ==============================================================================

def calculate_portfolio_value() -> float:  # <--- 修改：明确返回一个浮点数
    """
    计算并打印整个投资组合的总价值，并返回该值。
    """
    total_value = 0.0
    print("正在获取您的投资组合价值...\n")

    for ticker, quantity in portfolio:
        price = get_stock_price(ticker)

        if price is not None:
            stock_value = price * quantity
            total_value += stock_value
            print(f"  - {ticker}: {quantity} 股 @ ${price:.2f} = ${stock_value:,.2f}")
        else:
            print(f"  - {ticker}: 无法获取价格，已跳过。")

    print("\n" + "=" * 40)
    print(f"投资组合总价值: ${total_value:,.2f}")
    print("=" * 40)

    return total_value  # <--- 修改：返回计算出的总价值


# ==============================================================================
# 4. 将历史数据保存到文件 (全新函数)
# ==============================================================================

def save_history(date_to_save: str, value_to_save: float):
    """
    将日期和总价值追加到历史文件中，并确保每天只记录一次。
    """
    # 检查文件是否存在，如果不存在，则创建并写入表头
    if not os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            f.write('date,total_value\n')

    # 检查当天的数据是否已经存在
    with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            # strip() 移除换行符, split(',') 按逗号分割
            if line.strip().split(',')[0] == date_to_save:
                print(f"\n提示: 日期 {date_to_save} 的数据已存在于 {HISTORY_FILE} 中，本次将不重复记录。")
                return  # 如果找到匹配的日期，则直接退出函数

    # 如果没有找到匹配的日期，则以追加模式写入新数据
    with open(HISTORY_FILE, 'a', encoding='utf-8') as f:
        f.write(f"{date_to_save},{value_to_save:.2f}\n")

    print(f"\n成功: 已将日期 {date_to_save} 的总价值 ${value_to_save:,.2f} 记录到 {HISTORY_FILE}")


# ==============================================================================
# 5. 主执行逻辑 (已修改)
# ==============================================================================

if __name__ == "__main__":
    # 首先，计算出总价值
    final_total_value = calculate_portfolio_value()

    # 只有在成功计算出价值后（即价值大于0）才进行保存
    if final_total_value > 0:
        # 获取昨天的日期 (因为美股收盘时，中国已经是第二天)
        yesterday_date = datetime.now() - timedelta(days=1)
        date_string = yesterday_date.strftime('%Y-%m-%d')  # 格式化为 YYYY-MM-DD

        # 调用函数保存数据
        save_history(date_string, final_total_value)

