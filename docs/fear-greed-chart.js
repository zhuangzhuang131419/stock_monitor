document.addEventListener('DOMContentLoaded', () => {
    // 确保 getRepoInfoFromURL 函数已经从 script.js 加载并可用
    if (typeof getRepoInfoFromURL !== 'function') {
        console.error("`getRepoInfoFromURL` function not found. Make sure script.js is loaded first.");
        return;
    }

    const { owner, repo } = getRepoInfoFromURL();
    const FEAR_GREED_DATA_URL = `https://raw.githubusercontent.com/${owner}/${repo}/main/data/fear_greed_index.json`;

    // 为情绪评级定义颜色
    const RATING_COLORS = {
        'extreme fear': '#e74c3c',
        'fear': '#f39c12',
        'neutral': '#7f8c8d',
        'greed': '#27ae60',
        'extreme greed': '#2ecc71'
    };

    const CHART_GRID_COLOR = 'rgba(138, 153, 192, 0.15)';
    const CHART_TICK_COLOR = '#8a99c0';
    const CHART_FONT = { family: 'Poppins', size: 12 };

    let fearGreedHistoryChart = null;
    let fearGreedGauge = null;
    let stockStrengthChart = null;
    let stockBreadthChart = null;
    let vixChart = null;

    /**
     * 获取并处理恐慌贪婪指数数据
     */
    async function loadFearGreedData() {
        try {
            const response = await fetch(`${FEAR_GREED_DATA_URL}?t=${new Date().getTime()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            updateSummary(data.fear_and_greed);
            updateComparisonValues(data.fear_and_greed);
            createGaugeChart(data.fear_and_greed);
            createHistoryChart(data.fear_and_greed_historical.data);

            createStrengthChart(data.stock_price_strength);
            createBreadthChart(data.stock_price_breadth);
            createVixChart(data.market_volatility_vix, data.market_volatility_vix_50);

        } catch (error) {
            console.error("Could not load Fear & Greed data:", error);
            const container = document.querySelector('.fear-greed-wrapper-container');
            if (container) {
                container.innerHTML = '<p style="color: var(--negative-color); text-align: center; padding: 20px;">恐慌贪婪指数加载失败。</p>';
            }
        }
    }

    /**
     * 更新概览文本字段
     */
    function updateSummary(summaryData) {
        document.getElementById('fg-last-updated').textContent = `数据最后更新于: ${new Date(summaryData.timestamp).toLocaleString()}`;
        document.getElementById('fg-score-value').textContent = summaryData.score.toFixed(1);
        const ratingSpan = document.getElementById('fg-score-rating');
        const ratingText = summaryData.rating;
        ratingSpan.textContent = ratingText.charAt(0).toUpperCase() + ratingText.slice(1);
        const ratingColor = RATING_COLORS[ratingText.toLowerCase()] || '#fff';
        ratingSpan.style.color = ratingColor;
        document.getElementById('fg-score-value').style.textShadow = `0 0 15px ${ratingColor}60`;
    }

    /**
     * 更新历史对比值卡片
     */
    function updateComparisonValues(summaryData) {
        const updateText = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = (typeof value === 'number') ? value.toFixed(1) : 'N/A';
            }
        };

        updateText('fg-prev-close', summaryData.previous_close);
        updateText('fg-prev-week', summaryData.previous_1_week);
        updateText('fg-prev-month', summaryData.previous_1_month);
        updateText('fg-prev-year', summaryData.previous_1_year);
    }

    /**
     * 创建当前分数的仪表盘图
     */
    function createGaugeChart(summaryData) {
        const ctx = document.getElementById('fear-greed-gauge').getContext('2d');
        const score = summaryData.score;

        if (fearGreedGauge) {
            fearGreedGauge.destroy();
        }

        const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
        gradient.addColorStop(0, RATING_COLORS['extreme fear']);
        gradient.addColorStop(0.25, RATING_COLORS['fear']);
        gradient.addColorStop(0.5, RATING_COLORS['neutral']);
        gradient.addColorStop(0.75, RATING_COLORS['greed']);
        gradient.addColorStop(1, RATING_COLORS['extreme greed']);

        fearGreedGauge = new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [score, 100 - score],
                    backgroundColor: [gradient, 'rgba(38, 48, 77, 0.8)'],
                    borderColor: 'transparent',
                    borderWidth: 0,
                    borderRadius: { outerStart: 8, outerEnd: 8, innerStart: 8, innerEnd: 8 },
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                circumference: 180,
                rotation: 270,
                cutout: '75%',
                plugins: { tooltip: { enabled: false }, legend: { display: false } },
                animation: { animateRotate: true, animateScale: false, duration: 1200 }
            }
        });
    }

    /**
     * 创建历史数据折线图
     */
    function createHistoryChart(historyData) {
        const ctx = document.getElementById('fear-greed-history-chart').getContext('2d');

        if (fearGreedHistoryChart) {
            fearGreedHistoryChart.destroy();
        }

        const dataPoints = historyData.map(d => ({ x: d.x, y: d.y, rating: d.rating.toLowerCase() }));

        fearGreedHistoryChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: '指数历史',
                    data: dataPoints,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#fff',
                    fill: true,
                    segment: {
                        borderColor: ctx => RATING_COLORS[ctx.p1.raw.rating] || '#fff',
                        backgroundColor: ctx => {
                            const chartArea = ctx.chart.chartArea;
                            if (!chartArea) return null;
                            const gradient = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            const color = RATING_COLORS[ctx.p1.raw.rating] || '#ffffff';
                            gradient.addColorStop(0, `${color}80`);
                            gradient.addColorStop(1, `${color}05`);
                            return gradient;
                        }
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yyyy-MM' } },
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT, maxRotation: 0, autoSkip: true, autoSkipPadding: 20 }
                    },
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(29, 36, 58, 0.95)',
                        titleColor: '#00f5d4',
                        bodyColor: '#e0e5f3',
                        borderColor: '#00f5d4',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                const rating = context.raw.rating;
                                const value = context.parsed.y;
                                const capitalizedRating = rating.charAt(0).toUpperCase() + rating.slice(1);
                                return `分数: ${value.toFixed(1)} (${capitalizedRating})`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * 创建股价强度历史图表
     */
    function createStrengthChart(strengthData) {
        const ctx = document.getElementById('stock-strength-chart').getContext('2d');
        if (stockStrengthChart) {
            stockStrengthChart.destroy();
        }
        const dataPoints = strengthData.data.map(d => ({ x: d.x, y: d.y, rating: d.rating.toLowerCase() }));

        // 更新评级标签
        const currentRating = strengthData.rating.toLowerCase();
        const badge = document.getElementById('strength-rating-badge');
        if (badge) {
            const color = RATING_COLORS[currentRating] || '#fff';
            badge.textContent = strengthData.rating;
            badge.style.borderColor = color;
            badge.style.color = color;
        }

        stockStrengthChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: '股价强度',
                    data: dataPoints,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#fff',
                    fill: true,
                    segment: {
                        borderColor: ctx => RATING_COLORS[ctx.p1.raw.rating] || '#fff',
                        backgroundColor: ctx => {
                            const chartArea = ctx.chart.chartArea;
                            if (!chartArea) return null;
                            const gradient = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            const color = RATING_COLORS[ctx.p1.raw.rating] || '#ffffff';
                            gradient.addColorStop(0, `${color}80`);
                            gradient.addColorStop(1, `${color}05`);
                            return gradient;
                        }
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yyyy-MM' } },
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT, maxRotation: 0, autoSkip: true, autoSkipPadding: 20 }
                    },
                    y: {
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(29, 36, 58, 0.95)',
                        titleColor: '#00f5d4',
                        bodyColor: '#e0e5f3',
                        borderColor: '#00f5d4',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return `强度: ${context.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * 创建股价宽度历史图表
     */
    function createBreadthChart(breadthData) {
        const ctx = document.getElementById('stock-breadth-chart').getContext('2d');
        if (stockBreadthChart) {
            stockBreadthChart.destroy();
        }
        const dataPoints = breadthData.data.map(d => ({ x: d.x, y: d.y, rating: d.rating.toLowerCase() }));

        // 更新评级标签
        const currentRating = breadthData.rating.toLowerCase();
        const badge = document.getElementById('breadth-rating-badge');
        if (badge) {
            const color = RATING_COLORS[currentRating] || '#fff';
            badge.textContent = breadthData.rating;
            badge.style.borderColor = color;
            badge.style.color = color;
        }

        stockBreadthChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: '股价宽度',
                    data: dataPoints,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#fff',
                    fill: true,
                    segment: {
                        borderColor: ctx => RATING_COLORS[ctx.p1.raw.rating] || '#fff',
                        backgroundColor: ctx => {
                            const chartArea = ctx.chart.chartArea;
                            if (!chartArea) return null;
                            const gradient = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            const color = RATING_COLORS[ctx.p1.raw.rating] || '#ffffff';
                            gradient.addColorStop(0, `${color}80`);
                            gradient.addColorStop(1, `${color}05`);
                            return gradient;
                        }
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yyyy-MM' } },
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT, maxRotation: 0, autoSkip: true, autoSkipPadding: 20 }
                    },
                    y: {
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(29, 36, 58, 0.95)',
                        titleColor: '#00f5d4',
                        bodyColor: '#e0e5f3',
                        borderColor: '#00f5d4',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return `宽度: ${context.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * 创建VIX及其50日均线历史图表
     */
    function createVixChart(vixData, vix50Data) {
        const ctx = document.getElementById('vix-chart').getContext('2d');
        if (vixChart) {
            vixChart.destroy();
        }
        const vixDataPoints = vixData.data.map(d => ({ x: d.x, y: d.y, rating: d.rating.toLowerCase() }));
        const vix50DataPoints = vix50Data.data.map(d => ({ x: d.x, y: d.y }));

        // 更新评级标签
        const currentRating = vixData.rating.toLowerCase();
        const badge = document.getElementById('vix-rating-badge');
        if (badge) {
            const color = RATING_COLORS[currentRating] || '#fff';
            badge.textContent = vixData.rating;
            badge.style.borderColor = color;
            badge.style.color = color;
        }

        vixChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'VIX',
                    data: vixDataPoints,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#fff',
                    fill: true,
                    segment: {
                        borderColor: ctx => RATING_COLORS[ctx.p1.raw.rating] || '#fff',
                        backgroundColor: ctx => {
                            const chartArea = ctx.chart.chartArea;
                            if (!chartArea) return null;
                            const gradient = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            const color = RATING_COLORS[ctx.p1.raw.rating] || '#ffffff';
                            gradient.addColorStop(0, `${color}80`);
                            gradient.addColorStop(1, `${color}05`);
                            return gradient;
                        }
                    }
                }, {
                    label: '50日移动均线',
                    data: vix50DataPoints,
                    borderColor: 'rgba(138, 153, 192, 0.9)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0.4,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yyyy-MM' } },
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT, maxRotation: 0, autoSkip: true, autoSkipPadding: 20 }
                    },
                    y: {
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: CHART_TICK_COLOR,
                            font: CHART_FONT,
                            boxWidth: 15,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(29, 36, 58, 0.95)',
                        titleColor: '#00f5d4',
                        bodyColor: '#e0e5f3',
                        borderColor: '#00f5d4',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true,
                    }
                }
            }
        });
    }

    // 初始加载数据
    loadFearGreedData();
});
