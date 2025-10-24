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

def load_config():
    """
    从 config.ini 文件加载所有配置。
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

        # [Cash]
        cash_amount = config.getfloat('Cash', 'amount', fallback=0.0)

        return (data_source, api_key, history_file, plot_file, pie_chart_file,
                max_retries, retry_delay, portfolio, options_portfolio, proxy_ip, proxy_port, cash_amount)

    except (configparser.NoSectionError, configparser.NoOptionError, ValueError) as e:
        print(f"错误: 配置文件 'config.ini' 格式不正确或缺少必要项: {e}")
        sys.exit()


# 在程序开始时加载所有配置
(DATA_SOURCE, API_KEY, HISTORY_FILE, PLOT_FILE, PIE_CHART_FILE, MAX_RETRIES,
 RETRY_DELAY, portfolio, options_portfolio, PROXY_IP, PROXY_PORT, CASH_AMOUNT) = load_config()


# ==============================================================================
# 2. 获取资产价格的核心函数
# ==============================================================================

def get_stock_price_alphavantage(ticker):
    av_ticker = ticker.replace('-', '.')
    print(f"  - [AlphaVantage] 正在获取 {av_ticker}...")
    url = f'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={av_ticker}&apikey={API_KEY}'
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
            print(f"  - 警告: AlphaVantage 未能找到 '{av_ticker}' 的数据。 响应: {data}")
            time.sleep(1)
            return None
    except Exception as e:
        print(f"  - 错误: 请求 '{av_ticker}' 时发生网络错误: {e}")
        return None


def get_stock_price_yfinance(ticker):
    yf_ticker = ticker.replace('.', '-')
    try:
        print(f"  - [yfinance-直连] 正在获取 {yf_ticker}...")
        stock = yf.Ticker(yf_ticker)
        hist = stock.history(period='5d', auto_adjust=True)
        if hist.empty: raise ConnectionError(f"返回了空数据 (可能是无效代码: {yf_ticker})")
        last_trade = hist.iloc[-1]
        price = last_trade['Close']
        trading_day = last_trade.name.strftime('%Y-%m-%d')
        return price, trading_day
    except Exception as e:
        print(f"  - [yfinance-直连] 失败: {e}")
        if not PROXY_IP or not PROXY_PORT: return None
        print(f"  - [yfinance-代理] 正在通过 {PROXY_IP}:{PROXY_PORT} 尝试...")
        try:
            stock = yf.Ticker(yf_ticker)
            proxy_url = f"http://{PROXY_IP}:{PROXY_PORT}"
            hist = stock.history(period='5d', auto_adjust=True, proxy=proxy_url)
            # --- 修改结束 ---

            if hist.empty: raise ConnectionError("通过代理仍返回空数据。")
            last_trade = hist.iloc[-1];
            price = last_trade['Close']
            trading_day = last_trade.name.strftime('%Y-%m-%d')
            return price, trading_day
        except Exception as e_proxy:
            print(f"  - [yfinance-代理] 失败: {e_proxy}")
            return None


def get_option_price_yfinance(ticker, expiry, strike_price, option_type):
    option_name = f"{ticker} {expiry} {strike_price} {option_type}"
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
        if not PROXY_IP or not PROXY_PORT: return None
        print(f"  - [yfinance-代理] 正在通过 {PROXY_IP}:{PROXY_PORT} 尝试...")
        try:
            proxies = {'http': f'http://{PROXY_IP}:{PROXY_PORT}', 'https': f'http://{PROXY_IP}:{PROXY_PORT}'}
            session = requests.Session();
            session.proxies.update(proxies);
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
# (智能版) 4.2. 核心函数：获取股票/期权的历史价格
# ==============================================================================
def get_historical_stock_price(ticker, target_date):
    """
    获取给定资产在特定日期的收盘价。
    该函数现在可以智能处理股票和期权两种代码。
    """
    api_ticker = ticker.replace('.', '-')

    # --- 新增：智能识别并转换期权代码 ---
    if '_' in ticker:
        print(f"    -> 检测到期权代码 '{ticker}'，正在转换为yfinance格式...")
        try:
            parts = ticker.split('_')
            underlying = parts[0]
            date_parts = parts[1].split('-')
            strike = parts[2]
            option_type = parts[3][0].upper()  # 'PUT' -> 'P', 'CALL' -> 'C'

            # 格式化日期: 2026-01-16 -> 260116
            yy = date_parts[0][2:]
            mm = date_parts[1]
            dd = date_parts[2]

            # 格式化执行价: 130 -> 00130000 (8位，补零，包含3位小数)
            strike_price_formatted = f"{float(strike):.3f}".replace('.', '')
            strike_price_padded = strike_price_formatted.zfill(8)

            # 拼接成yfinance官方格式
            api_ticker = f"{underlying}{yy}{mm}{dd}{option_type}{strike_price_padded}"
            print(f"    -> 转换成功: '{api_ticker}'")

        except Exception as e:
            print(f"    -> 错误: 转换期权代码 '{ticker}' 失败: {e}")
            return None
    # --- 期权转换逻辑结束 ---

    try:
        stock = yf.Ticker(api_ticker)

        # 目标日期加一天，以确保能覆盖到当天的交易数据
        end_date = (pd.to_datetime(target_date) + pd.Timedelta(days=1)).strftime('%Y-%m-%d')

        # 获取从目标日期开始的历史数据
        hist = stock.history(start=target_date, end=end_date, auto_adjust=False)

        if not hist.empty:
            # 优先使用 'Close'，如果不存在，则使用 'close'
            if 'Close' in hist.columns:
                return hist['Close'].iloc[0]
            elif 'close' in hist.columns:
                return hist['close'].iloc[0]
            else:
                print(f"    -> 警告: 在 {target_date} 的数据中找不到 'Close' 或 'close' 列。")
                return None
        else:
            print(f"    -> 警告: yfinance未能返回 {api_ticker} 在 {target_date} 的任何数据。")
            # 尝试获取期权的info，对于某些情况可能有效
            if '_' in ticker:
                info = stock.info
                if 'lastPrice' in info:
                    print("    -> 备用方案: 从info中成功获取 'lastPrice'。")
                    return info['lastPrice']
            return None

    except Exception as e:
        print(f"HTTP Error 404: {e}")
        print(f"${api_ticker}: a可能已退市; 未找到时区")
        return None

# ==============================================================================
# 3. 计算总价值并收集价格
# ==============================================================================
def calculate_portfolio_value():
    """
    计算总价值，并同时收集每个资产的 (总价值, 单价) 元组。
    """
    total_value = 0.0
    asset_details = {}  # 将存储 (总价值, 单价) 的元组
    portfolio_date = None
    source_name = "yfinance" if DATA_SOURCE == 0 else "Alpha Vantage"

    print(f"正在使用 [{source_name}] 获取您的股票价值...\n")
    for ticker, quantity in portfolio:
        price, fetched_date = 0.0, None
        result = None
        for attempt in range(MAX_RETRIES):
            get_price_func = get_stock_price_yfinance if DATA_SOURCE == 0 else get_stock_price_alphavantage
            result = get_price_func(ticker)
            if result:
                price, fetched_date = result
                if portfolio_date is None: portfolio_date = fetched_date
                break
            if attempt < MAX_RETRIES - 1:
                print(f"  - 获取 {ticker} 失败。将在 {RETRY_DELAY} 秒后重试...")
                time.sleep(RETRY_DELAY)

        stock_value = price * quantity
        asset_details[ticker] = (stock_value, price)
        total_value += stock_value
        if result:
            print(f"  -> 成功: {ticker} {quantity:g} 股 @ ${price:.2f} = ${stock_value:,.2f}")
        else:
            print(f"  -> 错误: 经过 {MAX_RETRIES} 次尝试后，仍无法获取 {ticker} 的价格。价值记为0。")

    if DATA_SOURCE == 0 and options_portfolio:
        print("\n正在使用 [yfinance] 获取您的期权价值...\n")
        for opt in options_portfolio:
            price, fetched_date = 0.0, None
            result = None
            for attempt in range(MAX_RETRIES):
                result = get_option_price_yfinance(opt['ticker'], opt['expiry'], opt['strike'], opt['type'])
                if result:
                    price, fetched_date = result
                    if portfolio_date is None: portfolio_date = fetched_date
                    break
                if attempt < MAX_RETRIES - 1:
                    print(f"  - 获取 {opt['key']} 失败。将在 {RETRY_DELAY} 秒后重试...")
                    time.sleep(RETRY_DELAY)

            option_value = price * opt['quantity'] * 100
            asset_details[opt['key']] = (option_value, price)
            total_value += option_value
            if result:
                print(f"  -> 成功: {opt['key']} {opt['quantity']:g} 张 @ ${price:.2f} = ${option_value:,.2f}")
            else:
                print(f"  -> 错误: 经过 {MAX_RETRIES} 次尝试后，仍无法获取 {opt['key']} 的价格。价值记为0。")

    # ==========================================================================
    # VVVVVV  修改这里 VVVVVV
    # 无论现金是否为0，都将其作为一个资产类别进行记录，确保价格始终为1.0
    asset_details['CASH'] = (CASH_AMOUNT, 1.0)
    total_value += CASH_AMOUNT
    # 仅在现金大于0时打印提示信息，避免混淆
    if CASH_AMOUNT > 0:
        print(f"\n计入现金余额: ${CASH_AMOUNT:,.2f}")
    # ^^^^^^  修改这里 ^^^^^^
    # ==========================================================================

    print("\n" + "=" * 50)
    print(f"投资组合总价值 (截至 {portfolio_date or '未知日期'}): ${total_value:,.2f}")
    print("=" * 50)
    return total_value, asset_details, portfolio_date


# ==============================================================================
# 4. 将历史数据保存到文件 (分隔符更新版)
# ==============================================================================
def save_history(date_to_save, value_to_save, asset_details):
    """
    将当日的投资组合详情追加或更新到历史记录CSV文件中。
    - 每个资产单元格现在存储一个字符串形式的元组: '(总价值|单价)'
    """
    # 1. 准备当日的新数据行，将元组格式化为字符串
    new_row_data = {'total_value': f"{value_to_save:.2f}"}
    for asset, (val, price) in asset_details.items():
        # 改动点: 分隔符从 ',' 变为 '|'
        new_row_data[asset] = f"({val:.2f}|{price:.2f})"

    new_row = pd.Series(new_row_data, name=date_to_save)

    # 2. 读取现有数据，确保所有内容都作为对象（字符串）处理
    if os.path.exists(HISTORY_FILE) and os.path.getsize(HISTORY_FILE) > 0:
        try:
            df = pd.read_csv(HISTORY_FILE, index_col='date', dtype=str)
        except (pd.errors.EmptyDataError, IndexError):
            df = pd.DataFrame()
    else:
        df = pd.DataFrame()

    # 3. 覆盖当天数据
    if date_to_save in df.index:
        df = df.drop(index=date_to_save)
        print(f"\n提示: 日期 {date_to_save} 的旧数据已找到，将进行覆盖更新。")
    else:
        print(f"\n成功: 已将 {date_to_save} 的新数据添加到历史记录。")

    # 4. 添加新行并对齐
    df = pd.concat([df, new_row.to_frame().T])

    # 5. 用代表0的元组字符串填充新出现的NaN值
    # 改动点: 分隔符从 ',' 变为 '|'
    df.fillna("(0.00|0.00)", inplace=True)
    # total_value列的NaN用 '0.00' 填充
    if 'total_value' in df.columns:
        # 改动点: 分隔符从 ',' 变为 '|'
        df['total_value'].replace("(0.00|0.00)", "0.00", inplace=True)

    # 6. 重新排序列
    if 'total_value' in df.columns:
        cols = [c for c in df.columns if c != 'total_value']
        cols.sort()
        final_cols = ['total_value'] + cols
        df = df[final_cols]

    # 7. 保存
    df.sort_index(ascending=False, inplace=True)
    df.to_csv(HISTORY_FILE, index=True, index_label='date')
    print(f"历史记录已成功更新到: {HISTORY_FILE}")


# ==============================================================================
# 5. 绘制历史价值图表 (分隔符更新版)
# ==============================================================================
def parse_value_from_cell(cell):
    """
    手动解析单元格的函数，不使用ast。
    能处理 '(价值|价格)' 格式和纯数字格式。
    """
    try:
        # 检查是否为字符串以及是否符合元组格式
        if isinstance(cell, str) and cell.strip().startswith('(') and cell.strip().endswith(')'):
            # 去除括号并按管道符分割
            # 改动点: 分隔符从 ',' 变为 '|'
            parts = cell.strip()[1:-1].split('|')
            if len(parts) == 2:
                # 提取第一个部分（总价值）并转换为浮点数
                return float(parts[0].strip())
            else:
                return 0.0
        # 如果不是元组格式的字符串，尝试直接转换为浮点数（兼容旧格式）
        return float(cell)
    except (ValueError, TypeError, AttributeError):
        # 如果转换失败（例如，空字符串或格式错误），返回0
        return 0.0


def plot_history_graph(output_filename):
    if not os.path.exists(HISTORY_FILE):
        print("找不到历史数据文件，无法绘制图表。")
        return

    # 读取原始数据，不立即转换
    df_raw = pd.read_csv(HISTORY_FILE, index_col='date', parse_dates=True)
    df_raw.sort_index(inplace=True)

    # 创建一个用于绘图的、只包含数值的DataFrame
    # *** 此处已根据您的反馈，将 applymap 替换为 map ***
    df_plot = df_raw.map(parse_value_from_cell)

    if len(df_plot) < 1:
        print("历史数据不足，无法生成图表。")
        return

    asset_columns = [col for col in df_plot.columns if col != 'total_value']
    positive_assets = df_plot[asset_columns].clip(lower=0)

    # 计算每个日期的累积值，用于定位标签
    df_cum = positive_assets.cumsum(axis=1)

    fig, ax = plt.subplots(figsize=(16, 9))

    # 绘制堆叠图
    colors = plt.cm.viridis(np.linspace(0, 1, len(asset_columns)))
    ax.stackplot(df_plot.index, positive_assets.T, labels=asset_columns, colors=colors)

    # 绘制总价值曲线
    ax.plot(df_plot.index, df_plot['total_value'], color='black', linewidth=2.5, linestyle='--', label='Total Value')

    # --- 在每个色块的起始位置添加标签 ---
    text_effect = [path_effects.Stroke(linewidth=3, foreground='black'), path_effects.Normal()]
    for col in asset_columns:
        col_data = positive_assets[col]
        # 寻找该资产第一次出现（值不为0）的日期索引
        first_occurrence_index = col_data.ne(0).idxmax()

        # 如果整个列都是0，idxmax会返回第一个索引，需要额外检查该点的值是否也为0
        if pd.isna(first_occurrence_index) or col_data.loc[first_occurrence_index] == 0:
            continue  # 如果该列全为0或找不到，则跳过

        # 计算标签的Y坐标：位于该色块垂直方向的中心
        # Y = (下方所有色块的高度) + (当前色块高度的一半)
        y_base = df_cum.loc[first_occurrence_index, col] - col_data.loc[first_occurrence_index]
        y_pos = y_base + 0.5 * col_data.loc[first_occurrence_index]

        # 添加文本
        ax.text(first_occurrence_index, y_pos, col, color='white', ha='left', va='center', fontsize=10,
                path_effects=text_effect, fontweight='bold')

    ax.set_title('Portfolio Value Over Time', fontsize=20, pad=20)
    ax.set_ylabel('Value ($)', fontsize=14)
    ax.set_xlabel('Date', fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.5)
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter('$%1.0f'))
    if not df_plot.index.empty:
        ax.set_xlim(df_plot.index[0], df_plot.index[-1])
    ax.axhline(0, color='black', linewidth=0.5)
    plt.xticks(rotation=45)
    plt.legend(loc='upper left', bbox_to_anchor=(1.02, 1), borderaxespad=0)
    plt.tight_layout()
    try:
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"\n成功: 历史趋势图已保存到 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存历史趋势图时出错: {e}")
    finally:
        plt.close(fig)


# ==============================================================================
# 6. 绘制当日仓位饼图 (实现实心饼图和内部标签)
# ==============================================================================
def plot_pie_chart(asset_details, output_filename):
    print(f"正在生成当日仓位饼图...")

    # 从 asset_details 中提取价值 > 0 的资产用于绘图
    asset_values = {k: v[0] for k, v in asset_details.items() if v[0] > 0}
    if not asset_values:
        print("没有正价值的持仓可用于生成饼图。")
        return

    labels = list(asset_values.keys())
    sizes = list(asset_values.values())
    total_size = sum(sizes)

    fig, ax = plt.subplots(figsize=(12, 12), subplot_kw=dict(aspect="equal"))

    # 绘制饼图，但不自动生成标签
    wedges, texts = ax.pie(sizes,
                           startangle=90,
                           colors=plt.cm.viridis(np.linspace(0, 1, len(labels))),
                           radius=1.2)  # 稍微增大半径以容纳标签

    ax.set_title('Positive Asset Composition (Today)', fontsize=20, pad=20)

    # --- 自定义内部标签 ---
    text_effect = [path_effects.Stroke(linewidth=3, foreground='black'), path_effects.Normal()]
    for i, wedge in enumerate(wedges):
        # 计算标签位置
        angle = (wedge.theta1 + wedge.theta2) / 2.
        x = wedge.r * 0.7 * np.cos(np.deg2rad(angle))
        y = wedge.r * 0.7 * np.sin(np.deg2rad(angle))

        # 准备标签文本
        percent = sizes[i] / total_size * 100
        label_text = f"{labels[i]}\n{percent:.1f}%"

        # 如果扇区太小，只显示百分比以避免重叠
        if percent < 4:
            label_text = f"{percent:.1f}%"

        # 添加文本
        ax.text(x, y, label_text,
                ha='center', va='center',
                color='white', fontsize=10,
                path_effects=text_effect, fontweight='bold')

    try:
        plt.savefig(output_filename, dpi=300, bbox_inches='tight')
        print(f"成功: 当日仓位饼图已保存到 '{output_filename}'")
    except Exception as e:
        print(f"\n错误: 保存仓位饼图时出错: {e}")
    finally:
        plt.close(fig)


# ==============================================================================
# (终极版) 6.1. 历史数据校验与修复模块 (分隔符更新+清仓清理版)
# ==============================================================================
def validate_and_repair_history():
    """
    校验并修复历史数据，并清理已售罄的资产列。
    使用 '|' 作为分隔符。
    """
    if not os.path.exists(HISTORY_FILE):
        return

    print("\n" + "=" * 50)
    print("开始执行历史数据完整性校验 (使用 '|' 分隔符)...")

    try:
        df = pd.read_csv(HISTORY_FILE, index_col='date', dtype=str)
    except Exception as e:
        print(f"错误: 读取历史文件 '{HISTORY_FILE}' 失败: {e}")
        return

    df_repaired = df.copy()
    changes_made = False

    # --- 数据修复循环 (代码与之前相同，此处省略) ---
    for date, row in df.iterrows():
        for ticker, cell_value in row.items():
            if ticker == 'total_value' or pd.isna(cell_value):
                continue
            # (此处省略现金、期权、股票的详细修复逻辑，因为它们没有变化)
            # ...
            # -------------------- 1. 现金 (CASH) 处理逻辑 --------------------
            if ticker == 'CASH':
                try:
                    is_tuple_format = isinstance(cell_value, str) and cell_value.strip().startswith('(')
                    cash_amount = 0.0
                    needs_fixing = False
                    if is_tuple_format:
                        parts = cell_value.strip()[1:-1].split('|')
                        cash_amount = float(parts[0].strip())
                        price = float(parts[1].strip()) if len(parts) > 1 else 0.0
                        if price != 1.0: needs_fixing = True
                    else:
                        cash_amount = float(cell_value)
                        needs_fixing = True
                    if needs_fixing:
                        new_cash_value = f"({cash_amount:.2f}|1.00)"
                        if df_repaired.at[date, ticker] != new_cash_value:
                            df_repaired.at[date, ticker] = new_cash_value
                            changes_made = True
                            print(f"  - 修正 CASH 格式: on {date}. 从 '{cell_value}' -> '{new_cash_value}'")
                except (ValueError, IndexError):
                    print(f"  - 警告: 无法解析 CASH 单元格 on {date}: '{cell_value}'")
                continue

            # -------------------- 2. 期权 (Options) 处理逻辑 --------------------
            elif '_' in ticker:
                total_val, price = 0.0, 0.0
                try:
                    if isinstance(cell_value, str) and cell_value.strip().startswith('('):
                        parts = cell_value.strip()[1:-1].split('|')
                        total_val = float(parts[0].strip())
                        price = float(parts[1].strip()) if len(parts) > 1 else 0.0
                    else:
                        total_val = float(cell_value)
                except (ValueError, IndexError):
                    print(f"  - 警告: 无法解析期权单元格 {ticker} on {date}: '{cell_value}'")
                    continue

                if total_val == 0:
                    correct_format = "(0.00|0.00)"
                    if cell_value.strip() not in ["(0.00|0.00)", "(0.0|0.0)"]:
                        df_repaired.at[date, ticker] = correct_format
                        changes_made = True
                        print(f"  - 修正零值期权格式: {ticker} on {date}. 从 '{cell_value}' -> '{correct_format}'")
                elif total_val > 0 and price <= 0:
                    print(f"  - 发现不一致期权数据: {ticker} on {date} [价值: {total_val:.2f}, 价格缺失]")
                    print(f"    -> 正在尝试获取 {date} 的历史价格...")
                    historical_price = get_historical_stock_price(ticker, date)
                    time.sleep(1)
                    if historical_price is not None:
                        new_cell_value = f"({total_val:.2f}|{historical_price:.2f})"
                        df_repaired.at[date, ticker] = new_cell_value
                        changes_made = True
                        print(f"    -> 成功修复期权: 价格更新为 ${historical_price:.2f}。新值为: {new_cell_value}")
                    else:
                        print(f"    -> 修复失败: 未能获取到期权 {ticker} 在 {date} 的历史价格。")
                continue

            # -------------------- 3. 股票 (Stock) 处理逻辑 --------------------
            else:
                total_val, price = 0.0, 0.0
                try:
                    if isinstance(cell_value, str) and cell_value.strip().startswith('('):
                        parts = cell_value.strip()[1:-1].split('|')
                        total_val = float(parts[0].strip())
                        price = float(parts[1].strip()) if len(parts) > 1 else 0.0
                    else:
                        total_val = float(cell_value)
                except (ValueError, IndexError):
                    continue
                if total_val > 0 and price <= 0:
                    print(f"  - 发现不一致股票数据: {ticker} on {date} [价值: {total_val:.2f}, 价格缺失]")
                    print(f"    -> 正在尝试获取 {date} 的历史价格...")
                    historical_price = get_historical_stock_price(ticker, date)
                    time.sleep(1)
                    if historical_price is not None:
                        new_cell_value = f"({total_val:.2f}|{historical_price:.2f})"
                        df_repaired.at[date, ticker] = new_cell_value
                        changes_made = True
                        print(f"    -> 成功修复股票: 价格更新为 ${historical_price:.2f}。新值为: {new_cell_value}")
                    else:
                        print(f"    -> 修复失败: 未能获取到股票 {ticker} 在 {date} 的历史价格。")

    # --- 改动点：新增清理已清仓资产列的逻辑 ---
    columns_to_drop = []
    asset_columns = [col for col in df_repaired.columns if col != 'total_value']

    for col in asset_columns:
        # 使用 parse_value_from_cell 函数检查该列所有值的总和是否为0
        try:
            # .apply() 在这里比 .map() 更安全，因为它作用于 Series
            total_asset_value = df_repaired[col].apply(parse_value_from_cell).sum()
            if total_asset_value == 0:
                columns_to_drop.append(col)
        except Exception:
            # 如果解析某列时出错，为安全起见，不删除该列
            continue

    if columns_to_drop:
        df_repaired.drop(columns=columns_to_drop, inplace=True)
        changes_made = True  # 标记已更改，以确保文件被保存
        print(f"\n信息: 检测到并清除了已售罄的资产列: {', '.join(columns_to_drop)}")
    # --- 清理逻辑结束 ---

    if changes_made:
        print("\n校验完成。发现并修复/清理了数据，正在保存更新后的历史文件...")
        try:
            df_repaired.to_csv(HISTORY_FILE, index=True, index_label='date')
            print(f"成功: 已将更新后的历史数据保存到 '{HISTORY_FILE}'")
        except Exception as e:
            print(f"错误: 保存更新后的历史文件失败: {e}")
    else:
        print("\n校验完成。未发现需要修复或清理的数据。")
    print("=" * 50)


# ==============================================================================
# 7. 主执行逻辑
# ==============================================================================
if __name__ == "__main__":
    final_total_value, all_asset_details, data_date = calculate_portfolio_value()

    if data_date is not None:
        save_history(data_date, final_total_value, all_asset_details)
        validate_and_repair_history()
        plot_history_graph(PLOT_FILE)
        # 饼图函数现在需要 asset_details
        plot_pie_chart(all_asset_details, PIE_CHART_FILE)
    else:
        print("\n错误: 未能获取到任何有效的交易日期，无法保存和绘图。")
