import requests
import time
from typing import Union, List, Tuple
import os
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import configparser
import sys
import numpy as np
import matplotlib.patheffects as path_effects


# ==============================================================================
# 1. 配置加载模块 (已更新)
# ==============================================================================

def load_config() -> Tuple[str, str, str, str, int, int, List[Tuple[str, float]]]:
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
            'plot_file': 'portfolio_chart.png',
            'pie_chart_file': 'portfolio_pie_chart.png'  # <--- 新增: 饼图文件名
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
        plot_file = config.get('General', 'plot_file')
        pie_chart_file = config.get('General', 'pie_chart_file')  # <--- 新增: 读取饼图文件名
        max_retries = config.getint('Settings', 'max_retries')
        retry_delay = config.getint('Settings', 'retry_delay_seconds')

        portfolio = []
        for ticker, quantity in config.items('Portfolio'):
            portfolio.append((ticker.upper(), float(quantity)))

        if not portfolio:
            print("错误: 配置文件中的 [Portfolio] 部分为空，请至少添加一只股票。")
            sys.exit()

        return api_key, history_file, plot_file, pie_chart_file, max_retries, retry_delay, portfolio

    except (configparser.NoSectionError, configparser.NoOptionError, ValueError) as e:
        print(f"错误: 配置文件 'config.ini' 格式不正确或缺少必要项: {e}")
        sys.exit()


# 在程序开始时加载所有配置 (已更新)
API_KEY, HISTORY_FILE, PLOT_FILE, PIE_CHART_FILE, MAX_RETRIES, RETRY_DELAY, portfolio = load_config()


# ==============================================================================
# 2. 获取股票价格的核心函数 (无变化)
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
# 3. 计算总价值并打印结果 (无变化)
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
# 4. 将历史数据保存到文件 (已按要求修改)
# ==============================================================================
def save_history(date_to_save: str, value_to_save: float, stock_values: dict):
    """
    将当前数据保存到历史文件。
    - 如果文件不存在，则创建。
    - 如果日期已存在，则覆盖更新该行。
    - 如果是新日期，则将数据插入到文件的第一行。
    """
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
            if ticker in df.columns:
                df.loc[date_to_save, ticker] = float(new_data_list[i + 2])
            else:  # 新增的 Ticker
                df[ticker] = 0.0
                df.loc[date_to_save, ticker] = float(new_data_list[i + 2])
        df.reset_index(inplace=True)
        print(f"\n提示: 日期 {date_to_save} 的数据已存在，将进行覆盖更新。")
    else:
        # --- 主要修改点 ---
        # 创建新行 DataFrame
        new_row_df = pd.DataFrame([new_line_str.split(',')], columns=['date', 'total_value'] + all_tickers)
        # 将新行与旧的 DataFrame 合并，新行在前
        df = pd.concat([new_row_df, df], ignore_index=True)
        print(f"\n成功: 已将日期 {date_to_save} 的新数据插入到 {HISTORY_FILE} 的开头。")

    df.fillna(0, inplace=True)

    # 为确保每次保存的列顺序一致，按规则重新排列列
    final_columns = ['date', 'total_value'] + all_tickers
    df = df[final_columns]

    df.to_csv(HISTORY_FILE, index=False, float_format='%.2f')


# ==============================================================================
# 5. 绘制历史价值图表 (已添加排序以兼容修改)
# ==============================================================================
def plot_history_graph(output_filename: str):
    """
    读取历史数据文件，绘制堆叠面积图。
    标签会统一使用带黑色描边的白色文字，并标注在每个持仓的建仓日（最左侧）。
    """
    if not os.path.exists(HISTORY_FILE):
        print("找不到历史数据文件，无法绘制图表。")
        return
    df = pd.read_csv(HISTORY_FILE, index_col='date', parse_dates=True)

    # --- 必要的新增行 ---
    # 因为数据是按倒序存储的，绘图前必须按时间顺序对索引进行排序
    df.sort_index(inplace=True)

    df.fillna(0, inplace=True)
    if len(df) < 2:
        print("历史数据不足两个点，无法生成图表。")
        return

    stock_columns = [col for col in df.columns if col != 'total_value']

    fig, ax = plt.subplots(figsize=(16, 9))

    # --- 1. 绘制堆叠面积图 ---
    ax.stackplot(df.index, [df[col] for col in stock_columns], alpha=0.8, labels=stock_columns)

    # --- 2. 绘制总价值曲线 ---
    ax.plot(df.index, df['total_value'], color='black', linewidth=2, linestyle='--', label='Total Value')

    # --- 3. 核心修改: 在每个区域的建仓日（最左侧）添加带描边的标签 ---
    y_bottom_df = df[stock_columns].cumsum(axis=1).shift(1, axis=1).fillna(0)

    for col in stock_columns:
        first_holding_mask = df[col] > 0
        if not first_holding_mask.any():
            continue

        first_holding_day = first_holding_mask.idxmax()
        stock_value_on_day = df.loc[first_holding_day, col]
        y_bottom_on_day = y_bottom_df.loc[first_holding_day, col]
        label_y_pos = y_bottom_on_day + stock_value_on_day / 2.0

        ax.text(first_holding_day, label_y_pos, " " + col,
                ha='left',
                va='center',
                color='white',
                fontsize=11,
                fontweight='bold',
                path_effects=[path_effects.withStroke(linewidth=3, foreground='black')])

    ax.set_title('Portfolio Value Over Time', fontsize=20)
    ax.set_ylabel('Value ($)', fontsize=14)
    ax.set_xlabel('Date', fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.5)
    formatter = mticker.FormatStrFormatter('$%1.0f')
    ax.yaxis.set_major_formatter(formatter)
    ax.set_xlim(df.index[0], df.index[-1])

    plt.xticks(rotation=45)
    plt.tight_layout()

    try:
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"\n成功: 历史趋势图已保存到文件 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存历史趋势图文件时出错: {e}")
    finally:
        plt.close(fig)


# ==============================================================================
# 6. 新增: 绘制当日仓位饼图 (已更新描边效果)
# ==============================================================================
def plot_pie_chart(stock_values: dict, total_value: float, output_filename: str):
    """
    根据当日的各项股票价值，绘制仓位占比饼图。
    所有文字（股票代码和百分比）都会被设置为带黑色描边的白色字体。
    """
    print(f"正在生成当日仓位饼图...")

    # 过滤掉价值为0或负数的持仓
    positive_stock_values = {k: v for k, v in stock_values.items() if v > 0}
    if not positive_stock_values or total_value <= 0:
        print("没有有效的持仓数据可用于生成饼图。")
        return

    tickers = list(positive_stock_values.keys())
    sizes = list(positive_stock_values.values())

    fig, ax = plt.subplots(figsize=(12, 9))

    # --- 核心实现: 绘制饼图，并在扇区内添加带描边的 Ticker 和百分比 ---

    # 1. 先只画出饼图的基本结构
    wedges, _ = ax.pie(sizes, startangle=90, colors=plt.cm.viridis(np.linspace(0, 1, len(sizes))))

    # 2. 循环遍历每个扇区，手动添加自定义标签
    for i, p in enumerate(wedges):
        # 计算每个扇区中间点的角度
        ang = (p.theta2 - p.theta1) / 2. + p.theta1

        # 根据角度计算标签的 (x, y) 坐标，位置在半径的70%处
        radius = 0.7
        x = radius * np.cos(np.deg2rad(ang))
        y = radius * np.sin(np.deg2rad(ang))

        # 准备标签文字：股票代码 + 百分比
        ticker = tickers[i]
        percentage = (sizes[i] / total_value) * 100
        label_text = f"{ticker}\n{percentage:.1f}%"

        # 在计算出的位置上添加文字，并加入描边效果
        ax.text(x, y, label_text,
                ha='center', va='center',  # 水平和垂直居中
                color='white',             # 文字颜色
                fontweight='bold',         # 字体加粗
                fontsize=11,               # 字体大小
                # --- 核心改动: 添加描边效果 ---
                path_effects=[path_effects.withStroke(linewidth=3, foreground='black')])

    ax.set_title('Portfolio Composition (Today)', fontsize=20)
    ax.axis('equal')  # 保证饼图是正圆形

    try:
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"成功: 当日仓位饼图已保存到文件 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存仓位饼图文件时出错: {e}")
    finally:
        plt.close(fig)


# ==============================================================================
# 7. 主执行逻辑 (已更新)
# ==============================================================================
if __name__ == "__main__":
    final_total_value, individual_stock_values, data_date = calculate_portfolio_value()

    if final_total_value > 0 and data_date is not None:
        # 保存历史记录
        save_history(data_date, final_total_value, individual_stock_values)

        # 绘制历史趋势图
        plot_history_graph(PLOT_FILE)

        # 新增: 绘制当日仓位饼图
        plot_pie_chart(individual_stock_values, final_total_value, PIE_CHART_FILE)

    elif data_date is None:
        print("\n错误: 未能从API获取到有效的交易日期，无法保存和绘图。")