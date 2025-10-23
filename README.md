# 投资组合自动化分析系统

本项目提供一个完整的自动化投资组合分析与展示解决方案，包含：

- 🧠 **Python 后端**：执行数据分析、生成图表、输出结果文件；
- ☁️ **GitHub Actions 自动化工作流**：实现云端定时或手动触发分析；
- 🌐 **前端仪表盘（HTML/CSS/JS）**：可视化展示资产数据、直接在线修改配置；
- 📊 **结果文件自动上传与可视化**：包括总资产曲线图、分布饼图、历史明细表等。

---

## 🧩 项目结构

```
├── .github/
│   └── workflows/
│       └── main.yml              # 云端自动分析主流程
├── config.ini                    # 投资组合与系统配置
├── portfolio_details_history.csv # 历史资产明细（自动更新）
├── portfolio_value_chart.png     # 总资产曲线图（自动生成）
├── portfolio_pie_chart.png       # 资产分布图（自动生成）
├── requirements.txt              # Python 依赖
├── analyze_portfolio.py          # 主分析脚本
├── index.html                    # 前端仪表盘入口
├── style.css                     # 前端样式文件
├── script.js                     # 前端逻辑与交互
└── README.md                     # 项目说明文档（即本文档）
```

---

## 🚀 核心逻辑流程

1. **配置加载**
   - 从 `config.ini` 读取投资组合、现金、期权等信息；
   - 可包含数据源设定（目前包含Yahoo finance和Alpha vantage）。

2. **数据抓取与分析**
   - 自动获取股票与期权的实时或历史数据；
   - 计算总资产和权重占比等关键指标；
   - 输出表格与图表

3. **结果导出**
   - 输出以下文件至仓库根目录：
     - `portfolio_details_history.csv`
     - `portfolio_value_chart.png`
     - `portfolio_pie_chart.png`

4. **GitHub Actions 自动执行**
   - 工作流文件 `.github/workflows/main.yml` 控制执行；
   - 可设置手动触发（workflow_dispatch）或定时运行（schedule）；
   - 分析完成后自动提交并推送结果文件。

---

## 📦 本地运行（Python）

如果只使用github action自动化则可跳过本地运行步骤。
本项目依赖于 Python 3.9+，使用以下命令安装依赖：

```bash
pip install -r requirements.txt
```

**requirements.txt 内容：**

```
requests
pandas
matplotlib
numpy
yfinance
urllib3
```
依赖安装后直接运行main.py即可
```bash
python main.py
```

---

## ☁️ 部署与自动化执行

1. 将项目 Fork 或 Clone 到你自己的 GitHub 仓库；
2. 调整config.ini中的仓位；
3. 提交并推送后，GitHub Actions 会定时自动运行，也可在Action tab手动触发；
4. 运行完成后，在仓库中的输出文件可查看最新分析结果。

---

## 🌐 前端可视化仪表盘（可选，主要方便可视化和修改config.ini）

> **全新特性：前端可视化与云端联动**

项目现已支持通过 **GitHub Pages** 提供在线仪表盘界面，可实现以下功能：

- 查看最新的资产总览、历史曲线与分布饼图；
- 直接在线编辑 `config.ini`（仓位与设置）；
- 一键保存修改；
- 一键触发 GitHub Actions 云端重新分析。

---

### ✅ 部署步骤

1. 确认以下文件在仓库docs文件夹（默认位置即可）：
   ```
   index.html
   style.css
   script.js
   ```

2. 在 GitHub 仓库中启用 Pages：
   - 打开仓库 → Settings → Pages；
   - 选择 **Branch: main / (docs)**；
   - 保存后访问 `https://<你的用户名>.github.io/<仓库名>/`。

3. 打开网页后：
   - 首次访问时需输入你的 **Personal Access Token (PAT)**；
   - PAT 需具备：
     - `repo` 权限（读写 contents）
     - `workflow` 权限（运行 Actions）
   - 首次输入后将缓存在本地，可在仓位更新和其他设置页面清除缓存

4. 之后访问可：
   - 在 “资产概览” 标签页查看图表与总资产；
   - 在 “仓位更新” 或 “其他设置” 标签页修改配置；
   - 点击 “启动云端分析” 直接触发工作流。

---

### 🖼️ 页面结构概览

- **资产概览页**  
  - 显示总资产、趋势图、分布图；
  - 可一键启动分析；
  - 自动加载最新的 CSV 数据。

- **仓位更新页**  
  - 可编辑 `[Portfolio]` ， `[OptionsPortfolio]` 和 `[Cash]`；
  - 支持动态添加、删除项目；
  - 点击保存仓位保存到 `config.ini`。

- **其他设置页**  
  - 显示其他全局配置；
  - 亦可保存修改到 `config.ini`。

- **Token 授权弹窗**  
  - 验证用户 GitHub Token；
  - 成功后自动加载配置。

---

### ⚙️ 文件说明

| 文件 | 作用 |
|------|------|
| `index.html` | 仪表盘主页面结构 |
| `style.css` | 页面样式与布局优化 |
| `script.js` | 前端交互与 GitHub API 调用逻辑 |

---

### 🔐 安全提示

- 建议使用 **Fine-grained Personal Access Token**；
- 仅勾选所需权限（contents、workflows）；
- 不要公开泄露 Token；
- Token 仅保存在本地浏览器，不上传至仓库。

---

## 🧭 项目目标

该系统旨在实现一键化投资组合分析：
- 自动抓取数据；
- 自动计算指标；
- 自动生成报告；
- 自动可视化；
- 自动上传展示。

---

## 🪄 效果预览

> 部署成功后访问 `https://<your-username>.github.io/<your-repo>/`

你将看到一个带有三个标签页的仪表盘：

- 💰 **资产概览**  
  查看实时更新的总资产曲线和分布饼图。

- 📈 **仓位更新**  
  可视化编辑投资组合并保存。

- ⚙️ **其他设置**  
  管理系统参数或附加配置。

---

## 📄 许可证

MIT License
