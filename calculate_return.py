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
        return float(cell), 0.0
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
    try:
        period_start_day_loc = df_with_flows.index.searchsorted(start_date, side='left')
        if period_start_day_loc == 0:
            start_value = 0
            actual_start_date = df_with_flows.index[0]
        else:
            start_value = df_with_flows.iloc[period_start_day_loc - 1]['total_value']
            actual_start_date = df_with_flows.index[period_start_day_loc]

        period_end_day_loc = df_with_flows.index.searchsorted(end_date, side='right') - 1
        if period_end_day_loc < 0:
            raise IndexError
        actual_end_date = df_with_flows.index[period_end_day_loc]
        end_value = df_with_flows.iloc[period_end_day_loc]['total_value']

    except IndexError:
        return None

    period_df = df_with_flows.loc[actual_start_date:actual_end_date]
    trading_days = len(period_df)
    net_cash_flow = period_df['inferred_cash_flow'].sum()

    if start_value == 0 and len(period_df) > 0:
        initial_investment = period_df.iloc[0]['total_value'] - period_df.iloc[0]['investment_gain']
        net_cash_flow += initial_investment

    # '收益 (profit)' = market_gain
    market_gain = end_value - start_value - net_cash_flow

    # <<< 新增: '增值 (growth)' >>>
    growth = end_value - start_value

    denominator = start_value + net_cash_flow
    if abs(denominator) < 1e-6:
        return_rate = 0.0
    else:
        return_rate = market_gain / denominator

    # <<< 修改: 在返回结果中加入 'Growth' >>>
    return {
        "Period": period_name,
        "Start Date": actual_start_date.strftime('%Y-%m-%d'),
        "End Date": actual_end_date.strftime('%Y-%m-%d'),
        "Trading Days": trading_days,
        "Start Value": start_value,
        "End Value": end_value,
        "Inferred Flow": net_cash_flow,
        "Market Gain": market_gain,  # 收益 (profit)
        "Growth": growth,  # 增值 (growth)
        "Return": return_rate  # 收益率 (return)
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
    for index, row in df.iterrows():
        current_row_sum = 0
        for col in asset_columns:
            value, _ = parse_cell(row[col])
            current_row_sum += value
        df.loc[index, 'total_value'] = current_row_sum
    print("数据已加载，并根据各项资产之和修正了'total_value'列。")

    if len(df) < 2:
        print("错误: 历史数据不足两个交易日，无法进行收益计算。")
        return

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

    if len(available_trading_days) > 30:
        start_date_30 = available_trading_days[-30]
    else:
        start_date_30 = available_trading_days[0]
    periods["过去30个交易日"] = start_date_30

    if len(available_trading_days) > 250:
        start_date_250 = available_trading_days[-250]
    else:
        start_date_250 = available_trading_days[0]
    periods["过去250个交易日"] = start_date_250

    results = []
    for name, start_date in periods.items():
        result = calculate_period_return(df_with_flows, start_date, today, name)
        if result:
            results.append(result)

    if not results:
        print("未能计算任何周期的收益率。")
        return

    # ---【修改功能】---
    # 准备包含'period', 'return', 'profit', 'growth'的列表，用于生成JSON文件
    frontend_data = []
    for res in results:
        frontend_data.append({
            "period": res["Period"],
            "return": res["Return"],
            "profit": res["Market Gain"],  # 对应中文'收益'
            "growth": res["Growth"]  # 对应中文'增值'
        })

    # 将数据写入JSON文件
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(frontend_data, f, ensure_ascii=False, indent=2)
        print(f"\n已成功生成前端数据文件: '{OUTPUT_FILE}'")
    except Exception as e:
        print(f"\n错误：无法写入前端数据文件 '{OUTPUT_FILE}': {e}")
    # ---【修改功能结束】---

    # --- 以下是控制台输出部分，也做了相应更新 ---
    report_df = pd.DataFrame(results).set_index('Period')

    # <<< 修改: 在报告中加入 'Growth' 列 >>>
    final_columns = ['Start Date', 'End Date', 'Trading Days', 'Start Value', 'End Value', 'Inferred Flow',
                     'Market Gain', 'Growth', 'Return']
    report_df = report_df[final_columns]

    # 在列名映射中添加中文，让报告更清晰
    report_df.rename(columns={
        'Market Gain': '收益 (Profit)',
        'Growth': '增值 (Growth)',
        'Return': '收益率 (Return)'
    }, inplace=True)

    # <<< 修改: 格式化新增的 'Growth' 列 >>>
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
