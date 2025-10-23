# 📈 stock_monitor

## 📘 简介
`stock_monitor` 是一个基于 Python 的股票组合监控与可视化工具。  
支持两种数据源：
- `yfinance`（默认）—— 可直接从雅虎财经获取数据，也可配置代理；
- `Alpha Vantage` —— 当网络环境不适合 yfinance 时可切换使用。

主要功能包括：
- 读取配置文件中的持仓与参数；
- 自动获取股票价格（支持代理与重试）；
- 计算投资组合总价值；
- 保存每日历史记录；
- 绘制趋势图与当日仓位饼图。

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

### 3. 配置文件
在项目根目录创建 `config.ini`，示例如下：

```ini
[General]
# 数据源: 0 = yfinance (默认), 1 = Alpha Vantage
data_source = 0
api_key = YOUR_API_KEY
history_file = portfolio_details_history.csv
plot_file = portfolio_value_chart.png
pie_chart_file = portfolio_pie_chart.png

[Proxy]
# 当网络不支持 yfinance 访问时启用代理
ip = 127.0.0.1
port = 7890

[Portfolio]
VOO = 46.9266
MCD = 134.2509
ASML = 77.3702
GOOGL = 861
V = 149
ADBE = 130
BRK.B = 122

[Settings]
max_retries = 10
retry_delay_seconds = 10
```

- 当 `data_source=0` 时使用 yfinance；
- 当 `data_source=1` 时使用 Alpha Vantage，**必须提供有效的 `api_key`**；
- 如果网络不通，脚本会自动尝试通过 `[Proxy]` 段的代理地址访问 yfinance；
- 若 `config.ini` 缺失或配置不完整，程序会报错退出。

---

## 🚀 运行
```bash
python main.py
```

程序执行步骤：
1. 读取配置并验证；
2. 从指定数据源获取每支股票价格；
3. 计算总市值；
4. 保存或更新历史文件；
5. 生成趋势图（stackplot）与当日仓位饼图。

输出结果：
```
portfolio_details_history.csv
portfolio_value_chart.png
portfolio_pie_chart.png
```

---

## 🧩 requirements.txt

```txt
requests>=2.31.0
pandas>=2.2.0
matplotlib>=3.7.0
numpy>=1.24.0
yfinance>=0.2.36
urllib3>=2.0.0
```

---

## 🤖 GitHub Actions 自动化运行

可以通过 GitHub Actions 定时自动执行脚本（例如每天美东下午 6 点），  
并自动将生成的图表与数据文件提交回仓库。

`.github/workflows/stock-monitor.yml` 示例：

```yaml
name: Stock Monitor

on:
  workflow_dispatch:
  schedule:
    - cron: '0 22 * * 1-5'  # 每个工作日 22:00 UTC 运行

jobs:
  run-monitor:
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
          pip install -r requirements.txt

      - name: Run stock monitor
        env:
          ALPHA_API_KEY: ${{ secrets.ALPHA_API_KEY }}
        run: |
          echo "=== Running stock monitor ==="

          # 如果 secrets 中设置了 ALPHA_API_KEY，则更新 config.ini
          if [ -n "${ALPHA_API_KEY}" ]; then
            echo "✅ Using ALPHA_API_KEY from secrets"
            if grep -q "^api_key" config.ini; then
              sed -i "s/^api_key = .*/api_key = ${ALPHA_API_KEY}/" config.ini
            else
              echo "api_key = ${ALPHA_API_KEY}" >> config.ini
            fi
          else
            echo "⚠️ ALPHA_API_KEY not found. Using config.ini setting."
          fi

          python main.py

      - name: Commit updated results
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add portfolio_details_history.csv portfolio_value_chart.png portfolio_pie_chart.png
          git diff --staged --quiet || git commit -m "📊 Automated data and chart update"
          git push
```

---

## ⚠️ 注意事项
- 若网络环境不支持 yfinance，可通过 `[Proxy]` 段配置 HTTP 代理；
- 若 `data_source=1`，需在 GitHub 仓库 `Settings → Secrets → Actions` 添加 `ALPHA_API_KEY`；
- 程序不会自动生成 `config.ini` 模板；
- 建议将输出文件加入 `.gitignore`，避免频繁冲突。

---

## 🧑‍💻 贡献方式
欢迎提交改进建议：
1. Fork 仓库  
2. 创建分支 `feature/xxx`  
3. 修改并提交  
4. 发起 Pull Request  

---

## 📄 License
本项目使用 MIT 许可证，详见 [LICENSE](LICENSE)。
