import pandas as pd
from datetime import datetime
import json

# --- 配置 ---
HISTORY_FILE = 'portfolio_details_history.csv'
OUTPUT_FILE = 'portfolio_return.json'
# 此列表用于计算 'total_value'，total_value 自身也应被排除
EXCLUDE_COLS_FROM_SUM = ['total_value']


def parse_cell(cell):
    """
    解析 '(价值|价格)' 格式的字符串或数字。
    返回一个 (价值, 价格) 的元组。
    """
    try:
        # 检查是否为 (价值|价格) 格式
        if isinstance(cell, str) and cell.strip().startswith('(') and cell.strip().endswith(')'):
            parts = cell.strip()[1:-1].split('|')
            if len(parts) == 2:
                value = float(parts[0].strip())
                price = float(parts[1].strip())
                return value, price
        # 否则，假定它是一个纯数值（如CASH或旧格式）
        value = float(cell)
        return value, 1.0  # 价格设为1.0
    except (ValueError, TypeError, AttributeError):
        return 0.0, 0.0  # 处理空值或解析失败


def calculate_inferred_cash_flows(df):
    """
    计算每日的投资收益、推断的现金流和每日收益率。
    """
    df = df.sort_index(ascending=True)
    df['investment_gain'] = 0.0
    df['inferred_cash_flow'] = 0.0
    df['daily_return'] = 0.0  # <-- 【新增】每日收益率 (TWRR的基础)

    # 找出所有资产列（排除所有计算列）
    asset_columns = [col for col in df.columns if col not in [
        'total_value', 'investment_gain', 'inferred_cash_flow', 'daily_return'
    ]]

    for i in range(1, len(df)):
        prev_day = df.iloc[i - 1]
        curr_day = df.iloc[i]

        # 期初值 = 上一日的收盘市值
        start_of_day_value = prev_day['total_value']
        # 期末实际值 = 今日的收盘市值
        actual_end_of_day_value = curr_day['total_value']

        # 计算期末期望值：假设没有交易，持仓不变，仅价格更新
        expected_end_of_day_value = 0.0
        for asset in asset_columns:
            prev_val, prev_price = parse_cell(prev_day.get(asset, '(0|0)'))
            _, curr_price = parse_cell(curr_day.get(asset, '(0|0)'))

            if prev_price > 0 and curr_price > 0:
                # 通过昨天的 价值/价格 计算出持有数量
                quantity = prev_val / prev_price
                # 数量 * 今天的价格 = 今天的期望价值
                expected_end_of_day_value += quantity * curr_price
            else:
                # 如果价格信息缺失（例如CASH或数据错误），则假定其价值不变
                expected_end_of_day_value += prev_val

        # 1. 投资收益 = 期望期末值 - 期初值
        gain = expected_end_of_day_value - start_of_day_value
        df.loc[curr_day.name, 'investment_gain'] = gain

        # 2. 推断现金流 = 实际期末值 - 期望期末值
        flow = actual_end_of_day_value - expected_end_of_day_value
        df.loc[curr_day.name, 'inferred_cash_flow'] = flow

        # 3. 【新增】每日收益率 = 投资收益 / 期初值
        if abs(start_of_day_value) > 1e-6:  # 避免除以零
            daily_ret = gain / start_of_day_value
            df.loc[curr_day.name, 'daily_return'] = daily_ret
        else:
            df.loc[curr_day.name, 'daily_return'] = 0.0

    return df


def calculate_period_return(df_with_flows, start_date, end_date, period_name):
    """
    计算指定时间段内的回报率(TWRR)、收益(Market Gain)和增值(Growth)。
    """
    # 寻找实际的开始和结束日期在DataFrame中的位置
    try:
        # 定位开始日：使用 'left' 找到 >= start_date 的第一个日期
        period_start_loc = df_with_flows.index.searchsorted(start_date, side='left')
        # 定位结束日：使用 'right' - 1 找到 <= end_date 的最后一个日期
        period_end_loc = df_with_flows.index.searchsorted(end_date, side='right') - 1
    except IndexError:
        return None  # 如果索引超出范围，则无法计算

    # 验证定位是否有效
    if period_end_loc < 0 or period_start_loc >= len(df_with_flows) or period_end_loc < period_start_loc:
        return None  # 无有效数据在此区间

    actual_start_date = df_with_flows.index[period_start_loc]
    actual_end_date = df_with_flows.index[period_end_loc]
    end_value = df_with_flows.iloc[period_end_loc]['total_value']

    period_df = df_with_flows.loc[actual_start_date:actual_end_date]
    trading_days = len(period_df)

    # 收益 (Market Gain), 增值 (Growth) 和 现金流 (Flow) 的计算
    if period_start_loc == 0:
        # 如果从历史第一天开始
        start_value = df_with_flows.iloc[0]['total_value']
        # 现金流不包括第一天，它被视为初始投资
        net_cash_flow = period_df['inferred_cash_flow'].iloc[1:].sum()

        # --- 【收益率 (Return) 修改】 ---
        # 使用TWRR: (1 + r_total) = (1 + r_1) * (1 + r_2) ...
        # 第一天没有 'daily_return'，所以从 .iloc[1:] 开始
        return_rate = (1 + period_df['daily_return'].iloc[1:]).prod() - 1
    else:
        # 标准情况：期初值是开始日期前一个交易日的值
        start_value = df_with_flows.iloc[period_start_loc - 1]['total_value']
        net_cash_flow = period_df['inferred_cash_flow'].sum()

        # --- 【收益率 (Return) 修改】 ---
        # TWRR: 连乘该时段内所有的 'daily_return'
        return_rate = (1 + period_df['daily_return']).prod() - 1

    # 收益 (Profit / Market Gain) = 期末值 - 期初值 - 期间现金流
    # 这个计算逻辑保持不变，它本身是正确的。
    market_gain = end_value - start_value - net_cash_flow

    # 增值 (Growth) = 期末值 - 期初值 (包含了现金流的影响)
    # 这个计算逻辑也保持不变。
    growth = end_value - start_value

    # --- 【删除】原有的基于 'denominator' 的错误计算 ---

    return {
        "Period": period_name,
        "Start Date": actual_start_date.strftime('%Y-%m-%d'),
        "End Date": actual_end_date.strftime('%Y-%m-%d'),
        "Trading Days": trading_days,
        "Start Value": start_value,
        "End Value": end_value,
        "Inferred Flow": net_cash_flow,
        "Market Gain": market_gain,  # 绝对利润
        "Growth": growth,  # 市值增长
        "Return": return_rate  # TWRR 收益率
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

    # 1. 修正 'total_value'
    # 找出所有非排除列（即资产列）
    asset_columns = [col for col in df.columns if col not in EXCLUDE_COLS_FROM_SUM]
    df['total_value'] = df.apply(
        lambda row: sum(parse_cell(row.get(col, 0))[0] for col in asset_columns),
        axis=1
    )
    print("数据已加载，并根据所有资产列（包括CASH）之和，在内部修正了'total_value'列。\n")

    # 2. 计算每日流水
    if len(df) < 1:
        print("错误: 历史数据为空，无法计算。")
        return
    elif len(df) < 2:
        print("注意: 历史数据不足两个交易日，无法计算推断现金流和'上一交易日'的收益。")
        df['investment_gain'] = 0.0
        df['inferred_cash_flow'] = 0.0
        df['daily_return'] = 0.0  # <-- 【新增】
        df_with_flows = df
    else:
        # 核心计算：推断现金流和每日收益率
        df_with_flows = calculate_inferred_cash_flows(df)

    print("=" * 60)
    print("每日推断现金流与收益率分析 (最近5条):")
    print("=" * 60)
    # 【修改】增加 'daily_return' 的打印
    print(df_with_flows[['total_value', 'investment_gain', 'inferred_cash_flow', 'daily_return']].tail())
    print("\n说明:")
    print(" - investment_gain: 当日由市场价格波动产生的纯收益/亏损。")
    print(" - inferred_cash_flow: 推断的当日净现金流（非市场波动引起的市值变化）。")
    print(" - daily_return: 当日的时间加权收益率 (gain / prev_day_total_value)。\n")

    # 3. 定义周期
    # 将所有计算的结束日期定义为CSV文件中的最后一天
    end_of_period_date = df_with_flows.index[-1]
    all_trading_days = df_with_flows.index
    print(f"所有周期的计算将截止到数据中的最新日期: {end_of_period_date.strftime('%Y-%m-%d')}\n")

    periods = {}

    # 添加“上一交易日” (start 和 end 都是最后一天)
    if len(df_with_flows) >= 2:
        periods["上一交易日"] = (end_of_period_date, end_of_period_date)

    # 添加其他周期
    periods["本周至今"] = (end_of_period_date - pd.Timedelta(days=end_of_period_date.weekday()), end_of_period_date)
    periods["本月至今"] = (end_of_period_date.replace(day=1), end_of_period_date)
    periods["本年至今"] = (end_of_period_date.replace(day=1, month=1), end_of_period_date)

    # 添加“过去X个交易日”
    start_30 = all_trading_days[0] if len(all_trading_days) < 30 else all_trading_days[-30]
    periods["过去30个交易日"] = (start_30, end_of_period_date)

    start_250 = all_trading_days[0] if len(all_trading_days) < 250 else all_trading_days[-250]
    periods["过去250个交易日"] = (start_250, end_of_period_date)

    # 4. 循环计算
    results = []
    for name, (start_date, end_date) in periods.items():
        result = calculate_period_return(df_with_flows, start_date, end_date, name)
        if result:
            results.append(result)

    if not results:
        print("未能计算任何周期的收益率。")
        return

    # 5. 排序和输出
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

    # 6. 生成并打印控制台报告
    report_df = pd.DataFrame(results).set_index('Period')
    if not report_df.empty:
        report_df = report_df.reindex(desired_order).dropna(how='all')

        final_columns = ['Start Date', 'End Date', 'Trading Days', 'Start Value', 'End Value', 'Inferred Flow',
                         'Market Gain', 'Growth', 'Return']
        report_df = report_df[final_columns].rename(
            columns={
                'Market Gain': '收益 (Profit)',
                'Growth': '增值 (Growth)',
                'Return': '收益率 (TWRR)'  # <-- 【修改】明确标注为TWRR
            })

        for col in ['Start Value', 'End Value', 'Inferred Flow', '收益 (Profit)', '增值 (Growth)']:
            report_df[col] = report_df[col].map('{:,.2f}'.format)
        report_df['收益率 (TWRR)'] = report_df['收益率 (TWRR)'].map('{:.2%}'.format)

        print("\n" + "=" * 130)
        print("投资组合收益率报告 (时间加权法 TWRR)")
        print("=" * 130)
        print(report_df)
        print("-" * 130)
        print("注意：'收益率 (TWRR)' 反映投资策略的表现，排除了现金流时机的影响。")
        print("      '收益 (Profit)' 反映扣除现金流后，你实际赚到/亏损的绝对金额。")
        print("      '增值 (Growth)' 反映投资组合市值的绝对变化 (包含现金流影响)。")


if __name__ == "__main__":
    main()