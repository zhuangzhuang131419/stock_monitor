# stock_monitor

## 📘 简介
`stock_monitor` 是一个基于 Python 的股票组合监控工具，使用 [Alpha Vantage API](https://www.alphavantage.co/) 获取实时股价数据。  
程序可以：
- 读取配置文件中的股票持仓；
- 获取最新股票价格；
- 计算投资组合总价值；
- 保存每日历史记录；
- 绘制趋势图与当日持仓饼图。

---

## ⚙️ 安装与运行

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
请在项目根目录下手动创建一个名为 `config.ini` 的文件。  
一个典型的示例如下：

```ini
[General]
api_key = YOUR_ALPHA_VANTAGE_API_KEY
history_file = portfolio_history.csv
plot_file = portfolio_chart.png
pie_chart_file = portfolio_pie_chart.png

[Portfolio]
AAPL = 100
GOOGL = 50

[Settings]
max_retries = 3
retry_delay_seconds = 5
```

如果该文件缺失或字段不完整，程序会报错，因此必须在运行前创建好。

---

## 🚀 运行

```bash
python main.py
```

运行时程序将：
1. 从 `config.ini` 读取持仓与参数；
2. 向 Alpha Vantage 请求股票价格；
3. 计算组合总市值；
4. 追加记录到 `portfolio_history.csv`；
5. 输出图表文件：
   - `portfolio_chart.png`：组合历史趋势（堆叠面积图）  
   - `portfolio_pie_chart.png`：当日持仓比例（带描边标签）

---

## 📊 输出结果

执行后你会在当前目录下看到：
```
portfolio_history.csv
portfolio_chart.png
portfolio_pie_chart.png
```

---

## 🤖 GitHub Actions 自动化运行

在 `.github/workflows/stock-monitor.yml` 中添加以下内容，可让脚本每日自动运行并提交结果：

```yaml
name: stock-monitor
on:
  schedule:
    - cron: '0 0 * * 1-5'  # 每个工作日 UTC 00:00 执行
  workflow_dispatch:

jobs:
  run-monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Run stock monitor
        env:
          ALPHA_API_KEY: ${{ secrets.ALPHA_API_KEY }}
        run: |
          # 通过环境变量替换 config.ini 里的 api_key（可选）
          sed -i "s/api_key = .*/api_key = ${ALPHA_API_KEY}/" config.ini
          python main.py

      - name: Commit results
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Auto update: portfolio results"
          file_pattern: |
            portfolio_history.csv
            portfolio_chart.png
            portfolio_pie_chart.png
```

### 📌 注意事项
- 程序不会自动创建 `config.ini`，你必须在仓库中手动提供；
- 如果使用 GitHub Actions，推荐将 `api_key` 存放在 **GitHub Secrets**；
- 输出文件（CSV、图表）会被自动提交回仓库。

---

## 🧑‍💻 开发与贡献

欢迎提交 Issue 或 PR：
1. Fork 仓库  
2. 创建分支 `git checkout -b feature-xxx`  
3. 修改并提交  
4. 发起 Pull Request  

---

## 📄 License
本项目使用 MIT 许可证，详见 [LICENSE](LICENSE)。
