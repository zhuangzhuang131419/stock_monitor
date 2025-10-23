# 📈 stock_monitor

## 📘 简介
`stock_monitor` 是一个基于 **Python** 的投资组合监控与可视化工具。  
支持两种数据源：
- **yfinance**（默认）—— 可直接从雅虎财经获取数据，也可配置代理；
- **Alpha Vantage** —— 当网络环境不适合 yfinance 时可切换使用（需 API Key）。

主要功能包括：
- 从配置文件中读取持仓与参数；
- 自动获取股票和期权价格（支持代理与重试机制）；
- 计算投资组合总价值；
- 保存每日历史记录；
- 生成趋势图与当日仓位饼图；
- 支持现金余额记录与统计。

---

## ⚙️ 安装与配置

### 1. 克隆仓库
```bash
git clone https://github.com/cli117/stock_monitor.git
cd stock_monitor
```

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

---

## 🧩 requirements.txt

```txt
requests
pandas
matplotlib
numpy
yfinance
urllib3
datetime
```

---

## 🧾 配置文件说明 (`config.ini`)

程序启动时会读取根目录下的 `config.ini`。  
若文件不存在或缺失关键项，程序将报错退出（不会自动生成模板）。

示例配置如下：

```ini
[General]
# 数据源: 0 = yfinance (默认), 1 = Alpha Vantage
data_source = 0
api_key = YOUR_API_KEY

# 输出文件设置
history_file = portfolio_details_history.csv
plot_file = portfolio_value_chart.png
pie_chart_file = portfolio_pie_chart.png

[Proxy]
# 当网络不支持 yfinance 访问时启用代理
ip = 127.0.0.1
port = 7890

[Portfolio]
# 股票持仓配置：Ticker = 数量
VOO = 46.9266
MCD = 134.2509
ASML = 77.3702
GOOGL = 861
V = 149
ADBE = 130
BRK.B = 122

[OptionsPortfolio]
# 可选：期权持仓（支持负数表示卖出）
# 格式: UnderlyingTicker_YYYY-MM-DD_StrikePrice_Type = Quantity
# NVDA_2026-01-16_130_PUT = 5
# AAPL_2025-11-28_200_CALL = -2

[Cash]
# 现金余额（视为资产的一部分）
amount = 0.00

[Settings]
# 获取数据失败时的重试设置
max_retries = 10
retry_delay_seconds = 10
```

---

## 🚀 运行程序

```bash
python main.py
```

执行流程：
1. 读取配置；
2. 连接指定数据源（yfinance 或 Alpha Vantage）；
3. 获取股票与期权价格；
4. 计算总市值；
5. 更新历史记录；
6. 绘制趋势图和仓位饼图。

输出结果：
```
portfolio_details_history.csv
portfolio_value_chart.png
portfolio_pie_chart.png
```

---

## 📊 图表说明

- **趋势图 (`portfolio_value_chart.png`)**
  - 使用堆叠图展示各资产随时间变化；
  - 黑色虚线表示总资产变化趋势。

- **仓位饼图 (`portfolio_pie_chart.png`)**
  - 仅显示正持仓（价值 > 0）的比例；
  - 中心留白以便更清晰展示各资产占比。

---

## 🧠 高级功能

### 🧩 代理访问
当网络环境无法访问 `yfinance` 时：
- 在 `[Proxy]` 段中填写代理 IP 和端口；
- 程序会自动在直连失败后切换到代理模式重新获取数据。

### 🔑 Alpha Vantage 模式
若设置：
```ini
data_source = 1
```
则会使用 Alpha Vantage 获取数据。  
此时必须提供有效的：
```ini
api_key = YOUR_API_KEY
```
否则程序将直接退出。

### 💰 现金资产支持
在 `[Cash]` 段中填写金额，程序会自动将现金计入资产总值并在历史记录中显示。

---

## ⚙️ GitHub Actions 自动化运行

可在 `.github/workflows/stock-monitor.yml` 中配置自动执行脚本。  
例如：每天美东下午 6 点定时更新数据并自动提交。

```yaml
name: Run Python Script

on:
  workflow_dispatch:
  schedule:
    - cron: '0 22 * * 1-5'  # UTC 22:00 => 美东下午 5~6 点

jobs:
  build-and-commit:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          if [ -f requirements.txt ]; then
            pip install -r requirements.txt
          else
            echo "⚠️ requirements.txt not found, installing minimal dependencies..."
            pip install requests pandas matplotlib numpy yfinance urllib3
          fi

      - name: Run main script
        env:
          ALPHA_API_KEY: ${{ secrets.ALPHA_API_KEY }}
        run: |
          echo "=== Running main.py ==="
          if [ -n "${ALPHA_API_KEY}" ]; then
            echo "✅ Updating config.ini with ALPHA_API_KEY..."
            sed -i "s/^api_key = .*/api_key = ${ALPHA_API_KEY}/" config.ini
          fi
          python main.py

      - name: Commit updated files
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
          git add portfolio_details_history.csv portfolio_value_chart.png portfolio_pie_chart.png
          git diff --staged --quiet || git commit -m "📊 Automated data and chart update"
          git push
```

---

## ⚠️ 注意事项
- 若 `config.ini` 缺失或格式错误，程序将报错退出；
- yfinance 默认直连，可配置代理；
- Alpha Vantage 模式需有效 API Key；
- 程序不会自动生成配置模板；
- 建议在 `.gitignore` 中忽略输出文件：
  ```
  portfolio_details_history.csv
  portfolio_value_chart.png
  portfolio_pie_chart.png
  ```

---

## 🧑‍💻 贡献方式
欢迎提交改进建议：
1. Fork 本仓库  
2. 创建分支 `feature/xxx`  
3. 修改并提交  
4. 发起 Pull Request  

---

## 📄 License
本项目使用 **MIT 许可证**，详见 [LICENSE](LICENSE)。
