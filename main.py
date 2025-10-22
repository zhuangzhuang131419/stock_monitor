import requests
import time
from typing import Union, List, Tuple
import os
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import configparser
import sys


# ==============================================================================
# 1. 配置加载模块
# ==============================================================================

def load_config() -> Tuple[str, str, str, int, int, List[Tuple[str, float]]]:
    """
    从 config.ini 文件加载所有配置。
    如果文件不存在，会创建一个默认模板并退出。
    """
    config_file = 'config.ini'
    if not os.path.exists(config_file):
        print(f"错误: 配置文件 '{config_file}' 不存在。")
        print("已为您生成一个默认的配置文件，请填写您的API密钥和持仓后再运行。")

        default_config = configparser.ConfigParser()
        default_config['General'] = {
            'api_key': 'YOUR_API_KEY_HERE',
            'history_file': 'portfolio_history.csv',
            'plot_file': 'portfolio_chart.png'  # <--- 新增默认配置
        }
        default_config['Portfolio'] = {
            'AAPL': '100',
            'GOOGL': '50'
        }
        default_config['Settings'] = {
            'max_retries': '3',
            'retry_delay_seconds': '5'
        }
        with open(config_file, 'w') as f:
            default_config.write(f)
        sys.exit()

    config = configparser.ConfigParser()
    config.read(config_file)

    try:
        api_key = config.get('General', 'api_key')
        history_file = config.get('General', 'history_file')
        plot_file = config.get('General', 'plot_file')  # <--- 新增: 读取图表文件名
        max_retries = config.getint('Settings', 'max_retries')
        retry_delay = config.getint('Settings', 'retry_delay_seconds')

        portfolio = []
        for ticker, quantity in config.items('Portfolio'):
            portfolio.append((ticker.upper(), float(quantity)))

        if not portfolio:
            print("错误: 配置文件中的 [Portfolio] 部分为空，请至少添加一只股票。")
            sys.exit()

        # <--- 修改返回内容
        return api_key, history_file, plot_file, max_retries, retry_delay, portfolio

    except (configparser.NoSectionError, configparser.NoOptionError, ValueError) as e:
        print(f"错误: 配置文件 'config.ini' 格式不正确或缺少必要项: {e}")
        sys.exit()


# 在程序开始时加载所有配置
API_KEY, HISTORY_FILE, PLOT_FILE, MAX_RETRIES, RETRY_DELAY, portfolio = load_config()


# ==============================================================================
# 2. 获取股票价格的核心函数
# ==============================================================================
def get_stock_price(ticker: str) -> Union[tuple[float, str], None]:
    url = f'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={ticker}&apikey={API_KEY}'
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        global_quote = data.get('Global Quote')
        if global_quote and '05. price' in global_quote and '07. latest trading day' in global_quote:
            time.sleep(1)
            price = float(global_quote['05. price'])
            trading_day = global_quote['07. latest trading day']
            return price, trading_day
        else:
            print(f"警告: 无法从API响应中找到 '{ticker}' 的价格或交易日期。返回内容: {data}")
            time.sleep(1)
            return None
    except requests.exceptions.RequestException as e:
        print(f"错误: 请求 '{ticker}' 时发生网络错误: {e}")
        return None
    except (ValueError, KeyError) as e:
        print(f"错误: 解析 '{ticker}' 的价格数据时出错: {e}")
        return None


# ==============================================================================
# 3. 计算总价值并打印结果
# ==============================================================================
def calculate_portfolio_value() -> tuple[float, dict, Union[str, None]]:
    total_value = 0.0
    stock_values = {}
    portfolio_date = None
    print("正在获取您的投资组合价值...\n")
    for ticker, quantity in portfolio:
        result = None
        for attempt in range(MAX_RETRIES):
            result = get_stock_price(ticker)
            if result is not None:
                break
            else:
                print(
                    f"  - 警告: 获取 {ticker} 失败。将在 {RETRY_DELAY} 秒后进行第 {attempt + 1}/{MAX_RETRIES} 次重试...")
                time.sleep(RETRY_DELAY)
        if result is not None:
            price, fetched_date = result
            if portfolio_date is None:
                portfolio_date = fetched_date
            elif portfolio_date != fetched_date:
                print(f"  - 警告: {ticker} 的交易日 ({fetched_date}) 与组合其他部分 ({portfolio_date}) 不一致。")
            stock_value = price * quantity
            total_value += stock_value
            stock_values[ticker] = stock_value
            print(f"  - {ticker}: {quantity} 股 @ ${price:.2f} = ${stock_value:,.2f} (数据日期: {fetched_date})")
        else:
            stock_values[ticker] = 0
            print(f"  - 错误: 经过 {MAX_RETRIES} 次尝试后，仍无法获取 {ticker} 的价格，已跳过。")
    print("\n" + "=" * 40)
    if portfolio_date:
        print(f"投资组合总价值 (截至 {portfolio_date}): ${total_value:,.2f}")
    else:
        print(f"投资组合总价值: ${total_value:,.2f}")
    print("=" * 40)
    return total_value, stock_values, portfolio_date


# ==============================================================================
# 4. 将历史数据保存到文件
# ==============================================================================
def save_history(date_to_save: str, value_to_save: float, stock_values: dict):
    if not os.path.exists(HISTORY_FILE):
        current_tickers = sorted(stock_values.keys())
        header = 'date,total_value,' + ','.join(current_tickers) + '\n'
        values_line = [f"{stock_values.get(ticker, 0):.2f}" for ticker in current_tickers]
        new_line = f"{date_to_save},{value_to_save:.2f}," + ','.join(values_line) + '\n'
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            f.write(header)
            f.write(new_line)
        print(f"\n成功: 已创建文件并记录了 {date_to_save} 的数据。")
        return

    df = pd.read_csv(HISTORY_FILE)
    historical_tickers = sorted([col for col in df.columns if col not in ['date', 'total_value']])
    current_tickers = list(stock_values.keys())
    all_tickers = sorted(list(set(historical_tickers + current_tickers)))
    new_values_map = {ticker: f"{stock_values.get(ticker, 0):.2f}" for ticker in all_tickers}
    new_line_str = f"{date_to_save},{value_to_save:.2f}," + ','.join([new_values_map[t] for t in all_tickers])

    if date_to_save in df['date'].values:
        df.set_index('date', inplace=True)
        new_data_list = new_line_str.split(',')
        df.loc[date_to_save, 'total_value'] = float(new_data_list[1])
        for i, ticker in enumerate(all_tickers):
            df.loc[date_to_save, ticker] = float(new_data_list[i + 2])
        df.reset_index(inplace=True)
        print(f"\n提示: 日期 {date_to_save} 的数据已存在，将进行覆盖更新。")
    else:
        new_row_df = pd.DataFrame([new_line_str.split(',')], columns=['date', 'total_value'] + all_tickers)
        df = pd.concat([df, new_row_df], ignore_index=True)
        print(f"\n成功: 已将日期 {date_to_save} 的新数据追加到 {HISTORY_FILE}")

    df.fillna(0, inplace=True)
    df.to_csv(HISTORY_FILE, index=False, float_format='%.2f')


# ==============================================================================
# 5. 绘制历史价值图表并保存到文件
# ==============================================================================

def plot_history_graph(output_filename: str):
    """
    读取历史数据文件，绘制图表，并将其保存到指定的输出文件。
    """
    if not os.path.exists(HISTORY_FILE):
        print("找不到历史数据文件，无法绘制图表。")
        return
    df = pd.read_csv(HISTORY_FILE, index_col='date', parse_dates=True)
    df.fillna(0, inplace=True)
    if len(df) < 2:
        print("历史数据不足两个点，无法生成图表。")
        return

    stock_columns = [col for col in df.columns if col != 'total_value']
    fig, ax = plt.subplots(figsize=(16, 9))
    ax.stackplot(df.index, [df[col] for col in stock_columns], labels=stock_columns, alpha=0.8)
    ax.plot(df.index, df['total_value'], color='black', linewidth=2, linestyle='--', label='Total Value')
    ax.legend(loc='upper left')
    ax.set_title('Portfolio Value Over Time', fontsize=20)
    ax.set_ylabel('Value ($)', fontsize=14)
    ax.set_xlabel('Date', fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.5)
    formatter = mticker.FormatStrFormatter('$%1.0f')
    ax.yaxis.set_major_formatter(formatter)
    plt.xticks(rotation=45)
    plt.tight_layout()

    # --- 核心修改 ---
    try:
        # 将图表保存到文件，而不是显示它
        # dpi=300 保证了较高的分辨率
        # bbox_inches='tight' 会自动裁剪空白边缘，让图片更紧凑
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"\n成功: 图表已保存到文件 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存图表文件时出错: {e}")
    finally:
        # 关闭图形，释放内存
        plt.close(fig)


# ==============================================================================
# 6. 主执行逻辑
# ==============================================================================

if __name__ == "__main__":
    final_total_value, individual_stock_values, data_date = calculate_portfolio_value()
    if final_total_value > 0 and data_date is not None:
        save_history(data_date, final_total_value, individual_stock_values)
        # 调用函数绘制图表，并传入从配置中读取的文件名
        plot_history_graph(PLOT_FILE)
    elif data_date is None:
        print("\n错误: 未能从API获取到有效的交易日期，无法保存和绘图。")

