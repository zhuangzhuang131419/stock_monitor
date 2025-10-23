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
from datetime import datetime

# 禁用在代理模式下可能出现的 InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ==============================================================================
# 1. 配置加载模块
# ==============================================================================

# ==============================================================================
# 1. 配置加载模块
# ==============================================================================

def load_config():
    """
    从 config.ini 文件加载所有配置。
    (V5 - 增加现金配置)
    """
    config_file = 'config.ini'
    if not os.path.exists(config_file):
        print(f"错误: 配置文件 '{config_file}' 不存在，请先创建。")
        sys.exit()

    config = configparser.ConfigParser(inline_comment_prefixes=('#', ';'))
    config.read(config_file, encoding='utf-8')

    try:
        # [General] & [Settings]
        data_source = config.getint('General', 'data_source', fallback=0)
        api_key = config.get('General', 'api_key', fallback=None)
        history_file = config.get('General', 'history_file')
        plot_file = config.get('General', 'plot_file')
        pie_chart_file = config.get('General', 'pie_chart_file')
        max_retries = config.getint('Settings', 'max_retries')
        retry_delay = config.getint('Settings', 'retry_delay_seconds')

        if data_source == 1 and (not api_key or api_key == 'YOUR_API_KEY_HERE'):
            print("错误: data_source 设置为 1 (Alpha Vantage)，但未提供有效的 api_key。")
            sys.exit()

        # [Portfolio] - 股票
        portfolio = []
        for ticker, quantity in config.items('Portfolio'):
            portfolio.append((ticker.upper(), float(quantity)))

        # [OptionsPortfolio] - 期权
        options_portfolio = []
        if config.has_section('OptionsPortfolio'):
            for key, quantity_str in config.items('OptionsPortfolio'):
                try:
                    parts = key.upper().rsplit('_', 2)
                    if len(parts) != 3: continue
                    base, strike_str, opt_type = parts
                    date_parts = base.rsplit('_', 1)
                    if len(date_parts) != 2: continue
                    ticker, date_str = date_parts
                    if opt_type not in ['CALL', 'PUT']: continue
                    option_details = {
                        'key': key.upper(), 'ticker': ticker, 'expiry': date_str,
                        'strike': float(strike_str), 'type': opt_type, 'quantity': float(quantity_str)
                    }
                    options_portfolio.append(option_details)
                except Exception:
                    print(f"警告: 无法解析期权 '{key}'。")

        # [Proxy]
        proxy_ip = config.get('Proxy', 'ip', fallback=None)
        proxy_port = config.get('Proxy', 'port', fallback=None)
        if proxy_ip and proxy_port:
            proxy_port = int(proxy_port)
        else:
            proxy_ip, proxy_port = None, None

        # [Cash] - 新增：读取现金余额
        cash_amount = config.getfloat('Cash', 'amount', fallback=0.0)

        # 返回值中增加 cash_amount
        return (data_source, api_key, history_file, plot_file, pie_chart_file,
                max_retries, retry_delay, portfolio, options_portfolio, proxy_ip, proxy_port, cash_amount)

    except (configparser.NoSectionError, configparser.NoOptionError, ValueError) as e:
        print(f"错误: 配置文件 'config.ini' 格式不正确或缺少必要项: {e}")
        sys.exit()


# 在程序开始时加载所有配置
(DATA_SOURCE, API_KEY, HISTORY_FILE, PLOT_FILE, PIE_CHART_FILE, MAX_RETRIES,
 RETRY_DELAY, portfolio, options_portfolio, PROXY_IP, PROXY_PORT, CASH_AMOUNT) = load_config()


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


def get_option_price_yfinance(ticker, expiry, strike_price, option_type):
    """
    使用 yfinance 获取期权价格，并支持直连/代理智能切换。
    """
    option_name = f"{ticker} {expiry} {strike_price} {option_type}"

    # --- 模式一: 尝试直接连接 ---
    try:
        print(f"  - [yfinance-直连] 正在获取期权 {option_name}...")
        stock = yf.Ticker(ticker)
        chain = stock.option_chain(expiry)
        df = chain.calls if option_type == 'CALL' else chain.puts
        if df.empty: raise ValueError(f"未找到 {expiry} 的 {option_type} 期权链")
        contract = df[df['strike'] == strike_price]
        if contract.empty: raise ValueError(f"未找到行权价为 {strike_price} 的合约")
        price = contract.iloc[0]['lastPrice']
        trading_day = datetime.now().strftime('%Y-%m-%d')
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
            stock = yf.Ticker(ticker, session=session)
            chain = stock.option_chain(expiry)
            df = chain.calls if option_type == 'CALL' else chain.puts
            if df.empty: raise ValueError(f"通过代理仍未找到 {expiry} 的 {option_type} 期权链")
            contract = df[df['strike'] == strike_price]
            if contract.empty: raise ValueError(f"通过代理仍未找到行权价为 {strike_price} 的合约")
            price = contract.iloc[0]['lastPrice']
            trading_day = datetime.now().strftime('%Y-%m-%d')
            return price, trading_day
        except Exception as e_proxy:
            print(f"  - [yfinance-代理] 失败: {e_proxy}")
            return None


# ==============================================================================
# 3. 计算总价值并打印结果
# ==============================================================================
# ==============================================================================
# 3. 计算总价值并打印结果
# ==============================================================================
def calculate_portfolio_value():
    total_value = 0.0
    asset_values = {}
    portfolio_date = None

    # --- 1. 处理股票 ---
    source_name = "yfinance" if DATA_SOURCE == 0 else "Alpha Vantage"
    print(f"正在使用 [{source_name}] 获取您的股票价值...\n")
    for ticker, quantity in portfolio:
        result = None
        for attempt in range(MAX_RETRIES):
            get_price_func = get_stock_price_yfinance if DATA_SOURCE == 0 else get_stock_price_alphavantage
            result = get_price_func(ticker)
            if result is not None: break
            if attempt < MAX_RETRIES - 1:
                print(f"  - 获取 {ticker} 失败。将在 {RETRY_DELAY} 秒后重试...")
                time.sleep(RETRY_DELAY)
        if result:
            price, fetched_date = result
            if portfolio_date is None: portfolio_date = fetched_date
            stock_value = price * quantity
            total_value += stock_value
            asset_values[ticker] = stock_value
            print(f"  -> 成功: {ticker} {quantity:g} 股 @ ${price:.2f} = ${stock_value:,.2f}")
        else:
            asset_values[ticker] = 0
            print(f"  -> 错误: 经过 {MAX_RETRIES} 次尝试后，仍无法获取 {ticker} 的价格。")

    # --- 2. 处理期权 (仅当使用 yfinance 时) ---
    if DATA_SOURCE == 0 and options_portfolio:
        print("\n正在使用 [yfinance] 获取您的期权价值...\n")
        for opt in options_portfolio:
            result = None
            for attempt in range(MAX_RETRIES):
                result = get_option_price_yfinance(opt['ticker'], opt['expiry'], opt['strike'], opt['type'])
                if result is not None: break
                if attempt < MAX_RETRIES - 1:
                    print(f"  - 获取 {opt['key']} 失败。将在 {RETRY_DELAY} 秒后重试...")
                    time.sleep(RETRY_DELAY)
            if result:
                price, fetched_date = result
                if portfolio_date is None: portfolio_date = fetched_date
                option_value = price * opt['quantity'] * 100
                total_value += option_value
                asset_values[opt['key']] = option_value
                print(f"  -> 成功: {opt['key']} {opt['quantity']:g} 张 @ ${price:.2f} = ${option_value:,.2f}")
            else:
                asset_values[opt['key']] = 0
                print(f"  -> 错误: 经过 {MAX_RETRIES} 次尝试后，仍无法获取 {opt['key']} 的价格。")

    # --- 3. 添加现金 (新增部分) ---
    if CASH_AMOUNT > 0:
        asset_values['CASH'] = CASH_AMOUNT
        total_value += CASH_AMOUNT
        print(f"\n计入现金余额: ${CASH_AMOUNT:,.2f}")

    print("\n" + "=" * 50)
    print(f"投资组合总价值 (截至 {portfolio_date or '未知日期'}): ${total_value:,.2f}")
    print("=" * 50)
    return total_value, asset_values, portfolio_date


# ==============================================================================
# 4. 将历史数据保存到文件 (V2 - 使用 pandas 重构)
# ==============================================================================
def save_history(date_to_save, value_to_save, asset_values):
    """
    将当日的投资组合详情追加或更新到历史记录CSV文件中。
    - 如果当天记录已存在，则完全覆盖。
    - 自动对齐数据列，处理新增或移除的资产。
    - 在保存前，会自动删除在所有记录中都为0的列（清理已清仓的资产）。
    """
    # 1. 准备当日的新数据行
    new_row_data = {'total_value': value_to_save, **asset_values}
    new_row = pd.Series(new_row_data, name=date_to_save)

    # 2. 读取现有的历史数据
    if os.path.exists(HISTORY_FILE) and os.path.getsize(HISTORY_FILE) > 0:
        try:
            # 将第一列 'date' 作为索引来读取
            df = pd.read_csv(HISTORY_FILE, index_col='date')
        except (pd.errors.EmptyDataError, IndexError):
            df = pd.DataFrame() # 文件存在但为空或格式错误
    else:
        df = pd.DataFrame() # 文件不存在

    # 3. 核心逻辑：覆盖、对齐、清理

    # a) 覆盖当天数据：如果日期已存在，先删除旧行
    if date_to_save in df.index:
        df = df.drop(index=date_to_save)
        print(f"\n提示: 日期 {date_to_save} 的旧数据已找到，将进行覆盖更新。")
    else:
        print(f"\n成功: 已将 {date_to_save} 的新数据添加到历史记录。")

    # b) 添加新行：使用 concat 会自动按列名对齐。
    #    - 如果新行有df没有的列，df的老数据行在该列会填充NaN。
    #    - 如果df有新行没有的列，新行在该列会填充NaN。
    df = pd.concat([df, new_row.to_frame().T])

    # c) 填充与清理：将所有NaN填充为0，然后删除不再需要的列
    df = df.fillna(0)

    # 找到在所有行中值都为0的列
    cols_to_drop = df.columns[df.eq(0).all()]
    if not cols_to_drop.empty:
        df = df.drop(columns=cols_to_drop)
        print(f"清理了已归零的资产列: {', '.join(cols_to_drop.tolist())}")

    # 4. 重新排序列，确保 total_value 在前面
    if 'total_value' in df.columns:
        cols = df.columns.tolist()
        cols.remove('total_value')
        # 按字母顺序排资产列
        cols.sort()
        final_cols = ['total_value'] + cols
        df = df[final_cols]

    # 5. 保存更新后的 DataFrame 到 CSV 文件
    # 按日期降序排序后保存
    df.sort_index(ascending=False, inplace=True)
    df.to_csv(HISTORY_FILE, index=True, index_label='date', float_format='%.2f')

    print(f"历史记录已成功更新到: {HISTORY_FILE}")


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

    asset_columns = [col for col in df.columns if col != 'total_value']
    positive_assets = df[asset_columns].clip(lower=0)
    negative_assets = df[asset_columns].clip(upper=0)

    fig, ax = plt.subplots(figsize=(16, 9))

    ax.stackplot(df.index, positive_assets.T, labels=positive_assets.columns)
    ax.stackplot(df.index, negative_assets.T)

    ax.plot(df.index, df['total_value'], color='black', linewidth=2.5, linestyle='--', label='Total Value')

    ax.set_title('Portfolio Value Over Time', fontsize=20)
    ax.set_ylabel('Value ($)', fontsize=14)
    ax.set_xlabel('Date', fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.5)
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter('$%1.0f'))
    ax.set_xlim(df.index[0], df.index[-1])
    ax.axhline(0, color='black', linewidth=0.5)
    plt.xticks(rotation=45)
    plt.legend(loc='upper left')
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
def plot_pie_chart(asset_values, total_value, output_filename):
    print(f"正在生成当日仓位饼图...")
    positive_asset_values = {k: v for k, v in asset_values.items() if v > 0}
    if not positive_asset_values:
        print("没有正价值的持仓可用于生成饼图。")
        return

    positive_total = sum(positive_asset_values.values())

    labels = list(positive_asset_values.keys())
    sizes = list(positive_asset_values.values())

    fig, ax = plt.subplots(figsize=(12, 9))
    ax.pie(sizes, labels=labels, autopct=lambda p: f'{p:.1f}%' if p > 1 else '', startangle=90,
           pctdistance=0.85, colors=plt.cm.viridis(np.linspace(0, 1, len(labels))))

    centre_circle = plt.Circle((0, 0), 0.70, fc='white')
    fig.gca().add_artist(centre_circle)

    ax.set_title('Positive Asset Composition (Today)', fontsize=20)
    ax.axis('equal')
    plt.legend(labels, loc="best", bbox_to_anchor=(1, 0.5))
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
    final_total_value, all_asset_values, data_date = calculate_portfolio_value()

    if data_date is not None:
        save_history(data_date, final_total_value, all_asset_values)
        plot_history_graph(PLOT_FILE)
        plot_pie_chart(all_asset_values, final_total_value, PIE_CHART_FILE)
    else:
        print("\n错误: 未能获取到任何有效的交易日期，无法保存和绘图。")
