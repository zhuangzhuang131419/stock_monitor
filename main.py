import requests
import time
import os
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import configparser
import sys
import numpy as np
import matplotlib.patheffects as path_effects
import yfinance as yf
import urllib3

# 禁用在代理模式下可能出现的 InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ==============================================================================
# 1. 配置加载模块
# ==============================================================================

def load_config():
    """
    从 config.ini 文件加载所有配置。
    """
    config_file = 'config.ini'
    if not os.path.exists(config_file):
        print(f"错误: 配置文件 '{config_file}' 不存在，请先创建。")
        sys.exit()

    config = configparser.ConfigParser()
    config.read(config_file)

    try:
        # [General] & [Settings]
        data_source = config.getint('General', 'data_source', fallback=0)  # 默认改为0
        api_key = config.get('General', 'api_key', fallback=None)
        history_file = config.get('General', 'history_file')
        plot_file = config.get('General', 'plot_file')
        pie_chart_file = config.get('General', 'pie_chart_file')
        max_retries = config.getint('Settings', 'max_retries')
        retry_delay = config.getint('Settings', 'retry_delay_seconds')

        # 当选择 Alpha Vantage 时，检查 API Key
        if data_source == 1 and (not api_key or api_key == 'YOUR_API_KEY_HERE'):
            print("错误: data_source 设置为 1 (Alpha Vantage)，但未在 config.ini 中提供有效的 api_key。")
            sys.exit()

        # [Portfolio]
        portfolio = []
        for ticker, quantity in config.items('Portfolio'):
            portfolio.append((ticker.upper(), float(quantity)))
        if not portfolio:
            print("错误: 配置文件中的 [Portfolio] 部分为空，请至少添加一只股票。")
            sys.exit()

        # [Proxy]
        proxy_ip = config.get('Proxy', 'ip', fallback=None)
        proxy_port = config.get('Proxy', 'port', fallback=None)
        if proxy_ip and proxy_port:
            proxy_port = int(proxy_port)
        else:
            proxy_ip, proxy_port = None, None

        return (data_source, api_key, history_file, plot_file, pie_chart_file,
                max_retries, retry_delay, portfolio, proxy_ip, proxy_port)

    except (configparser.NoSectionError, configparser.NoOptionError, ValueError) as e:
        print(f"错误: 配置文件 'config.ini' 格式不正确或缺少必要项: {e}")
        sys.exit()


# 在程序开始时加载所有配置
(DATA_SOURCE, API_KEY, HISTORY_FILE, PLOT_FILE, PIE_CHART_FILE, MAX_RETRIES,
 RETRY_DELAY, portfolio, PROXY_IP, PROXY_PORT) = load_config()


# ==============================================================================
# 2. 获取股票价格的核心函数
# ==============================================================================

def get_stock_price_alphavantage(ticker):
    """
    使用 Alpha Vantage API 获取价格。
    会自动将 'BRK-B' 格式的 ticker 转换为 'BRK.B'。
    """
    av_ticker = ticker.replace('-', '.')
    print(f"  - [AlphaVantage] 正在获取 {av_ticker}...")
    url = f'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={av_ticker}&apikey={API_KEY}'
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        global_quote = data.get('Global Quote')
        if global_quote and '05. price' in global_quote and '07. latest trading day' in global_quote:
            time.sleep(1)  # Alpha Vantage 有速率限制
            price = float(global_quote['05. price'])
            trading_day = global_quote['07. latest trading day']
            return price, trading_day
        else:
            print(f"  - 警告: AlphaVantage 未能找到 '{av_ticker}' 的数据。 响应: {data}")
            time.sleep(1)
            return None
    except requests.exceptions.RequestException as e:
        print(f"  - 错误: 请求 '{av_ticker}' 时发生网络错误: {e}")
        return None
    except (ValueError, KeyError) as e:
        print(f"  - 错误: 解析 '{av_ticker}' 的数据时出错: {e}")
        return None


def get_stock_price_yfinance(ticker):
    """
    使用 yfinance 获取价格，并支持直连/代理智能切换。
    会自动将 'BRK.B' 格式的 ticker 转换为 'BRK-B'。
    """
    yf_ticker = ticker.replace('.', '-')

    # --- 模式一: 尝试直接连接 ---
    try:
        print(f"  - [yfinance-直连] 正在获取 {yf_ticker}...")
        stock = yf.Ticker(yf_ticker)
        hist = stock.history(period='5d', auto_adjust=True)
        if hist.empty:
            raise ConnectionError(f"返回了空数据 (可能是无效代码: {yf_ticker})")
        last_trade = hist.iloc[-1]
        price = last_trade['Close']
        trading_day = last_trade.name.strftime('%Y-%m-%d')
        return price, trading_day
    except Exception as e:
        print(f"  - [yfinance-直连] 失败: {e}")

        # --- 模式二: 检查并尝试代理连接 ---
        if not PROXY_IP or not PROXY_PORT:
            return None

        print(f"  - [yfinance-代理] 正在通过 {PROXY_IP}:{PROXY_PORT} 尝试...")
        try:
            proxies = {'http': f'http://{PROXY_IP}:{PROXY_PORT}', 'https': f'http://{PROXY_IP}:{PROXY_PORT}'}
            session = requests.Session()
            session.proxies.update(proxies)
            session.verify = False
            stock = yf.Ticker(yf_ticker, session=session)
            hist = stock.history(period='5d', auto_adjust=True)
            if hist.empty:
                raise ConnectionError("通过代理仍返回空数据。")
            last_trade = hist.iloc[-1]
            price = last_trade['Close']
            trading_day = last_trade.name.strftime('%Y-%m-%d')
            return price, trading_day
        except Exception as e_proxy:
            print(f"  - [yfinance-代理] 失败: {e_proxy}")
            return None


# ==============================================================================
# 3. 计算总价值并打印结果
# ==============================================================================
def calculate_portfolio_value():
    total_value = 0.0
    stock_values = {}
    portfolio_date = None

    source_name = "yfinance" if DATA_SOURCE == 0 else "Alpha Vantage"
    print(f"正在使用 [{source_name}] 获取您的投资组合价值...\n")

    for ticker, quantity in portfolio:
        result = None
        for attempt in range(MAX_RETRIES):
            # 根据配置选择调用的函数 (0=yfinance, 1=AlphaVantage)
            if DATA_SOURCE == 0:
                result = get_stock_price_yfinance(ticker)
            else:
                result = get_stock_price_alphavantage(ticker)

            if result is not None:
                break
            else:
                if attempt < MAX_RETRIES - 1:
                    print(f"  - 获取 {ticker} 失败。将在 {RETRY_DELAY} 秒后进行第 {attempt + 2}/{MAX_RETRIES} 次重试...")
                    time.sleep(RETRY_DELAY)
        if result is not None:
            price, fetched_date = result
            if portfolio_date is None:
                portfolio_date = fetched_date
            elif portfolio_date != fetched_date:
                print(f"  - 警告: {ticker} 的日期({fetched_date})与组合其他部分({portfolio_date})不一致。")
            stock_value = price * quantity
            total_value += stock_value
            stock_values[ticker] = stock_value
            print(f"  -> 成功: {ticker} {quantity} 股 @ ${price:.2f} = ${stock_value:,.2f} (日期: {fetched_date})")
        else:
            stock_values[ticker] = 0
            print(f"  -> 错误: 经过 {MAX_RETRIES} 次尝试后，仍无法获取 {ticker} 的价格。")

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
def save_history(date_to_save, value_to_save, stock_values):
    if not os.path.exists(HISTORY_FILE):
        current_tickers = sorted(stock_values.keys())
        header = 'date,total_value,' + ','.join(current_tickers) + '\n'
        values_line = [f"{stock_values.get(ticker, 0):.2f}" for ticker in current_tickers]
        new_line = f"{date_to_save},{value_to_save:.2f}," + ','.join(values_line) + '\n'
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            f.write(header)
            f.write(new_line)
        print(f"\n成功: 已创建并记录 {date_to_save} 的数据。")
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
            if ticker not in df.columns: df[ticker] = 0.0
            df.loc[date_to_save, ticker] = float(new_data_list[i + 2])
        df.reset_index(inplace=True)
        print(f"\n提示: 日期 {date_to_save} 的数据已覆盖更新。")
    else:
        new_row_df = pd.DataFrame([new_line_str.split(',')], columns=['date', 'total_value'] + all_tickers)
        df = pd.concat([new_row_df, df], ignore_index=True)
        print(f"\n成功: 已将 {date_to_save} 的新数据插入到文件。")

    df.fillna(0, inplace=True)
    final_columns = ['date', 'total_value'] + all_tickers
    df = df[final_columns]
    df.to_csv(HISTORY_FILE, index=False, float_format='%.2f')


# ==============================================================================
# 5. 绘制历史价值图表
# ==============================================================================
def plot_history_graph(output_filename):
    if not os.path.exists(HISTORY_FILE):
        print("找不到历史数据文件，无法绘制图表。")
        return
    df = pd.read_csv(HISTORY_FILE, index_col='date', parse_dates=True)
    df.sort_index(inplace=True)
    df.fillna(0, inplace=True)
    if len(df) < 2:
        print("历史数据不足，无法生成图表。")
        return
    stock_columns = [col for col in df.columns if col != 'total_value']
    fig, ax = plt.subplots(figsize=(16, 9))
    ax.stackplot(df.index, [df[col] for col in stock_columns], alpha=0.8, labels=stock_columns)
    ax.plot(df.index, df['total_value'], color='black', linewidth=2, linestyle='--', label='Total Value')
    y_bottom_df = df[stock_columns].cumsum(axis=1).shift(1, axis=1).fillna(0)
    for col in stock_columns:
        first_holding_mask = df[col] > 0
        if not first_holding_mask.any(): continue
        first_holding_day = first_holding_mask.idxmax()
        stock_value_on_day = df.loc[first_holding_day, col]
        y_bottom_on_day = y_bottom_df.loc[first_holding_day, col]
        label_y_pos = y_bottom_on_day + stock_value_on_day / 2.0
        ax.text(first_holding_day, label_y_pos, " " + col, ha='left', va='center', color='white', fontsize=11,
                fontweight='bold', path_effects=[path_effects.withStroke(linewidth=3, foreground='black')])
    ax.set_title('Portfolio Value Over Time', fontsize=20)
    ax.set_ylabel('Value ($)', fontsize=14)
    ax.set_xlabel('Date', fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.5)
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter('$%1.0f'))
    ax.set_xlim(df.index[0], df.index[-1])
    plt.xticks(rotation=45)
    plt.tight_layout()
    try:
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"\n成功: 历史趋势图已保存到 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存历史趋势图时出错: {e}")
    finally:
        plt.close(fig)


# ==============================================================================
# 6. 绘制当日仓位饼图
# ==============================================================================
def plot_pie_chart(stock_values, total_value, output_filename):
    print(f"正在生成当日仓位饼图...")
    positive_stock_values = {k: v for k, v in stock_values.items() if v > 0}
    if not positive_stock_values or total_value <= 0:
        print("没有有效的持仓数据可用于生成饼图。")
        return
    tickers = list(positive_stock_values.keys())
    sizes = list(positive_stock_values.values())
    fig, ax = plt.subplots(figsize=(12, 9))
    wedges, _ = ax.pie(sizes, startangle=90, colors=plt.cm.viridis(np.linspace(0, 1, len(sizes))))
    for i, p in enumerate(wedges):
        ang = (p.theta2 - p.theta1) / 2. + p.theta1
        radius = 0.7
        x = radius * np.cos(np.deg2rad(ang))
        y = radius * np.sin(np.deg2rad(ang))
        percentage = (sizes[i] / total_value) * 100
        label_text = f"{tickers[i]}\n{percentage:.1f}%"
        ax.text(x, y, label_text, ha='center', va='center', color='white', fontweight='bold', fontsize=11,
                path_effects=[path_effects.withStroke(linewidth=3, foreground='black')])
    ax.set_title('Portfolio Composition (Today)', fontsize=20)
    ax.axis('equal')
    try:
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"成功: 当日仓位饼图已保存到 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存仓位饼图时出错: {e}")
    finally:
        plt.close(fig)


# ==============================================================================
# 7. 主执行逻辑
# ==============================================================================
if __name__ == "__main__":
    final_total_value, individual_stock_values, data_date = calculate_portfolio_value()

    if final_total_value > 0 and data_date is not None:
        save_history(data_date, final_total_value, individual_stock_values)
        plot_history_graph(PLOT_FILE)
        plot_pie_chart(individual_stock_values, final_total_value, PIE_CHART_FILE)
    elif data_date is None:
        print("\n错误: 未能获取到任何有效的交易日期，无法保存和绘图。")
