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
# 工作流名称
name: Run Python Script

# 工作流的触发条件
on:
  # 1. 允许您在 GitHub 页面的 "Actions" 标签下手动点击运行
  workflow_dispatch:
  
  # 2. 定时触发 (使用 Cron 语法)
  schedule:
    # 工作日 22:00 UTC 运行。
    # - 标准时间期间 (约11月-3月): 对应美东下午 5:00 (UTC-5)
    # - 夏令时期间 (约3月-11月): 对应美东下午 6:00 (UTC-4)
    - cron: '0 22 * * 1-5'

# 定义具体要执行的任务
jobs:
  build-and-commit:
    # 在一个最新的 Ubuntu 虚拟服务器上运行
    runs-on: ubuntu-latest

    # <<< 新增内容：授予工作流写权限
    permissions:
      contents: write

    steps:
      # 第1步：将您的代码仓库下载到虚拟服务器上
      - name: Checkout repository
        uses: actions/checkout@v3

      # 第2步：设置 Python 3.10 环境
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      # 第3步：安装脚本运行所需的 Python 库
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install requests pandas matplotlib numpy

      # 第4步：直接运行您的主脚本
      - name: Run main script
        run: python main.py

      # 第5步：将新生成或更新的文件提交回您的代码仓库
      - name: Commit updated files
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
          git add portfolio_details_history.csv portfolio_value_chart.png portfolio_pie_chart.png
          # 检查是否有文件被修改，如果有，才执行提交和推送
          git diff --staged --quiet || git commit -m "📊 Automated data and chart update"
          git push
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
