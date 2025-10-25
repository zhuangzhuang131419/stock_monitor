// --- 全局常量与变量 ---
const WORKFLOW_FILE_NAME = 'run_script.yml';
const CONFIG_FILE_PATH = 'config.ini';
const TOKEN_STORAGE_KEY = 'github_pat';
let fileSha = null;
let token = '';
let originalIniLines = [];
let pendingTabSwitch = null;
let portfolioPieChart = null; // 饼图实例
let portfolioValueChart = null; // 新增：堆叠图实例

// --- DOM 元素获取 ---
const tabButtons = {
    summary: document.getElementById('tab-summary'),
    positions: document.getElementById('tab-positions'),
    settings: document.getElementById('tab-settings'),
};
const panels = {
    summary: document.getElementById('summary-panel'),
    positions: document.getElementById('positions-panel'),
    settings: document.getElementById('settings-panel'),
};
const editors = {
    positions: document.getElementById('positions-editor'),
    settings: document.getElementById('settings-editor'),
};
const statusMessages = {
    positions: document.getElementById('status-msg-positions'),
    settings: document.getElementById('status-msg-settings'),
    modal: document.getElementById('modal-status-msg'),
};
const modal = {
    backdrop: document.getElementById('modal-backdrop'),
    container: document.getElementById('token-modal'),
    input: document.getElementById('modal-token-input'),
    confirmBtn: document.getElementById('modal-confirm-btn'),
    cancelBtn: document.getElementById('modal-cancel-btn'),
};
const logoutButtons = document.querySelectorAll('.logout-btn');

const historyModal = {
    backdrop: document.getElementById('history-modal-backdrop'),
    container: document.getElementById('history-modal-container'),
    content: document.getElementById('history-table-content')
};
const totalValueDisplay = document.getElementById('total-value-display');
const returnsDisplayContainer = document.getElementById('returns-display');

// --- 初始化与事件监听 ---
document.addEventListener('DOMContentLoaded', () => {
    loadInitialSummary();
    setupEventListeners();
    initializeAuth();
});

function setupEventListeners() {
    // Tab 切换
    tabButtons.summary.addEventListener('click', () => switchTab('summary'));
    tabButtons.positions.addEventListener('click', () => requestTabSwitch('positions'));
    tabButtons.settings.addEventListener('click', () => requestTabSwitch('settings'));

    // 弹窗按钮
    modal.confirmBtn.addEventListener('click', handleTokenConfirm);
    modal.cancelBtn.addEventListener('click', hideTokenModal);

    // 操作按钮
    document.getElementById('run-workflow-btn-summary').addEventListener('click', requestRunWorkflow);
    document.getElementById('save-btn-positions').addEventListener('click', savePortfolio);
    document.getElementById('save-btn-settings').addEventListener('click', savePortfolio);
    document.getElementById('force-refresh-btn').addEventListener('click', forceRefreshPage);
    logoutButtons.forEach(btn => btn.addEventListener('click', handleLogout));

    // 历史表格弹窗的事件监听
    totalValueDisplay.addEventListener('click', showHistoryTable);
    historyModal.backdrop.addEventListener('click', hideHistoryTable);
}

// ========== 饼图相关函数 ==========

/**
 * 创建高级交互式饼图
 * 修复数据处理问题并优化样式，特别处理CASH资产
 */
async function createPortfolioPieChart() {
    const assetsUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_assets_returns.json`;
    const timestamp = new Date().getTime();

    try {
        const response = await fetch(`${assetsUrl}?t=${timestamp}`);
        if (!response.ok) {
            throw new Error(`无法加载资产数据文件 (状态: ${response.status})`);
        }
        const assetsData = await response.json();

        // 处理数据，过滤掉占比小于0.1%的资产
        const portfolioReturns = assetsData.portfolio_returns;
        const totalValue = Object.values(portfolioReturns).reduce((sum, asset) => sum + asset.total_value, 0);

        const filteredAssets = Object.entries(portfolioReturns).filter(([symbol, data]) => {
            const percentage = (data.total_value / totalValue);
            return percentage >= 0.001; // 过滤掉小于0.1%的资产
        });

        // 准备图表数据
        const labels = filteredAssets.map(([symbol]) => symbol);
        const values = filteredAssets.map(([, data]) => data.total_value);
        const assetsInfo = Object.fromEntries(filteredAssets);

        // 生成与主题匹配的色彩
        const colors = generateThemeColors(labels.length);

        const ctx = document.getElementById('portfolio-pie-chart').getContext('2d');

        // 销毁现有图表实例
        if (portfolioPieChart) {
            portfolioPieChart.destroy();
        }

        // 创建新的饼图实例
        portfolioPieChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: 'rgba(224, 229, 243, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 12,
                    hoverBorderWidth: 3,
                    hoverBorderColor: '#00f5d4'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    animateRotate: true,
                    animateScale: true,
                    duration: 1800,
                    easing: 'easeOutQuart'
                },
                interaction: {
                    mode: 'nearest',
                    intersect: true
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            font: {
                                family: 'Poppins',
                                size: 11,
                                weight: '500'
                            },
                            color: '#e0e5f3',
                            boxWidth: 12,
                            boxHeight: 12
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(29, 36, 58, 0.95)',
                        titleColor: '#00f5d4',
                        bodyColor: '#e0e5f3',
                        borderColor: '#00f5d4',
                        borderWidth: 1,
                        cornerRadius: 12,
                        displayColors: true,
                        titleFont: {
                            family: 'Poppins',
                            size: 14,
                            weight: 'bold'
                        },
                        bodyFont: {
                            family: 'Poppins',
                            size: 12
                        },
                        padding: 15,
                        callbacks: {
                            title: function(context) {
                                return context[0].label;
                            },
                            // --- Tooltip 内容生成逻辑更新 ---
                            label: function(context) {
                                const symbol = context.label;
                                const value = context.parsed;
                                const percentage = (value / totalValue) * 100;
                                const assetData = assetsInfo[symbol];

                                // 基础信息：价值和占比
                                const lines = [
                                    `价值: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                    `占比: ${percentage.toFixed(2)}%`
                                ];

                                // 检查是否为非现金资产且有收益率数据
                                if (symbol !== 'CASH' && assetData && assetData.returns) {
                                    lines.push(''); // 添加一个空行作为分隔
                                    lines.push('涨跌幅:');

                                    const returns = assetData.returns;

                                    // 定义JSON key到中文标签的映射
                                    const returnLabels = {
                                        previous_trading_day: '上一个交易日',
                                        week_to_date: '本周至今',
                                        month_to_date: '本月至今',
                                        year_to_date: '本年至今',
                                        past_30_trading_days: '过去30个交易日',
                                        past_250_trading_days: '过去250个交易日'
                                    };

                                    // 动态遍历并添加所有涨跌幅数据
                                    for (const key in returnLabels) {
                                        if (returns.hasOwnProperty(key)) {
                                            const labelText = returnLabels[key];
                                            const returnValue = returns[key];
                                            lines.push(`  ${labelText}: ${returnValue.toFixed(2)}%`);
                                        }
                                    }
                                }
                                // 专门处理现金资产
                                else if (symbol === 'CASH') {
                                    lines.push('');
                                    lines.push('💰 现金资产 (无涨跌幅)');
                                }

                                return lines;
                            }
                            // --- Tooltip 逻辑更新结束 ---
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('创建饼图失败:', error);
        const canvas = document.getElementById('portfolio-pie-chart');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff4757';
        ctx.font = '16px Poppins';
        ctx.textAlign = 'center';
        ctx.fillText('饼图加载失败', canvas.width / 2, canvas.height / 2);
    }
}

/**
 * 生成与主题匹配的色彩数组
 */
function generateThemeColors(count) {
    const baseColors = [
        '#00f5d4', '#6a82fb', '#4ecdc4', '#45b7d1', '#96ceb4',
        '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f', '#bb8fce',
        '#85c1e9', '#f8c471', '#82e0aa', '#f1948a', '#d7bde2'
    ];
    const colors = [...baseColors];
    while (colors.length < count) {
        const hue = (colors.length * 137.508) % 360;
        const saturation = 65 + (colors.length % 3) * 10;
        const lightness = 60 + (colors.length % 4) * 5;
        colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }
    return colors.slice(0, count);
}


// ========== 新增：历史价值堆叠图 ==========
/**
 * 将十六进制颜色转换为带有alpha通道的RGBA格式
 * @param {string} hex - 例如 "#3498db"
 * @param {number} alpha - 透明度，从 0 到 1
 * @returns {string} - 例如 "rgba(52, 152, 219, 1)"
 */
function toRgba(hex, alpha = 1) {
    const hexValue = hex.replace('#', '');
    const isShort = hexValue.length === 3;
    const r = parseInt(isShort ? hexValue[0] + hexValue[0] : hexValue.substring(0, 2), 16);
    const g = parseInt(isShort ? hexValue[1] + hexValue[1] : hexValue.substring(2, 4), 16);
    const b = parseInt(isShort ? hexValue[2] + hexValue[2] : hexValue.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 创建交互式历史价值堆叠图 (V20 修正版 - 移除区域高亮 & 修复X轴)
 */
async function createPortfolioValueChart() {
    const historyUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_details_history.csv`;
    const timestamp = new Date().getTime();

    try {
        const response = await fetch(`${historyUrl}?t=${timestamp}`);
        if (!response.ok) throw new Error(`无法加载历史数据文件 (状态: ${response.status})`);

        const csvText = await response.text();
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) throw new Error('历史数据不足');

        const headers = lines.shift().split(',');
        const dataRows = lines.reverse();

        const assetColumns = headers.filter(h => h !== 'date' && h !== 'total_value');

        const themeColorsHex = generateThemeColors(assetColumns.length);
        const originalColorsRgba = themeColorsHex.map(color => toRgba(color, 1));

        const highlightedColorsRgba = originalColorsRgba.map(rgbaColor => {
            const parts = rgbaColor.match(/[\d.]+/g);
            if (!parts) return 'rgba(255,255,255,0.8)';
            let [r, g, b] = parts.map(Number);
            const factor = 1.25;
            r = Math.min(255, Math.floor(r * factor));
            g = Math.min(255, Math.floor(g * factor));
            b = Math.min(255, Math.floor(b * factor));
            return `rgba(${r}, ${g}, ${b}, 1)`;
        });

        const datasets = assetColumns.map((asset, index) => ({
            label: asset,
            data: [],
            backgroundColor: originalColorsRgba[index],
            borderColor: originalColorsRgba[index],
            borderWidth: 0,
            fill: 'origin',
            stack: 'combined',
            pointRadius: 0,
            pointHoverRadius: 6,
            tension: 0.4,
        }));

        datasets.push({
            label: 'Total Value', data: [], type: 'line', fill: false, order: -1,
            borderColor: 'rgba(255, 255, 255, 0.9)', backgroundColor: 'transparent',
            borderWidth: 2.5, borderDash: [5, 5], pointRadius: 0, pointHoverRadius: 6, tension: 0.4,
        });

        const labels = [];
        const assetData = Object.fromEntries(assetColumns.map(asset => [asset, []]));
        const totalValueData = [];

        const parseValue = (cell) => {
            if (typeof cell !== 'string') return 0;
            const match = cell.match(/\(([^|]+)/);
            return match ? parseFloat(match[1]) : parseFloat(cell) || 0;
        };

        dataRows.forEach(row => {
            const values = row.split(',');
            if (values.length !== headers.length) return;
            const dateStr = values[headers.indexOf('date')];
            if (!dateStr) return; // 跳过没有日期的行

            labels.push(dateStr);
            totalValueData.push(parseFloat(values[headers.indexOf('total_value')]) || 0);
            assetColumns.forEach(asset => {
                assetData[asset].push(parseValue(values[headers.indexOf(asset)]));
            });
        });

        datasets.forEach(ds => {
            if (ds.label === 'Total Value') ds.data = totalValueData;
            else if (assetData[ds.label]) ds.data = assetData[ds.label];
        });

        const ctx = document.getElementById('portfolio-value-chart').getContext('2d');
        if (portfolioValueChart) portfolioValueChart.destroy();

        let lastHoveredIndex = null;

        const highlightDataset = (targetIndex) => {
            if (targetIndex === lastHoveredIndex) return;
            const chartDatasets = portfolioValueChart.data.datasets;
            if (lastHoveredIndex !== null && lastHoveredIndex > -1) {
                const prevDataset = chartDatasets[lastHoveredIndex];
                if (prevDataset && prevDataset.stack === 'combined') {
                    prevDataset.backgroundColor = originalColorsRgba[lastHoveredIndex];
                }
            }
            if (targetIndex !== null && targetIndex > -1) {
                const targetDataset = chartDatasets[targetIndex];
                if (targetDataset && targetDataset.stack === 'combined') {
                    targetDataset.backgroundColor = highlightedColorsRgba[targetIndex];
                }
            }
            lastHoveredIndex = targetIndex;
            portfolioValueChart.update('none');
        };

        const resetHighlight = () => highlightDataset(-1);

        // --- 关键改动 2：动态计算X轴的时间单位 ---
        let timeUnit = 'day';
        if (labels.length > 1) {
            const firstDate = new Date(labels[0]);
            const lastDate = new Date(labels[labels.length - 1]);
            const timeSpanDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);

            if (timeSpanDays > 365 * 2) timeUnit = 'year';
            else if (timeSpanDays > 60) timeUnit = 'month';
        }

        portfolioValueChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    title: { display: true, text: '资产价值历史趋势', color: '#e0e5f3', font: { size: 16, family: 'Poppins' }, padding: { bottom: 20 } },
                    legend: {
                        display: true, position: 'bottom',
                        labels: { padding: 15, usePointStyle: true, pointStyle: 'circle', font: { family: 'Poppins', size: 11 }, color: '#e0e5f3', boxWidth: 10, boxHeight: 10, filter: (item) => item.text !== 'Total Value' },
                        onHover: (event, legendItem) => highlightDataset(legendItem.datasetIndex),
                        onLeave: resetHighlight,
                    },
                    tooltip: {
                        backgroundColor: 'rgba(29, 36, 58, 0.95)', titleColor: '#00f5d4', bodyColor: '#e0e5f3',
                        borderColor: '#00f5d4', borderWidth: 1, cornerRadius: 8, padding: 12,
                        titleFont: { family: 'Poppins', weight: 'bold' }, bodyFont: { family: 'Poppins' },
                        filter: (item) => (item.raw > 0 && item.dataset.stack === 'combined') || item.dataset.label === 'Total Value',
                        callbacks: {
                             title: (context) => context[0].label,
                             label: (context) => {
                                 let label = context.dataset.label || '';
                                 if (label) label += ': ';
                                 label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.raw);
                                 return label;
                             }
                        }
                    },
                },
                scales: {
                     // --- 关键改动 2：应用动态时间单位和更合理的格式 ---
                     x: {
                         type: 'time',
                         time: {
                             unit: timeUnit, // 应用动态计算出的时间单位
                             tooltipFormat: 'yyyy-MM-dd',
                             displayFormats: {
                                 day: 'MMM d',
                                 month: 'yyyy MMM',
                                 year: 'yyyy'
                             }
                         },
                         grid: { color: 'rgba(138, 153, 192, 0.15)' },
                         ticks: { color: '#8a99c0', font: { family: 'Poppins' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }
                     },
                     y: {
                         stacked: true,
                         grid: { color: 'rgba(138, 153, 192, 0.15)' },
                         ticks: { color: '#8a99c0', font: { family: 'Poppins' }, callback: value => (value / 1000).toFixed(0) + 'k' }
                     }
                }
            }
        });

        // --- 关键改动 1：已删除所有 canvas.addEventListener 代码 ---

    } catch (error) {
        console.error('创建历史价值图表失败:', error);
        const canvas = document.getElementById('portfolio-value-chart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ff4757'; ctx.font = '16px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText('价值图加载失败，请检查数据文件或刷新页面。', canvas.width / 2, canvas.height / 2);
        }
    }
}

// ========== 页面加载与数据处理 ==========

async function showHistoryTable() {
    document.body.classList.add('modal-open');
    historyModal.backdrop.classList.remove('hidden');
    historyModal.container.classList.remove('hidden');

    requestAnimationFrame(() => {
        historyModal.backdrop.classList.add('is-active');
        historyModal.container.classList.add('is-active');
    });

    historyModal.content.innerHTML = '<p style="text-align:center; padding: 20px;">正在加载历史数据...</p>';
    try {
        const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_details_history.csv`;
        const timestamp = new Date().getTime();
        const response = await fetch(`${csvUrl}?t=${timestamp}`);

        if (!response.ok) {
            throw new Error(`无法加载 CSV 文件 (状态: ${response.status})`);
        }

        const csvText = await response.text();
        const tableHtml = parseCsvToHtmlTable(csvText);
        historyModal.content.innerHTML = tableHtml;

    } catch (error) {
        console.error('加载历史数据失败:', error);
        historyModal.content.innerHTML = `<div class="status-error" style="display:block; margin: 20px;">加载失败: ${error.message}</div>`;
    }
}

function hideHistoryTable() {
    document.body.classList.remove('modal-open');
    historyModal.container.addEventListener('transitionend', () => {
        historyModal.backdrop.classList.add('hidden');
        historyModal.container.classList.add('hidden');
    }, { once: true });
    historyModal.backdrop.classList.remove('is-active');
    historyModal.container.classList.remove('is-active');
}

function parseCsvToHtmlTable(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return '<p>没有历史数据。</p>';

    let html = '<table class="history-table">';
    const headers = lines[0].split(',');
    html += '<thead><tr>';
    headers.forEach(header => {
        html += `<th>${header.trim().replace(/_/g, ' ')}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cells = lines[i].split(',');
        html += '<tr>';
        cells.forEach(cell => {
            const trimmedCell = cell.trim();
            const num = Number(trimmedCell);
            if (!isNaN(num) && trimmedCell.includes('.')) {
                html += `<td>${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`;
            } else {
                html += `<td>${trimmedCell}</td>`;
            }
        });
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function initializeAuth() {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) {
        console.log("检测到已保存的 Token，正在尝试自动登录...");
        loadDataWithToken(storedToken, true);
    } else {
        console.log("未找到已保存的 Token。");
    }
}

function handleLogout() {
    if (confirm('您确定要清除授权并退出登录吗？这会移除保存在本浏览器的 Token。')) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        token = '';
        fileSha = null;
        window.location.reload();
    }
}

function setLoggedInUI(isLoggedIn) {
    if (isLoggedIn) {
        logoutButtons.forEach(btn => btn.classList.remove('hidden'));
    } else {
        logoutButtons.forEach(btn => btn.classList.add('hidden'));
    }
}

function switchTab(tabKey) {
    Object.values(tabButtons).forEach(btn => btn.classList.remove('active'));
    Object.values(panels).forEach(panel => panel.classList.remove('active'));
    tabButtons[tabKey].classList.add('active');
    panels[tabKey].classList.add('active');
}

function requestTabSwitch(tabKey) {
    if (token) {
        switchTab(tabKey);
    } else {
        pendingTabSwitch = tabKey;
        showTokenModal();
    }
}

function showTokenModal(message = '', isError = false) {
    updateStatus(message, isError, 'modal');
    modal.backdrop.classList.remove('hidden');
    modal.container.classList.remove('hidden');
    modal.input.focus();
}

function hideTokenModal() {
    modal.backdrop.classList.add('hidden');
    modal.container.classList.add('hidden');
    modal.input.value = '';
    pendingTabSwitch = null;
}

const { owner, repo } = getRepoInfoFromURL();

async function handleTokenConfirm() {
    const inputToken = modal.input.value.trim();
    if (!inputToken) {
        showTokenModal('Token 不能为空。', true);
        return;
    }
    updateStatus('正在验证 Token 并加载数据...', false, 'modal');
    loadDataWithToken(inputToken);
}

async function loadDataWithToken(tokenToValidate, isAutoAuth = false) {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            headers: { 'Authorization': `token ${tokenToValidate}` }
        });

        if (!response.ok) {
            if (isAutoAuth) {
                localStorage.removeItem(TOKEN_STORAGE_KEY);
                console.error('自动登录失败: 已保存的 Token 无效或已过期，已自动清除。');
                setLoggedInUI(false);
                return;
            }
            if (response.status === 401) throw new Error('Token 无效或权限不足。');
            if (response.status === 404) throw new Error('在仓库中未找到 config.ini 文件。');
            throw new Error(`GitHub API 错误: ${response.statusText}`);
        }

        token = tokenToValidate;
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        setLoggedInUI(true);

        const data = await response.json();
        fileSha = data.sha;
        const content = decodeURIComponent(escape(atob(data.content)));
        originalIniLines = content.split('\n');

        displayPortfolio(originalIniLines);

        if (!isAutoAuth) {
            const tabToSwitch = pendingTabSwitch;
            hideTokenModal();
            if (tabToSwitch) {
                switchTab(tabToSwitch);
            }
        }
        console.log("授权成功，数据已加载。");

    } catch (error) {
        console.error(error);
        if (!isAutoAuth) {
            showTokenModal(`验证失败: ${error.message}`, true);
        }
        setLoggedInUI(false);
    }
}

async function savePortfolio() {
    if (!token || !fileSha) {
        alert('错误: 授权信息丢失，请刷新页面重试。');
        return;
    }

    const activePanelKey = panels.positions.classList.contains('active') ? 'positions' : 'settings';
    updateStatus('正在验证并保存...', false, activePanelKey);

    const newContent = buildIniStringFromUI();
    const newContentBase64 = btoa(unescape(encodeURIComponent(newContent)));

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_FILE_PATH}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ message: `Update ${CONFIG_FILE_PATH} via web editor`, content: newContentBase64, sha: fileSha })
        });
        if (!response.ok) throw new Error(`GitHub API 错误: ${response.statusText}`);
        const data = await response.json();
        fileSha = data.content.sha;
        originalIniLines = newContent.split('\n');
        updateStatus('保存成功！', false, activePanelKey);
    } catch (error) {
        console.error(error);
        updateStatus(`保存失败: ${error.message}`, true, activePanelKey);
    }
}

async function requestRunWorkflow() {
    if (!token) {
        showTokenModal('需要授权才能启动云端分析。');
        pendingTabSwitch = 'summary';
        return;
    }
    runWorkflow();
}

async function runWorkflow() {
    alert('即将触发云端分析，请在 GitHub Actions 页面查看进度。');
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ ref: 'main' })
        });
        if (response.status !== 204) throw new Error(`GitHub API 错误: ${response.statusText}`);
    } catch (error) {
        console.error(error);
        alert(`触发失败: ${error.message}`);
    }
}

function displayPortfolio(lines) {
    editors.positions.innerHTML = '';
    editors.settings.innerHTML = '';
    let currentSection = null;

    lines.forEach((line, index) => {
        const processedLine = line.split('#')[0].trim();
        if (processedLine.startsWith('[') && processedLine.endsWith(']')) {
            currentSection = processedLine.substring(1, processedLine.length - 1);
            if (currentSection === 'Proxy') return;

            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'portfolio-section';
            sectionDiv.innerHTML = `<h3>${currentSection}</h3>`;

            const positionSections = ['Portfolio', 'OptionsPortfolio', 'Cash'];
            const targetEditor = positionSections.includes(currentSection) ? editors.positions : editors.settings;

            if (['Portfolio', 'OptionsPortfolio'].includes(currentSection)) {
                const addBtn = document.createElement('button');
                addBtn.textContent = '＋ 新增一行';
                addBtn.className = 'add-btn';
                addBtn.onclick = function() { addNewRow(this.parentElement); };
                sectionDiv.appendChild(addBtn);
            }
            targetEditor.appendChild(sectionDiv);

        } else if (currentSection && processedLine.includes('=')) {
            const positionSections = ['Portfolio', 'OptionsPortfolio', 'Cash'];
            const parentEditor = positionSections.includes(currentSection) ? editors.positions : editors.settings;
            const sectionDiv = Array.from(parentEditor.querySelectorAll('.portfolio-section h3')).find(h3 => h3.textContent === currentSection)?.parentElement;
            if (!sectionDiv) return;

            const [key, value] = processedLine.split('=').map(s => s.trim());
            if (!key || typeof value === 'undefined') return;
            let itemDiv;
            if (key === 'data_source') {
                const commentLine = (index > 0) ? lines[index - 1].trim() : '';
                const options = commentLine.match(/\d+\s*:\s*.*?(?=\s+\d+:|$)/g);
                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item-static';
                const label = document.createElement('label');
                label.textContent = key;
                if (options) {
                    const select = document.createElement('select');
                    select.className = 'data-source-select';
                    options.forEach(opt => {
                        const firstColonIndex = opt.indexOf(':');
                        const num = opt.substring(0, firstColonIndex).trim();
                        const desc = opt.substring(firstColonIndex + 1).trim();
                        const optionEl = document.createElement('option');
                        optionEl.value = num;
                        optionEl.textContent = desc;
                        if (num === value) optionEl.selected = true;
                        select.appendChild(optionEl);
                    });
                    itemDiv.append(label, select);
                } else {
                    const input = document.createElement('input');
                    input.type = 'text'; input.value = value;
                    itemDiv.append(label, input);
                }
            } else if (currentSection === 'OptionsPortfolio') {
                const parts = key.split('_');
                if (parts.length === 4) itemDiv = createOptionRowUI(parts[0], parts[1], parts[2], parts[3], value);
            } else if (currentSection === 'Portfolio') {
                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item';
                const keyInput = document.createElement('input');
                keyInput.type = 'text'; keyInput.value = key; keyInput.className = 'key-input'; keyInput.placeholder = '代码/名称';
                const valueInput = document.createElement('input');
                valueInput.type = 'text'; valueInput.value = value; valueInput.className = 'value-input'; valueInput.placeholder = '数量/值';
                const removeBtn = document.createElement('button');
                removeBtn.textContent = '删除'; removeBtn.className = 'remove-btn'; removeBtn.onclick = () => itemDiv.remove();
                itemDiv.append(keyInput, valueInput, removeBtn);
            } else {
                itemDiv = document.createElement('div');
                itemDiv.className = 'portfolio-item-static';
                const label = document.createElement('label');
                label.textContent = key;
                const input = document.createElement('input');
                input.type = 'text'; input.value = value;
                itemDiv.append(label, input);
            }
            if (itemDiv) sectionDiv.insertBefore(itemDiv, sectionDiv.querySelector('.add-btn') || null);
        }
    });
}

function updateStatus(message, isError = false, panelKey) {
    const target = statusMessages[panelKey];
    if (!target) return;
    target.innerHTML = message;
    target.className = `status-msg ${isError ? 'status-error' : 'status-success'}`;
    target.style.display = message ? 'block' : 'none';
}

function getRepoInfoFromURL() {
    const hostname = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (hostname.includes('github.io') && pathParts.length > 0) {
        return { owner: hostname.split('.')[0], repo: pathParts[0] };
    }
    return { owner: 'YOUR_USERNAME', repo: 'YOUR_REPONAME' };
}

async function loadReturnsData() {
    const returnsUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_return.json`;
    const timestamp = new Date().getTime();

    returnsDisplayContainer.innerHTML = '<p style="font-size: 14px; color: #6a737d;">正在加载收益率...</p>';

    try {
        const response = await fetch(`${returnsUrl}?t=${timestamp}`);
        if (!response.ok) {
            throw new Error(`无法加载收益率文件 (状态: ${response.status})`);
        }
        const returnsData = await response.json();

        if (!Array.isArray(returnsData) || returnsData.length === 0) {
            returnsDisplayContainer.innerHTML = '<p style="font-size: 14px; color: #6a737d;">暂无收益率数据。</p>';
            return;
        }

        returnsDisplayContainer.innerHTML = ''; // 清空加载提示

        returnsData.forEach(item => {
            const { period, return: returnValue, profit, growth } = item;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'return-item';

            const periodLabel = document.createElement('span');
            periodLabel.className = 'return-label';
            periodLabel.textContent = period;
            itemDiv.appendChild(periodLabel);

            const createValueSpan = (value, isPercent) => {
                const span = document.createElement('span');
                const sign = value > 0 ? '+' : '';
                let text;
                if (isPercent) {
                    text = `${sign}${(value * 100).toFixed(2)}%`;
                } else {
                    text = `${sign}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                }
                span.textContent = text;

                if (value > 0) span.classList.add('positive');
                else if (value < 0) span.classList.add('negative');
                return span;
            };

            const returnValueSpan = createValueSpan(returnValue, true);
            returnValueSpan.classList.add('return-value');
            itemDiv.appendChild(returnValueSpan);

            const profitDiv = document.createElement('div');
            profitDiv.className = 'detail-line';
            const profitLabel = document.createElement('span');
            profitLabel.className = 'detail-label';
            profitLabel.textContent = '盈利';
            const profitValueSpan = createValueSpan(profit, false);
            profitValueSpan.classList.add('detail-value');
            profitDiv.append(profitLabel, profitValueSpan);
            itemDiv.appendChild(profitDiv);

            const growthDiv = document.createElement('div');
            growthDiv.className = 'detail-line';
            const growthLabel = document.createElement('span');
            growthLabel.className = 'detail-label';
            growthLabel.textContent = '增值';
            const growthValueSpan = createValueSpan(growth, false);
            growthValueSpan.classList.add('detail-value');
            growthDiv.append(growthLabel, growthValueSpan);
            itemDiv.appendChild(growthDiv);

            returnsDisplayContainer.appendChild(itemDiv);
        });

    } catch (error) {
        console.error('加载收益率数据失败:', error);
        returnsDisplayContainer.innerHTML = `<p style="font-size: 14px; color: #d73a49;">收益率加载失败</p>`;
    }
}

// ========== 修改：更新页面加载逻辑 ==========
async function loadInitialSummary() {
    const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/portfolio_details_history.csv`;
    const lastUpdatedTime = document.getElementById('last-updated-time');
    const timestamp = new Date().getTime();

    // 加载所有图表和数据
    loadReturnsData();
    createPortfolioPieChart();
    createPortfolioValueChart(); // 新增调用

    try {
        const response = await fetch(`${csvUrl}?t=${timestamp}`);
        if (!response.ok) throw new Error(`无法加载 CSV: ${response.statusText}`);

        const csvText = await response.text();
        const lines = csvText.trim().split('\n');

        if (lines.length < 2) throw new Error('CSV 文件内容不正确。');

        const headers = lines[0].split(',');
        const latestDataLine = lines[1].split(',');
        const totalValueIndex = headers.indexOf('total_value');
        const dateIndex = headers.indexOf('date');

        if (totalValueIndex === -1) throw new Error('CSV 中未找到 "total_value" 列。');
        if (dateIndex === -1) throw new Error('CSV 中未找到 "date" 列。');

        const latestTotalValue = parseFloat(latestDataLine[totalValueIndex]);
        if (isNaN(latestTotalValue)) throw new Error('最新的 "total_value" 无效。');

        totalValueDisplay.textContent = `总资产：$${latestTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        lastUpdatedTime.textContent = latestDataLine[dateIndex];

    } catch (error) {
        console.error('加载资产概览失败:', error);
        totalValueDisplay.textContent = '总资产：加载失败';
        totalValueDisplay.style.color = 'red';
    }
}

function createOptionRowUI(ticker = '', date = '', strike = '', type = 'CALL', quantity = '') {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'option-item-row';
    const tickerInput = document.createElement('input');
    tickerInput.type = 'text'; tickerInput.placeholder = 'Ticker'; tickerInput.className = 'option-ticker-input'; tickerInput.value = ticker;
    const dateInput = document.createElement('input');
    dateInput.type = 'date'; dateInput.className = 'option-date-select'; dateInput.value = date;
    const strikeInput = document.createElement('input');
    strikeInput.type = 'number'; strikeInput.placeholder = 'Strike'; strikeInput.className = 'option-strike-input'; strikeInput.value = strike;
    const typeSelect = document.createElement('select');
    typeSelect.className = 'option-type-select';
    ['CALL', 'PUT'].forEach(t => {
        const option = document.createElement('option');
        option.value = t; option.textContent = t;
        if (t.toUpperCase() === type.toUpperCase()) option.selected = true;
        typeSelect.appendChild(option);
    });
    const valueInput = document.createElement('input');
    valueInput.type = 'text'; valueInput.placeholder = '数量'; valueInput.className = 'value-input'; valueInput.value = quantity;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '删除'; removeBtn.className = 'remove-btn'; removeBtn.onclick = () => itemDiv.remove();
    itemDiv.append(tickerInput, dateInput, strikeInput, typeSelect, valueInput, removeBtn);
    return itemDiv;
}

function addNewRow(sectionDiv) {
    const sectionTitle = sectionDiv.querySelector('h3').textContent;
    const addBtn = sectionDiv.querySelector('.add-btn');
    let itemDiv;
    if (sectionTitle === 'OptionsPortfolio') {
        itemDiv = createOptionRowUI();
    } else if (sectionTitle === 'Portfolio') {
        itemDiv = document.createElement('div');
        itemDiv.className = 'portfolio-item';
        const keyInput = document.createElement('input');
        keyInput.type = 'text'; keyInput.placeholder = '股票代码 (例如: AAPL)'; keyInput.className = 'key-input';
        const valueInput = document.createElement('input');
        valueInput.type = 'text'; valueInput.placeholder = '数量/值'; valueInput.className = 'value-input';
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '删除'; removeBtn.className = 'remove-btn'; removeBtn.onclick = () => itemDiv.remove();
        itemDiv.append(keyInput, valueInput, removeBtn);
    }
    if (itemDiv) {
        sectionDiv.insertBefore(itemDiv, addBtn);
    }
}

function buildIniStringFromUI() {
    const uiState = {};
    document.querySelectorAll('.portfolio-section').forEach(section => {
        const title = section.querySelector('h3').textContent;
        uiState[title] = {};
        section.querySelectorAll('.portfolio-item-static').forEach(item => {
            const key = item.querySelector('label').textContent;
            const input = item.querySelector('input, select');
            if (key && input) uiState[title][key] = input.value;
        });
        section.querySelectorAll('.portfolio-item').forEach(item => {
            const key = item.querySelector('.key-input')?.value.trim();
            const value = item.querySelector('.value-input')?.value.trim();
            if (key && value) uiState[title][key] = value;
        });
        section.querySelectorAll('.option-item-row').forEach(item => {
            const ticker = item.querySelector('.option-ticker-input').value.trim().toUpperCase();
            const date = item.querySelector('.option-date-select').value;
            const strike = item.querySelector('.option-strike-input').value.trim();
            const type = item.querySelector('.option-type-select').value;
            const value = item.querySelector('.value-input').value.trim();
            if (ticker && date && strike && value) {
                const key = `${ticker}_${date}_${strike}_${type}`;
                uiState[title][key] = value;
            }
        });
    });

    const tempLines = [];
    const processedKeys = new Set();
    let currentSection = '';
    originalIniLines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
            currentSection = trimmedLine.substring(1, trimmedLine.length - 1);
            tempLines.push(line);
            return;
        }
        if (!currentSection || !trimmedLine.includes('=') || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
            tempLines.push(line);
            return;
        }
        const key = trimmedLine.split('=')[0].trim();
        const sectionState = uiState[currentSection];
        if (sectionState && sectionState.hasOwnProperty(key)) {
            const newValue = sectionState[key];
            const commentPart = line.includes('#') ? ' #' + line.split('#').slice(1).join('#') : '';
            tempLines.push(`${key} = ${newValue}${commentPart}`);
            processedKeys.add(`${currentSection}.${key}`);
        }
    });

    for (const sectionName in uiState) {
        if (!uiState.hasOwnProperty(sectionName)) continue;
        const newItemsForSection = [];
        for (const key in uiState[sectionName]) {
            if (!processedKeys.has(`${sectionName}.${key}`)) {
                const value = uiState[sectionName][key];
                newItemsForSection.push(`${key} = ${value}`);
            }
        }
        if (newItemsForSection.length > 0) {
            let sectionHeaderIndex = -1, nextSectionHeaderIndex = -1;
            for (let i = 0; i < tempLines.length; i++) {
                if (tempLines[i].trim() === `[${sectionName}]`) sectionHeaderIndex = i;
                else if (sectionHeaderIndex !== -1 && tempLines[i].trim().startsWith('[')) {
                    nextSectionHeaderIndex = i;
                    break;
                }
            }
            if (sectionHeaderIndex !== -1) {
                const insertChunkEnd = (nextSectionHeaderIndex === -1) ? tempLines.length : nextSectionHeaderIndex;
                let insertionIndex = insertChunkEnd;
                while (insertionIndex > sectionHeaderIndex + 1 && tempLines[insertionIndex - 1].trim() === '') {
                    insertionIndex--;
                }
                tempLines.splice(insertionIndex, 0, ...newItemsForSection);
            }
        }
    }
    return tempLines.join('\n');
}

function forceRefreshPage() {
    const baseUrl = window.location.origin + window.location.pathname;
    const newUrl = `${baseUrl}?t=${new Date().getTime()}`;
    window.location.href = newUrl;
}
