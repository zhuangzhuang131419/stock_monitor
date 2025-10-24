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
    # 寻找实际的开始和结束日期在DataFrame中的位置
    try:
        period_start_loc = df_with_flows.index.searchsorted(start_date, side='left')
        period_end_loc = df_with_flows.index.searchsorted(end_date, side='right') - 1
    except IndexError:
        return None  # 如果索引超出范围，则无法计算

    # 验证定位是否有效
    if period_end_loc < 0 or period_start_loc >= len(df_with_flows) or period_end_loc < period_start_loc:
        return None

    actual_start_date = df_with_flows.index[period_start_loc]
    actual_end_date = df_with_flows.index[period_end_loc]
    end_value = df_with_flows.iloc[period_end_loc]['total_value']

    period_df = df_with_flows.loc[actual_start_date:actual_end_date]
    trading_days = len(period_df)

    # 核心计算逻辑：获取期初值和期间现金流
    if period_start_loc == 0:
        # 如果从历史第一天开始，没有“期初值”，期初值就是第一天的市值
        start_value = df_with_flows.iloc[0]['total_value']
        # 现金流不包括第一天，因为它被视为初始投资的一部分
        net_cash_flow = period_df['inferred_cash_flow'].iloc[1:].sum()
        denominator = start_value + net_cash_flow
    else:
        # 标准情况：期初值是开始日期前一个交易日的值
        start_value = df_with_flows.iloc[period_start_loc - 1]['total_value']
        net_cash_flow = period_df['inferred_cash_flow'].sum()
        denominator = start_value + net_cash_flow

    # 收益 (Profit / Market Gain) = 期末值 - 期初值 - 期间现金流
    market_gain = end_value - start_value - net_cash_flow

    # 增值 (Growth) = 期末值 - 期初值 (包含了现金流的影响)
    growth = end_value - start_value

    if abs(denominator) < 1e-6:
        return_rate = 0.0
    else:
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

    # 根据数据量决定如何处理
    if len(df) < 1:
        print("错误: 历史数据为空，无法计算。")
        return
    elif len(df) < 2:
        print("注意: 历史数据不足两个交易日，无法计算推断现金流和'上一交易日'的收益。")
        df['investment_gain'] = 0.0
        df['inferred_cash_flow'] = 0.0
        df_with_flows = df
    else:
        df_with_flows = calculate_inferred_cash_flows(df)

    print("=" * 40)
    print("每日推断现金流分析 (最近5条):")
    print("=" * 40)
    print(df_with_flows[['total_value', 'investment_gain', 'inferred_cash_flow']].tail())
    print("\n说明:")
    print(" - investment_gain: 当日由市场价格波动产生的纯收益/亏损。")
    print(" - inferred_cash_flow: 推断的当日净现金流。正数代表入金或买入，负数代表出金或卖出。\n")

    # --- 【核心逻辑修改】 ---
    # 1. 将所有计算的结束日期定义为CSV文件中的最后一天
    end_of_period_date = df_with_flows.index[-1]
    all_trading_days = df_with_flows.index
    print(f"所有周期的计算将截止到数据中的最新日期: {end_of_period_date.strftime('%Y-%m-%d')}\n")

    # 2. 统一创建所有周期，值为一个元组 (start_date, end_date)
    periods = {}

    # 添加“上一交易日”，它的 start 和 end 都是最后一个交易日
    if len(df_with_flows) >= 2:
        periods["上一交易日"] = (end_of_period_date, end_of_period_date)

    # 添加其他周期，它们的 end 都是 end_of_period_date
    periods["本周至今"] = (end_of_period_date - pd.Timedelta(days=end_of_period_date.weekday()), end_of_period_date)
    periods["本月至今"] = (end_of_period_date.replace(day=1), end_of_period_date)
    periods["本年至今"] = (end_of_period_date.replace(day=1, month=1), end_of_period_date)

    # 添加“过去X个交易日”
    start_30 = all_trading_days[0] if len(all_trading_days) < 30 else all_trading_days[-30]
    periods["过去30个交易日"] = (start_30, end_of_period_date)

    start_250 = all_trading_days[0] if len(all_trading_days) < 250 else all_trading_days[-250]
    periods["过去250个交易日"] = (start_250, end_of_period_date)

    # 3. 使用一个统一的循环来处理所有周期
    results = []
    for name, (start_date, end_date) in periods.items():
        result = calculate_period_return(df_with_flows, start_date, end_date, name)
        if result:
            results.append(result)
    # --- 【修改结束】 ---

    if not results:
        print("未能计算任何周期的收益率。")
        return

    # 为了保证输出顺序符合预期，进行一次排序
    desired_order = ["上一交易日", "本周至今", "本月至今", "本年至今", "过去30个交易日", "过去250个交易日"]
    sort_key = {name: i for i, name in enumerate(desired_order)}
    results.sort(key=lambda x: sort_key.get(x['Period'], 99))

    # 生成前端JSON文件
    frontend_data = [{"period": r["Period"], "return": r["Return"], "profit": r["Market Gain"], "growth": r["Growth"]}
                     for r in results]
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(frontend_data, f, ensure_ascii=False, indent=2)
        print(f"\n已成功生成前端数据文件: '{OUTPUT_FILE}'")
    except Exception as e:
        print(f"\n错误：无法写入前端数据文件 '{OUTPUT_FILE}': {e}")

    # 生成并打印控制台报告
    report_df = pd.DataFrame(results).set_index('Period')
    if not report_df.empty:
        report_df = report_df.reindex(desired_order).dropna(how='all')

        final_columns = ['Start Date', 'End Date', 'Trading Days', 'Start Value', 'End Value', 'Inferred Flow',
                         'Market Gain', 'Growth', 'Return']
        report_df = report_df[final_columns].rename(
            columns={'Market Gain': '收益 (Profit)', 'Growth': '增值 (Growth)', 'Return': '收益率 (Return)'})

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
