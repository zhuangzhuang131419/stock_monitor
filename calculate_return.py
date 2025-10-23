import pandas as pd
from datetime import datetime
import json

# --- 配置 ---
HISTORY_FILE = 'portfolio_details_history.csv'
OUTPUT_FILE = 'portfolio_return.json'
EXCLUDE_COLS_FROM_SUM = ['total_value']


def parse_cell(cell):
    """
    解析 '(价值|价格)' 格式的字符串或数字。
    返回一个 (价值, 价格) 的元组。
    """
    try:
        if isinstance(cell, str) and cell.strip().startswith('(') and cell.strip().endswith(')'):
            parts = cell.strip()[1:-1].split('|')
            if len(parts) == 2:
                value = float(parts[0].strip())
                price = float(parts[1].strip())
                return value, price
        value = float(cell)
        return value, 1.0
    except (ValueError, TypeError, AttributeError):
        return 0.0, 0.0


def calculate_inferred_cash_flows(df):
    """
    计算每日的投资收益和推断的现金流。
    """
    df = df.sort_index(ascending=True)
    df['investment_gain'] = 0.0
    df['inferred_cash_flow'] = 0.0
    asset_columns = [col for col in df.columns if col not in ['total_value', 'investment_gain', 'inferred_cash_flow']]

    for i in range(1, len(df)):
        prev_day = df.iloc[i - 1]
        curr_day = df.iloc[i]

        start_of_day_value = prev_day['total_value']
        actual_end_of_day_value = curr_day['total_value']

        expected_end_of_day_value = 0.0
        for asset in asset_columns:
            prev_val, prev_price = parse_cell(prev_day.get(asset, '(0|0)'))
            _, curr_price = parse_cell(curr_day.get(asset, '(0|0)'))

            if prev_price > 0 and curr_price > 0:
                quantity = prev_val / prev_price
                expected_end_of_day_value += quantity * curr_price
            else:
                expected_end_of_day_value += prev_val

        gain = expected_end_of_day_value - start_of_day_value
        df.loc[curr_day.name, 'investment_gain'] = gain

        flow = actual_end_of_day_value - expected_end_of_day_value
        df.loc[curr_day.name, 'inferred_cash_flow'] = flow

    return df


def calculate_period_return(df_with_flows, start_date, end_date, period_name):
    """
    计算指定时间段内的回报率、收益和增值。
    """
    period_start_loc = df_with_flows.index.searchsorted(start_date, side='left')
    period_end_loc = df_with_flows.index.searchsorted(end_date, side='right') - 1

    if period_end_loc < period_start_loc:
        return None

    actual_start_date = df_with_flows.index[period_start_loc]
    actual_end_date = df_with_flows.index[period_end_loc]
    end_value = df_with_flows.iloc[period_end_loc]['total_value']

    period_df = df_with_flows.loc[actual_start_date:actual_end_date]
    trading_days = len(period_df)

    if period_start_loc == 0:
        start_value = df_with_flows.iloc[0]['total_value']
        net_cash_flow = period_df['inferred_cash_flow'].iloc[1:].sum()
        denominator = start_value + net_cash_flow
    else:
        start_value = df_with_flows.iloc[period_start_loc - 1]['total_value']
        net_cash_flow = period_df['inferred_cash_flow'].sum()
        denominator = start_value + net_cash_flow

    # --- 【核心逻辑修正】 ---
    # 收益 (Profit / Market Gain) = 期末值 - 期初值 - 期间现金流
    # 这部分是纯粹由市场价格波动带来的收益
    market_gain = end_value - start_value - net_cash_flow

    # 增值 (Growth) = 期末值 - 期初值
    # 这部分是账户总市值的绝对值变化，包含了现金流的影响
    growth = end_value - start_value
    # --- 【修正结束】 ---

    if abs(denominator) < 1e-6:
        return_rate = 0.0
    else:
        # 收益率计算仍然基于 market_gain，这是正确的，因为它衡量的是投资表现
        return_rate = market_gain / denominator

    return {
        "Period": period_name,
        "Start Date": actual_start_date.strftime('%Y-%m-%d'),
        "End Date": actual_end_date.strftime('%Y-%m-%d'),
        "Trading Days": trading_days,
        "Start Value": start_value,
        "End Value": end_value,
        "Inferred Flow": net_cash_flow,
        "Market Gain": market_gain,
        "Growth": growth,
        "Return": return_rate
    }


def main():
    """
    主执行函数
    """
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', 1000)

    try:
        df = pd.read_csv(HISTORY_FILE, index_col='date', parse_dates=True)
    except FileNotFoundError:
        print(f"错误: 找不到历史文件 '{HISTORY_FILE}'。")
        return

    asset_columns = [col for col in df.columns if col not in EXCLUDE_COLS_FROM_SUM]
    df['total_value'] = df.apply(
        lambda row: sum(parse_cell(row.get(col, 0))[0] for col in asset_columns),
        axis=1
    )
    print("数据已加载，并根据所有资产列（包括CASH）之和，在内部修正了'total_value'列。\n")

    if len(df) < 2:
        df['investment_gain'] = 0.0
        df['inferred_cash_flow'] = 0.0
        df_with_flows = df
        if len(df) < 1:
             print("错误: 历史数据为空，无法计算。")
             return
    else:
        df_with_flows = calculate_inferred_cash_flows(df)


    print("=" * 40)
    print("每日推断现金流分析:")
    print("=" * 40)
    print(df_with_flows[['total_value', 'investment_gain', 'inferred_cash_flow']].tail())
    print("\n说明:")
    print(" - investment_gain: 当日由市场价格波动产生的纯收益/亏损。")
    print(" - inferred_cash_flow: 推断的当日净现金流。正数代表入金或买入，负数代表出金或卖出。\n")

    today = pd.Timestamp.now().normalize()
    available_trading_days = df_with_flows.index[df_with_flows.index <= today]

    if available_trading_days.empty:
        print("错误: 历史数据中没有今天或今天之前的日期，无法计算收益率。")
        return

    periods = {
        "本周至今": today - pd.Timedelta(days=today.weekday()),
        "本月至今": today.replace(day=1),
        "本年至今": today.replace(day=1, month=1),
    }

    if len(available_trading_days) >= 30:
        periods["过去30个交易日"] = available_trading_days[-30]
    else:
        periods["过去30个交易日"] = available_trading_days[0]

    if len(available_trading_days) >= 250:
        periods["过去250个交易日"] = available_trading_days[-250]
    else:
        periods["过去250个交易日"] = available_trading_days[0]

    results = []
    for name, start_date in periods.items():
        result = calculate_period_return(df_with_flows, start_date, today, name)
        if result:
            results.append(result)

    if not results:
        print("未能计算任何周期的收益率。")
        return

    frontend_data = [{"period": r["Period"], "return": r["Return"], "profit": r["Market Gain"], "growth": r["Growth"]} for r in results]
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(frontend_data, f, ensure_ascii=False, indent=2)
        print(f"\n已成功生成前端数据文件: '{OUTPUT_FILE}'")
    except Exception as e:
        print(f"\n错误：无法写入前端数据文件 '{OUTPUT_FILE}': {e}")

    report_df = pd.DataFrame(results).set_index('Period')
    final_columns = ['Start Date', 'End Date', 'Trading Days', 'Start Value', 'End Value', 'Inferred Flow', 'Market Gain', 'Growth', 'Return']
    report_df = report_df[final_columns].rename(columns={'Market Gain': '收益 (Profit)', 'Growth': '增值 (Growth)', 'Return': '收益率 (Return)'})

    for col in ['Start Value', 'End Value', 'Inferred Flow', '收益 (Profit)', '增值 (Growth)']:
        report_df[col] = report_df[col].map('{:,.2f}'.format)
    report_df['收益率 (Return)'] = report_df['收益率 (Return)'].map('{:.2%}'.format)

    print("\n" + "=" * 130)
    print("投资组合近似收益率报告 (控制台输出)")
    print("=" * 130)
    print(report_df)
    print("-" * 130)
    print("注意：本报告为近似计算，依赖于每日持仓快照，未考虑日内交易和股息。")


if __name__ == "__main__":
    main()
