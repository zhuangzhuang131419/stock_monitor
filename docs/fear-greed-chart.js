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
            createGaugeChart(data.fear_and_greed);
            createHistoryChart(data.fear_and_greed_historical.data);

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
     * @param {object} summaryData - 来自JSON的 fear_and_greed 对象
     */
    function updateSummary(summaryData) {
        document.getElementById('fg-last-updated').textContent = `数据最后更新于: ${new Date(summaryData.timestamp).toLocaleString()}`;
        document.getElementById('fg-score-value').textContent = summaryData.score.toFixed(1);
        const ratingSpan = document.getElementById('fg-score-rating');
        const ratingText = summaryData.rating;
        ratingSpan.textContent = ratingText.charAt(0).toUpperCase() + ratingText.slice(1);
        ratingSpan.style.color = RATING_COLORS[ratingText.toLowerCase()] || '#fff';

        document.getElementById('fg-prev-close').textContent = summaryData.previous_close.toFixed(1);
        document.getElementById('fg-prev-week').textContent = summaryData.previous_1_week.toFixed(1);
        document.getElementById('fg-prev-month').textContent = summaryData.previous_1_month.toFixed(1);
        document.getElementById('fg-prev-year').textContent = summaryData.previous_1_year.toFixed(1);
    }

    /**
     * 创建当前分数的仪表盘图
     * @param {object} summaryData - 来自JSON的 fear_and_greed 对象
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
                    borderColor: ['transparent', 'transparent'],
                    borderWidth: 0,
                    borderRadius: 8,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                circumference: 180,
                rotation: 270,
                cutout: '80%',
                plugins: {
                    tooltip: { enabled: false },
                    legend: { display: false }
                }
            }
        });
    }

    /**
     * 创建历史数据折线图
     * @param {Array} historyData - 来自 fear_and_greed_historical 的数据数组
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
                    pointHoverRadius: 5,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            tooltipFormat: 'yyyy-MM-dd',
                            displayFormats: {
                                month: 'yyyy-MM'
                            }
                        },
                        grid: { color: CHART_GRID_COLOR },
                        ticks: { color: CHART_TICK_COLOR, font: CHART_FONT, maxRotation: 0, autoSkip: true }
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
                },
                segment: {
                    borderColor: ctx => RATING_COLORS[ctx.p1.raw.rating] || '#fff',
                    backgroundColor: ctx => (RATING_COLORS[ctx.p1.raw.rating] || '#fff') + '33' // Adding alpha for area fill
                }
            }
        });
    }

    // 初始加载数据
    loadFearGreedData();
});
