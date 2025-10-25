import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
import numpy as np
import json
import warnings
import requests
import time

warnings.filterwarnings('ignore')


class PortfolioAnalyzer:
    def __init__(self, csv_file_path):
        """
        初始化投资组合分析器
        """
        self.csv_file = csv_file_path
        self.data = None
        self.latest_holdings = {}
        self.results = {}

    def load_data(self):
        """
        加载CSV数据并解析最新持仓
        """
        try:
            self.data = pd.read_csv(self.csv_file)
            self.data['date'] = pd.to_datetime(self.data['date'])
            self.data = self.data.sort_values('date', ascending=False)

            # 获取最新一天的数据
            latest_row = self.data.iloc[0]

            # 解析持仓数据（除了date和total_value列）
            for column in self.data.columns:
                if column not in ['date', 'total_value']:
                    value_str = latest_row[column]
                    if pd.notna(value_str) and value_str != '(0.00|0.00)':
                        # 解析格式如 "(45957.60|353.52)"
                        if '|' in str(value_str):
                            parts = str(value_str).strip('()').split('|')
                            if len(parts) == 2:
                                total_value = float(parts[0])
                                if total_value > 0:  # 只保留有价值的持仓
                                    self.latest_holdings[column] = {
                                        'total_value': total_value,
                                        'price': float(parts[1])
                                    }

            print(f"成功加载数据，最新持仓包含 {len(self.latest_holdings)} 个标的")
            return True

        except Exception as e:
            print(f"数据加载失败: {e}")
            return False

    def find_nearest_trading_day(self, target_date, symbol=None, max_days_back=10):
        """
        查找最近的交易日
        如果target_date不是交易日，向前查找最近的交易日
        """
        # 使用一个参考股票来获取交易日历，默认使用SPY（标普500 ETF）
        reference_symbol = "SPY"

        try:
            ticker = yf.Ticker(reference_symbol)

            # 获取一个较长时间范围的历史数据来确定交易日
            start_search = target_date - timedelta(days=max_days_back)
            end_search = target_date + timedelta(days=5)

            hist = ticker.history(start=start_search, end=end_search)

            if hist.empty:
                print(f"    -> 警告: 无法获取交易日历，使用原始日期")
                return target_date

            # 将索引转换为无时区的datetime
            hist.index = hist.index.tz_localize(None)

            # 查找小于等于目标日期的最近交易日
            available_dates = hist.index[hist.index <= target_date]

            if len(available_dates) > 0:
                nearest_date = available_dates[-1]  # 最近的交易日
                if nearest_date.date() != target_date.date():
                    print(f"    -> 调整交易日: {target_date.date()} -> {nearest_date.date()}")
                return nearest_date
            else:
                # 如果没有找到更早的交易日，查找稍后的交易日
                future_dates = hist.index[hist.index > target_date]
                if len(future_dates) > 0:
                    nearest_date = future_dates[0]
                    print(f"    -> 调整交易日(向后): {target_date.date()} -> {nearest_date.date()}")
                    return nearest_date
                else:
                    print(f"    -> 警告: 无法找到合适的交易日，使用原始日期")
                    return target_date

        except Exception as e:
            print(f"    -> 查找交易日时出错: {e}，使用原始日期")
            return target_date

    def is_option_symbol(self, symbol):
        """
        判断是否为期权代码
        """
        return '_' in symbol and ('PUT' in symbol.upper() or 'CALL' in symbol.upper())

    def parse_option_symbol(self, symbol):
        """
        解析期权代码，提取基础信息
        格式: TICKER_YYYY-MM-DD_STRIKE_TYPE
        """
        try:
            parts = symbol.split('_')
            if len(parts) != 4:
                return None

            ticker = parts[0]
            expiry = parts[1]
            strike = float(parts[2])
            option_type = parts[3].upper()

            return {
                'ticker': ticker,
                'expiry': expiry,
                'strike': strike,
                'type': option_type
            }
        except Exception as e:
            print(f"解析期权代码失败 {symbol}: {e}")
            return None

    def convert_option_to_yfinance_format(self, symbol):
        """
        将自定义期权格式转换为yfinance标准格式
        基于您之前代码的转换逻辑
        """
        try:
            parts = symbol.split('_')
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
            yf_symbol = f"{underlying}{yy}{mm}{dd}{option_type}{strike_price_padded}"

            return yf_symbol

        except Exception as e:
            print(f"转换期权代码失败 {symbol}: {e}")
            return None

    def get_option_current_price(self, symbol):
        """
        获取期权当前价格
        使用option_chain方法获取实时数据
        """
        option_info = self.parse_option_symbol(symbol)
        if not option_info:
            return None

        try:
            print(f"  - 获取期权当前价格: {symbol}")
            stock = yf.Ticker(option_info['ticker'])

            # 使用option_chain方法获取期权链数据
            chain = stock.option_chain(option_info['expiry'])
            df = chain.calls if option_info['type'] == 'CALL' else chain.puts

            if df.empty:
                print(f"    -> 未找到 {option_info['expiry']} 的 {option_info['type']} 期权链")
                return None

            # 查找特定行权价的合约
            contract = df[df['strike'] == option_info['strike']]
            if contract.empty:
                print(f"    -> 未找到行权价为 {option_info['strike']} 的合约")
                return None

            price = contract.iloc[0]['lastPrice']
            volume = contract.iloc[0]['volume']
            open_interest = contract.iloc[0]['openInterest']

            print(f"    -> 成功获取: ${price:.2f}, 成交量: {volume}, 未平仓: {open_interest}")

            return {
                'price': price,
                'volume': volume,
                'open_interest': open_interest,
                'success': True
            }

        except Exception as e:
            print(f"    -> 获取期权当前价格失败: {e}")
            return None

    def get_option_historical_price(self, symbol, target_date):
        """
        获取期权历史价格
        使用转换后的yfinance格式，并智能查找交易日
        """
        yf_symbol = self.convert_option_to_yfinance_format(symbol)
        if not yf_symbol:
            return None

        try:
            print(f"    -> 获取期权历史价格: {symbol} -> {yf_symbol}")

            # 首先查找最近的交易日
            trading_date = self.find_nearest_trading_day(target_date, symbol)

            ticker = yf.Ticker(yf_symbol)

            # 使用调整后的交易日期获取数据
            # 扩展搜索范围，从交易日前几天开始，到交易日后几天结束
            start_date = (trading_date - timedelta(days=3)).strftime('%Y-%m-%d')
            end_date = (trading_date + timedelta(days=3)).strftime('%Y-%m-%d')

            hist = ticker.history(start=start_date, end=end_date, auto_adjust=False)

            if not hist.empty:
                # 将索引转换为无时区的datetime
                hist.index = hist.index.tz_localize(None)

                # 查找最接近交易日的数据
                target_datetime = trading_date if isinstance(trading_date, datetime) else datetime.combine(trading_date,
                                                                                                           datetime.min.time())

                # 找到小于等于目标日期的最近数据
                available_dates = hist.index[hist.index <= target_datetime]

                if len(available_dates) > 0:
                    closest_date = available_dates[-1]

                    # 优先使用 'Close'，如果不存在，则使用 'close'
                    if 'Close' in hist.columns:
                        price = hist.loc[closest_date, 'Close']
                    elif 'close' in hist.columns:
                        price = hist.loc[closest_date, 'close']
                    else:
                        print(f"    -> 警告: 在数据中找不到 'Close' 或 'close' 列")
                        return None

                    print(f"    -> 成功获取历史价格: ${price:.2f} (日期: {closest_date.date()})")
                    return price
                else:
                    print(f"    -> 警告: 未找到合适的历史数据")
                    return None
            else:
                print(f"    -> 警告: 未能返回任何历史数据")
                # 尝试获取期权的info，对于某些情况可能有效
                try:
                    info = ticker.info
                    if 'lastPrice' in info and info['lastPrice'] > 0:
                        print("    -> 备用方案: 从info中获取 'lastPrice'")
                        return info['lastPrice']
                except:
                    pass
                return None

        except Exception as e:
            print(f"    -> 获取期权历史价格失败: {e}")
            return None

    def fix_symbol(self, symbol):
        """
        修复股票代码格式，基于Yahoo Finance要求
        """
        # 如果是期权，返回None，使用专门的期权处理逻辑
        if self.is_option_symbol(symbol):
            return None

        # 修复Berkshire Hathaway代码格式
        return symbol.replace('.', '-')

    def get_trading_dates(self, reference_date):
        """
        计算各个时间段的起始日期，返回datetime对象以匹配yfinance时区
        """
        # 转换为datetime对象以避免时区比较错误
        if isinstance(reference_date, datetime):
            ref_dt = reference_date
        else:
            ref_dt = datetime.combine(reference_date, datetime.min.time())

        # 上一交易日
        prev_trading_day = ref_dt - timedelta(days=1)

        # 本周至今（周一开始）
        days_since_monday = ref_dt.weekday()
        week_start = ref_dt - timedelta(days=days_since_monday)

        # 本月至今
        month_start = ref_dt.replace(day=1)

        # 本年至今
        year_start = ref_dt.replace(month=1, day=1)

        # 过去30个交易日（约6周）
        past_30_days = ref_dt - timedelta(days=45)

        # 过去250个交易日（约1年）
        past_250_days = ref_dt - timedelta(days=365)

        return {
            'prev_day': prev_trading_day,
            'week_to_date': week_start,
            'month_to_date': month_start,
            'year_to_date': year_start,
            'past_30_days': past_30_days,
            'past_250_days': past_250_days
        }

    def calculate_stock_returns(self, symbol, current_price, dates):
        """
        计算股票的各时间段收益率
        """
        returns = {}

        try:
            # 修复股票代码格式
            fixed_symbol = self.fix_symbol(symbol)
            if fixed_symbol is None:
                return {key: None for key in dates.keys()}

            ticker = yf.Ticker(fixed_symbol)

            # 获取历史数据（扩展时间范围以确保有足够数据）
            start_date = min(dates.values()) - timedelta(days=30)
            end_date = datetime.now()

            hist = ticker.history(start=start_date, end=end_date)

            if hist.empty:
                print(f"警告: {fixed_symbol} 没有历史数据")
                return {key: None for key in dates.keys()}

            # 将历史数据的索引转换为无时区的datetime，以便比较
            hist.index = hist.index.tz_localize(None)

            # 计算各时间段的收益率
            for period, start_datetime in dates.items():
                try:
                    # 对于股票，也使用交易日查找功能
                    trading_date = self.find_nearest_trading_day(start_datetime, fixed_symbol)

                    # 找到最接近起始日期的价格
                    available_dates = hist.index[hist.index >= trading_date]

                    if len(available_dates) == 0:
                        # 如果没有找到，尝试使用最早的可用数据
                        if len(hist) > 0:
                            start_price = hist.iloc[0]['Close']
                            return_pct = ((current_price - start_price) / start_price) * 100
                            returns[period] = round(return_pct, 2)
                        else:
                            returns[period] = None
                        continue

                    start_price = hist.loc[available_dates[0], 'Close']
                    return_pct = ((current_price - start_price) / start_price) * 100
                    returns[period] = round(return_pct, 2)

                except Exception as e:
                    print(f"计算 {fixed_symbol} {period} 收益率时出错: {e}")
                    returns[period] = None

        except Exception as e:
            print(f"获取 {symbol} 数据时出错: {e}")
            returns = {key: None for key in dates.keys()}

        return returns

    def calculate_option_returns(self, symbol, current_price, dates):
        """
        计算期权的各时间段收益率
        """
        returns = {}

        print(f"  计算期权收益率: {symbol}")

        # 计算各时间段的收益率
        for period, start_datetime in dates.items():
            try:
                print(f"    -> 处理时间段: {period} ({start_datetime.date()})")

                # 获取历史价格（现在会自动查找交易日）
                historical_price = self.get_option_historical_price(symbol, start_datetime)

                if historical_price is not None and historical_price > 0:
                    return_pct = ((current_price - historical_price) / historical_price) * 100
                    returns[period] = round(return_pct, 2)
                    print(f"    -> {period}: {return_pct:.2f}% (从 ${historical_price:.2f} 到 ${current_price:.2f})")
                else:
                    returns[period] = None
                    print(f"    -> {period}: 无历史数据")

                # 添加延迟避免过于频繁的请求
                time.sleep(0.5)

            except Exception as e:
                print(f"    -> 计算 {period} 收益率时出错: {e}")
                returns[period] = None

        return returns

    def calculate_returns(self, symbol, current_price, dates):
        """
        计算指定标的的各时间段收益率
        根据标的类型选择不同的处理方法
        """
        if self.is_option_symbol(symbol):
            return self.calculate_option_returns(symbol, current_price, dates)
        else:
            return self.calculate_stock_returns(symbol, current_price, dates)

    def analyze_portfolio(self):
        """
        分析整个投资组合
        """
        if not self.load_data():
            return False

        # 获取最新日期
        latest_date = self.data.iloc[0]['date']
        dates = self.get_trading_dates(latest_date)

        print(f"分析基准日期: {latest_date.date()}")
        print("开始分析各标的...")

        # 分析每个持仓标的
        for symbol, holding_info in self.latest_holdings.items():
            print(f"\n正在分析: {symbol}")

            current_price = holding_info['price']

            # 如果是期权，尝试获取更详细的当前信息
            if self.is_option_symbol(symbol):
                print(f"  检测到期权标的: {symbol}")
                option_current = self.get_option_current_price(symbol)
                if option_current and option_current['success']:
                    # 使用更新的期权价格（如果可用）
                    current_price = option_current['price']
                    print(f"  使用更新的期权价格: ${current_price:.2f}")

            returns = self.calculate_returns(symbol, current_price, dates)

            self.results[symbol] = {
                'current_price': current_price,
                'total_value': holding_info['total_value'],
                'returns': returns,
                'asset_type': 'option' if self.is_option_symbol(symbol) else 'stock'
            }

        return True

    def save_results(self, output_file='portfolio_assets_returns.json'):
        """
        保存结果到JSON文件
        """
        # 准备输出数据
        output_data = {
            'analysis_date': datetime.now().isoformat(),
            'portfolio_returns': {}
        }

        for symbol, data in self.results.items():
            output_data['portfolio_returns'][symbol] = {
                'current_price': data['current_price'],
                'total_value': data['total_value'],
                'asset_type': data['asset_type'],
                'returns': {
                    'previous_trading_day': data['returns']['prev_day'],
                    'week_to_date': data['returns']['week_to_date'],
                    'month_to_date': data['returns']['month_to_date'],
                    'year_to_date': data['returns']['year_to_date'],
                    'past_30_trading_days': data['returns']['past_30_days'],
                    'past_250_trading_days': data['returns']['past_250_days']
                }
            }

        # 保存到文件
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

        print(f"结果已保存到: {output_file}")
        return output_file

    def print_summary(self):
        """
        打印分析摘要
        """
        print("\n" + "=" * 80)
        print("投资组合收益率分析摘要")
        print("=" * 80)

        # 分类统计
        stocks = {k: v for k, v in self.results.items() if v['asset_type'] == 'stock'}
        options = {k: v for k, v in self.results.items() if v['asset_type'] == 'option'}

        print(f"\n持仓概览:")
        print(f"  股票: {len(stocks)} 个")
        print(f"  期权: {len(options)} 个")

        for symbol, data in self.results.items():
            asset_type_label = "【期权】" if data['asset_type'] == 'option' else "【股票】"
            print(f"\n{asset_type_label} {symbol}:")
            print(f"  当前价格: ${data['current_price']:.2f}")
            print(f"  持仓价值: ${data['total_value']:,.2f}")
            print("  收益率:")

            returns = data['returns']
            periods = [
                ('上一交易日', 'prev_day'),
                ('本周至今', 'week_to_date'),
                ('本月至今', 'month_to_date'),
                ('本年至今', 'year_to_date'),
                ('过去30个交易日', 'past_30_days'),
                ('过去250个交易日', 'past_250_days')
            ]

            for period_name, period_key in periods:
                value = returns[period_key]
                if value is not None:
                    color = "+" if value >= 0 else ""
                    print(f"    {period_name}: {color}{value:.2f}%")
                else:
                    print(f"    {period_name}: 无数据")


def main():
    """
    主函数
    """
    print("投资组合收益率历史获取工具 (支持股票和期权)")

    # 初始化分析器
    analyzer = PortfolioAnalyzer('portfolio_details_history.csv')

    # 执行分析
    if analyzer.analyze_portfolio():
        # 打印摘要
        analyzer.print_summary()

        # 保存结果
        output_file = analyzer.save_results()

        print(f"\n分析完成！结果已保存到 {output_file}")
        print("该文件可供前端读取显示")
    else:
        print("分析失败，请检查数据文件")


if __name__ == "__main__":
    main()
