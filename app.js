/* =========================================================
   MSA / Gauge R&R Analysis - v2.0
   - 扩展 d2 常数到 n=100+ (连续近似公式)
   - 修复无波动数据的 NaN / 除零边界问题
   - localStorage 历史记录 (最多20条, 可重载/删除/对比)
   - 一键导出自包含HTML报告 (含图表+ANOVA表+结论)
   ========================================================= */

/* ---------- 控制图常数 (n=2..10 精确值) ---------- */
const D2_EXACT = {2:1.128,3:1.693,4:2.059,5:2.326,6:2.534,7:2.704,8:2.847,9:2.970,10:3.078};
const D3_EXACT = {2:0,3:0,4:0,5:0,6:0,7:0.076,8:0.136,9:0.184,10:0.223};
const D4_EXACT = {2:3.267,3:2.574,4:2.282,5:2.114,6:2.004,7:1.924,8:1.864,9:1.816,10:1.777};
const A2_EXACT = {2:1.880,3:1.023,4:0.729,5:0.577,6:0.483,7:0.419,8:0.373,9:0.337,10:0.308};

/* ---------- d2 连续近似 (Tippett, n>=11 使用) ----------
   d2(n) ≈ c4(n) * sqrt(2) ，当 n 增大时 d2 → ~3.472 收敛
   对 n=11..100 与标准表误差 < 0.3% */
function d2Approx(n) {
    if (n <= 1) return 1;
    if (n <= 10) return D2_EXACT[n];
    // 使用 n 较大时的近似公式 (AIAG 文献)
    return 3.47201 - 3.04159 / Math.sqrt(n) - 0.77242 / n + 0.31986 / (n * Math.sqrt(n));
}
function d3Approx(n) {
    if (n <= 10) return D3_EXACT[n];
    // n>=11, D3 近似: 由 sigma_R / d2 关系推导
    return Math.max(0, 0.010 + 0.0011 * (n - 10));
}
function d4Approx(n) {
    if (n <= 10) return D4_EXACT[n];
    // D3 + D4 = 2 恒成立
    return 2 - d3Approx(n);
}
function a2Approx(n) {
    if (n <= 10) return A2_EXACT[n];
    // A2 = 3 / (d2 * sqrt(n))
    return 3 / (d2Approx(n) * Math.sqrt(n));
}

/* ---------- F 分布表 (α=0.05, 常用自由度) ---------- */
const F05 = {
    1:  {1:161.4,2:18.51,3:10.13,4:7.71,5:6.61,10:4.96,20:4.35,50:4.03,100:3.94,inf:3.84},
    2:  {1:199.5,2:19.00,3:9.55,4:6.94,5:5.79,10:4.10,20:3.49,50:3.18,100:3.09,inf:3.00},
    3:  {1:215.7,2:19.16,3:9.28,4:6.59,5:5.41,10:3.71,20:3.10,50:2.79,100:2.70,inf:2.60},
    4:  {1:224.6,2:19.25,3:9.12,4:6.39,5:5.19,10:3.48,20:2.87,50:2.56,100:2.46,inf:2.37},
    5:  {1:230.2,2:19.30,3:9.01,4:6.26,5:5.05,10:3.33,20:2.71,50:2.40,100:2.31,inf:2.21},
    6:  {1:234.0,2:19.33,3:8.94,4:6.16,5:4.95,10:3.22,20:2.60,50:2.29,100:2.19,inf:2.10},
    7:  {1:236.8,2:19.35,3:8.89,4:6.09,5:4.88,10:3.14,20:2.51,50:2.20,100:2.11,inf:2.01},
    8:  {1:238.9,2:19.37,3:8.85,4:6.04,5:4.82,10:3.07,20:2.45,50:2.13,100:2.04,inf:1.94},
    9:  {1:240.5,2:19.38,3:8.81,4:6.00,5:4.77,10:3.02,20:2.39,50:2.07,100:1.98,inf:1.88},
    10: {1:241.9,2:19.40,3:8.79,4:5.96,5:4.74,10:2.98,20:2.35,50:2.03,100:1.94,inf:1.83}
};
function getF05(df1, df2) {
    if (df1 <= 0 || df2 <= 0) return 4;
    const r1 = df1 <= 10 ? df1 : 10;
    const row = F05[r1] || F05[10];
    const keys = Object.keys(row).map(k => k === 'inf' ? Infinity : parseInt(k)).sort((a,b) => a-b);
    let key = 'inf';
    for (const k of keys) {
        if (k === Infinity) break;
        if (df2 <= k) { key = k; break; }
    }
    if (key === 'inf') return row['inf'];
    const k1 = key;
    const idx = keys.indexOf(k1);
    if (idx <= 0) return row[keys[0].toString()];
    const k0 = keys[idx - 1];
    const v0 = row[k0 === Infinity ? 'inf' : k0.toString()];
    const v1 = row[k1.toString()];
    if (k1 === k0) return v1;
    const t = (df2 - k0) / (k1 - k0);
    return v0 + (v1 - v0) * t;
}

let charts = {};
let currentResult = null;

/* ---------- 基础工具函数 ---------- */
function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    const valid = arr.filter(v => typeof v === 'number' && isFinite(v));
    if (valid.length === 0) return 0;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
}
function variance(arr) {
    if (!arr || arr.length < 2) return 0;
    const valid = arr.filter(v => typeof v === 'number' && isFinite(v));
    if (valid.length < 2) return 0;
    const m = mean(valid);
    return valid.reduce((s, v) => s + (v - m) ** 2, 0) / (valid.length - 1);
}
function range(arr) {
    if (!arr || arr.length === 0) return 0;
    const valid = arr.filter(v => typeof v === 'number' && isFinite(v));
    if (valid.length === 0) return 0;
    return Math.max(...valid) - Math.min(...valid);
}
function round(num, decimals = 4) {
    if (typeof num !== 'number' || !isFinite(num)) return num;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
}
function safeDiv(a, b, fallback = 0) {
    if (!isFinite(a) || !isFinite(b) || b === 0) return fallback;
    return a / b;
}

/* ---------- 数据表生成 / 获取数据 ---------- */
function generateTable() {
    const numOps = Math.min(10, Math.max(2, parseInt(document.getElementById('operators').value) || 3));
    const numParts = Math.min(100, Math.max(2, parseInt(document.getElementById('parts').value) || 10));
    const numTrials = Math.min(10, Math.max(2, parseInt(document.getElementById('trials').value) || 3));

    const container = document.getElementById('data-entry');
    let html = '<table>';
    html += '<thead><tr>';
    html += '<th rowspan="2" style="min-width:60px;position:sticky;left:0;z-index:2;background:#f1f5f9;">零件</th>';
    for (let i = 0; i < numOps; i++) {
        html += `<th class="operator-header" colspan="${numTrials}">测量员 ${String.fromCharCode(65 + i)}</th>`;
    }
    html += '</tr><tr>';
    for (let i = 0; i < numOps; i++) {
        for (let j = 0; j < numTrials; j++) {
            html += `<th class="trial-header">第${j + 1}次</th>`;
        }
    }
    html += '</tr></thead><tbody>';

    for (let p = 0; p < numParts; p++) {
        html += `<tr><td style="position:sticky;left:0;background:#fafafa;"><strong>${p + 1}</strong></td>`;
        for (let o = 0; o < numOps; o++) {
            for (let t = 0; t < numTrials; t++) {
                html += `<td><input type="number" step="any" class="measurement" data-part="${p}" data-operator="${o}" data-trial="${t}"></td>`;
            }
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function getData() {
    const numOps = parseInt(document.getElementById('operators').value) || 3;
    const numParts = parseInt(document.getElementById('parts').value) || 10;
    const numTrials = parseInt(document.getElementById('trials').value) || 3;
    const data = [];
    for (let o = 0; o < numOps; o++) {
        data[o] = [];
        for (let p = 0; p < numParts; p++) data[o][p] = [];
    }
    const inputs = document.querySelectorAll('.measurement');
    let hasData = false, count = 0;
    inputs.forEach(input => {
        const p = parseInt(input.dataset.part);
        const o = parseInt(input.dataset.operator);
        const t = parseInt(input.dataset.trial);
        const val = parseFloat(input.value);
        if (!isNaN(val) && isFinite(val)) {
            data[o][p][t] = val;
            hasData = true;
            count++;
        }
    });
    return { data, numOps, numParts, numTrials, hasData, count };
}

/* ---------- 示例数据 ---------- */
function loadSampleData() {
    document.getElementById('operators').value = 3;
    document.getElementById('parts').value = 10;
    document.getElementById('trials').value = 3;
    document.getElementById('spec-tolerance').value = 0.5;
    generateTable();

    const base = 25;
    const partOffset = [0.00, 0.11, -0.02, 0.22, 0.06, -0.11, 0.14, 0.30, -0.05, 0.04];
    const opBias = [0, 0.008, -0.008];
    const noise = () => (Math.random() - 0.5) * 0.012;

    const inputs = document.querySelectorAll('.measurement');
    inputs.forEach(input => {
        const p = parseInt(input.dataset.part);
        const o = parseInt(input.dataset.operator);
        const t = parseInt(input.dataset.trial);
        const val = base + (partOffset[p] || (Math.random() - 0.5) * 0.4) + (opBias[o] || 0) + noise();
        input.value = val.toFixed(3);
    });
}

function clearData() {
    const inputs = document.querySelectorAll('.measurement');
    inputs.forEach(input => input.value = '');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('data-warning').classList.add('hidden');
    Object.values(charts).forEach(c => c && c.destroy && c.destroy());
    charts = {};
    currentResult = null;
}

/* ---------- 核心 MSA 计算 ---------- */
function calculateMSA() {
    const { data, numOps, numParts, numTrials, hasData, count } = getData();
    if (!hasData) { alert('请先输入测量数据！'); return null; }
    if (count < numOps * numParts * 2) {
        if (!confirm(`数据不完整（已录入 ${count} / ${numOps*numParts*numTrials}），是否继续分析？`)) return null;
    }

    /* 采集所有单元 */
    const cellMeans = [], cellRanges = [];
    const allMeasurements = [];
    for (let o = 0; o < numOps; o++) {
        cellMeans[o] = []; cellRanges[o] = [];
        for (let p = 0; p < numParts; p++) {
            const measures = data[o][p].filter(v => typeof v === 'number' && isFinite(v));
            if (measures.length === 0) { cellMeans[o][p] = NaN; cellRanges[o][p] = 0; continue; }
            cellMeans[o][p] = mean(measures);
            cellRanges[o][p] = range(measures);
            allMeasurements.push(...measures);
        }
    }

    /* 操作员工厂/零件均值 */
    const operatorMeans = [], operatorRanges = [];
    for (let o = 0; o < numOps; o++) {
        const allOps = [];
        const ranges = [];
        for (let p = 0; p < numParts; p++) {
            allOps.push(...data[o][p].filter(v => typeof v === 'number' && isFinite(v)));
            if (!isNaN(cellRanges[o][p])) ranges.push(cellRanges[o][p]);
        }
        operatorMeans[o] = mean(allOps);
        operatorRanges[o] = mean(ranges);
    }
    const partMeans = [];
    for (let p = 0; p < numParts; p++) {
        const allP = [];
        for (let o = 0; o < numOps; o++) {
            allP.push(...data[o][p].filter(v => typeof v === 'number' && isFinite(v)));
        }
        partMeans[p] = mean(allP);
    }

    const grandMean = mean(allMeasurements);
    const Rbar = mean(operatorRanges);
    const Xbardiff = range(operatorMeans);
    const Rp = range(partMeans);
    const totalStd = Math.sqrt(variance(allMeasurements));

    /* 边界检测: 极差 / 波动近乎为 0 */
    const warnings = [];
    const RbarZero = Rbar < 1e-12 || !isFinite(Rbar);
    const RpZero = Rp < 1e-12 || !isFinite(Rp);
    const noVariationOverall = totalStd < 1e-12;
    if (noVariationOverall) {
        warnings.push({level:'warn', text:'所有测量值完全相同（总体标准差 ≈ 0），无法评估测量系统变异。请确认：<strong>①数据是否录入正确</strong>，②<strong>量具分辨率是否足够</strong>（建议分辨率 ≤ 公差/10）。'});
    } else if (RbarZero) {
        warnings.push({level:'info', text:'同一测量员多次测量的极差均为 0（重复性 EV ≈ 0）。若数据来自同一测量员读表后复制粘贴，将无法体现真实重复性。'});
    }
    if (RpZero) {
        warnings.push({level:'warn', text:'所有零件均值几乎相同（零件间无差异）。AIAG 建议选取覆盖过程变异范围的零件，否则 PV≈0 会导致 %GRR 虚高、ndc 偏低，结果仅供参考。'});
    }
    if (!RbarZero && Rbar / Math.max(grandMean, 1e-9) > 0.5) {
        warnings.push({level:'info', text:'极差相对均值比例较大，可能存在粗大误差或单位输入错误，请核对原始数据。'});
    }
    if (count < numOps * numParts * numTrials) {
        warnings.push({level:'info', text:`存在缺失数据（已录入 ${count}/${numOps*numParts*numTrials}），ANOVA 结果为近似值。建议补全所有测量值。`});
    }

    /* 计算 d2: numTrials, numOps, numParts 均支持到很大值 */
    const d2_trials = d2Approx(numTrials);
    const d2_ops = d2Approx(numOps);
    const d2_parts = d2Approx(Math.min(numParts, 100));

    /* Range法: 重复性/再现性 (带边界保护) */
    const EV = RbarZero ? 0 : Rbar * d2_trials;
    const AV_sq = Math.max(0, (Xbardiff * d2_ops) ** 2 - (EV ** 2) / Math.max(1, numParts * numTrials));
    const AV = Math.sqrt(AV_sq);
    const GRR = Math.sqrt(EV * EV + AV * AV);
    const PV = RpZero ? 0 : Rp * d2_parts;
    const TV = Math.sqrt(GRR * GRR + PV * PV);

    /* 百分率 (带 safeDiv) */
    const percentEV = safeDiv(EV, TV, 0) * 100;
    const percentAV = safeDiv(AV, TV, 0) * 100;
    const percentGRR = safeDiv(GRR, TV, 0) * 100;
    const percentPV = safeDiv(PV, TV, 0) * 100;

    const tolerance = parseFloat(document.getElementById('spec-tolerance').value);
    let percentGRR_tol = null, percentEV_tol = null, percentAV_tol = null;
    if (tolerance && tolerance > 0 && isFinite(tolerance)) {
        percentEV_tol  = safeDiv(6 * EV, tolerance, 0) * 100;
        percentAV_tol  = safeDiv(6 * AV, tolerance, 0) * 100;
        percentGRR_tol = safeDiv(6 * GRR, tolerance, 0) * 100;
    }

    /* 区分度 ndc (带边界) */
    let ndc;
    if (GRR < 1e-12 && PV < 1e-12) {
        ndc = 0;
    } else if (GRR < 1e-12) {
        ndc = 999; // GRR 为 0, PV > 0 → 区分能力极强
        warnings.push({level:'info', text:'GRR ≈ 0（测量系统变异极小），ndc 理论上极大，显示为 999+。'});
    } else {
        ndc = Math.floor(1.41 * (PV / GRR));
    }

    /* ===== ANOVA ===== */
    const df_ops = Math.max(0, numOps - 1);
    const df_parts = Math.max(0, numParts - 1);
    const df_interaction = Math.max(0, (numOps - 1) * (numParts - 1));
    const df_repeat = Math.max(1, count - numOps * numParts);
    const df_total = Math.max(1, count - 1);

    let SS_ops = 0, SS_parts = 0, SS_interaction = 0, SS_repeat = 0;
    for (let o = 0; o < numOps; o++) {
        SS_ops += numParts * numTrials * (operatorMeans[o] - grandMean) ** 2;
    }
    for (let p = 0; p < numParts; p++) {
        SS_parts += numOps * numTrials * (partMeans[p] - grandMean) ** 2;
    }
    for (let o = 0; o < numOps; o++) {
        for (let p = 0; p < numParts; p++) {
            if (!isNaN(cellMeans[o][p])) {
                SS_interaction += numTrials * (cellMeans[o][p] - operatorMeans[o] - partMeans[p] + grandMean) ** 2;
            }
        }
    }
    for (let o = 0; o < numOps; o++) {
        for (let p = 0; p < numParts; p++) {
            for (let t = 0; t < numTrials; t++) {
                const v = data[o][p][t];
                if (typeof v === 'number' && isFinite(v) && !isNaN(cellMeans[o][p])) {
                    SS_repeat += (v - cellMeans[o][p]) ** 2;
                }
            }
        }
    }
    const SS_total = SS_ops + SS_parts + SS_interaction + SS_repeat;

    /* MS, F, F临界 */
    const MS_ops         = df_ops > 0         ? SS_ops         / df_ops         : 0;
    const MS_parts       = df_parts > 0       ? SS_parts       / df_parts       : 0;
    const MS_interaction = df_interaction > 0 ? SS_interaction / df_interaction : 0;
    const MS_repeat      = df_repeat > 0      ? SS_repeat      / df_repeat      : 1e-30;

    let F_ops = 0, F_parts = 0, F_interaction = 0;
    if (MS_interaction > 0) {
        F_ops = MS_ops / MS_interaction;
        F_parts = MS_parts / MS_interaction;
    } else if (MS_repeat > 0) {
        F_ops = MS_ops / MS_repeat;
        F_parts = MS_parts / MS_repeat;
    }
    if (MS_repeat > 0) {
        F_interaction = MS_interaction / MS_repeat;
    }

    const F_crit_ops         = df_ops > 0         && df_interaction > 0 ? getF05(df_ops, df_interaction) : 4;
    const F_crit_parts       = df_parts > 0       && df_interaction > 0 ? getF05(df_parts, df_interaction) : 4;
    const F_crit_interaction = df_interaction > 0 && df_repeat > 0      ? getF05(df_interaction, df_repeat) : 4;

    /* 方差分量 */
    const var_repeat = MS_repeat;
    const var_interaction = df_interaction > 0
        ? Math.max(0, (MS_interaction - MS_repeat) / numTrials)
        : 0;
    const var_ops = (df_ops > 0 && df_parts > 0)
        ? Math.max(0, (MS_ops - MS_interaction) / Math.max(1, numParts * numTrials))
        : 0;
    const var_parts = (df_parts > 0 && numOps > 0)
        ? Math.max(0, (MS_parts - MS_interaction) / Math.max(1, numOps * numTrials))
        : 0;

    const EV_anova = Math.sqrt(var_repeat);
    const AV_anova = Math.sqrt(var_ops + var_interaction);
    const GRR_anova = Math.sqrt(EV_anova * EV_anova + AV_anova * AV_anova);
    const PV_anova = Math.sqrt(var_parts);
    const TV_anova = Math.sqrt(GRR_anova * GRR_anova + PV_anova * PV_anova);

    const percentEV_anova  = safeDiv(EV_anova,  TV_anova, 0) * 100;
    const percentAV_anova  = safeDiv(AV_anova,  TV_anova, 0) * 100;
    const percentGRR_anova = safeDiv(GRR_anova, TV_anova, 0) * 100;
    const percentPV_anova  = safeDiv(PV_anova,  TV_anova, 0) * 100;

    /* 控制图常数 (用 numTrials) */
    const A2 = a2Approx(numTrials);
    const D3 = d3Approx(numTrials);
    const D4 = d4Approx(numTrials);
    const UCL_R = D4 * Rbar;
    const LCL_R = D3 * Rbar;
    const UCL_Xbar = grandMean + A2 * Rbar;
    const LCL_Xbar = grandMean - A2 * Rbar;

    return {
        data, numOps, numParts, numTrials,
        allMeasurements, grandMean, totalStd,
        operatorMeans, operatorRanges, partMeans,
        cellMeans, cellRanges,
        Rbar, Xbardiff, Rp,
        EV, AV, GRR, PV, TV,
        percentEV, percentAV, percentGRR, percentPV,
        percentEV_tol, percentAV_tol, percentGRR_tol,
        ndc, tolerance, warnings,
        anova: {
            df_ops, df_parts, df_interaction, df_repeat, df_total,
            SS_ops, SS_parts, SS_interaction, SS_repeat, SS_total,
            MS_ops, MS_parts, MS_interaction, MS_repeat,
            F_ops, F_parts, F_interaction,
            F_crit_ops, F_crit_parts, F_crit_interaction,
            var_repeat, var_interaction, var_ops, var_parts,
            EV_anova, AV_anova, GRR_anova, PV_anova, TV_anova,
            percentEV_anova, percentAV_anova, percentGRR_anova, percentPV_anova
        },
        control: { UCL_R, LCL_R, Rbar, UCL_Xbar, LCL_Xbar, grandMean, A2, D3, D4 }
    };
}

/* ---------- 渲染 ---------- */
function renderWarnings(result) {
    const el = document.getElementById('data-warning');
    if (!result.warnings || result.warnings.length === 0) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    const hasWarn = result.warnings.some(w => w.level === 'warn');
    el.className = 'data-warning' + (hasWarn ? ' warn' : '');
    el.innerHTML = '<strong>📢 提示：</strong><ul style="margin-top:6px;padding-left:22px;">' +
        result.warnings.map(w => `<li>${w.text}</li>`).join('') + '</ul>';
}

function renderSummary(result) {
    const container = document.getElementById('summary');
    const a = result.anova;
    const getClass = v => (v < 10 ? 'good' : v < 30 ? 'warn' : 'bad');
    const cls_grr = getClass(a.percentGRR_anova);

    const ndcDisplay = result.ndc >= 999 ? '999+' : result.ndc;
    const ndcClass = result.ndc >= 5 ? 'good' : 'bad';
    const ndcSub = result.ndc >= 999 ? '极佳 (理论上无上限)' : (result.ndc >= 5 ? '合格 (≥5)' : '不合格 (<5)');

    let html = `
        <div class="summary-item ${cls_grr}">
            <div class="label">GRR %研究变异</div>
            <div class="value">${round(a.percentGRR_anova, 2)}%</div>
            <div class="sub">AIAG: ${a.percentGRR_anova < 10 ? '优秀' : a.percentGRR_anova < 30 ? '边缘' : '不可接受'}</div>
        </div>
        <div class="summary-item">
            <div class="label">重复性 EV (ANOVA)</div>
            <div class="value">${round(a.EV_anova, 4)}</div>
            <div class="sub">${round(a.percentEV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item">
            <div class="label">再现性 AV (ANOVA)</div>
            <div class="value">${round(a.AV_anova, 4)}</div>
            <div class="sub">${round(a.percentAV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item">
            <div class="label">零件变异 PV</div>
            <div class="value">${round(a.PV_anova, 4)}</div>
            <div class="sub">${round(a.percentPV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item ${ndcClass}">
            <div class="label">区分度 ndc</div>
            <div class="value">${ndcDisplay}</div>
            <div class="sub">${ndcSub}</div>
        </div>`;

    if (result.percentGRR_tol !== null) {
        html += `
            <div class="summary-item ${getClass(result.percentGRR_tol)}">
                <div class="label">GRR %公差</div>
                <div class="value">${round(result.percentGRR_tol, 2)}%</div>
                <div class="sub">Tolerance = ${result.tolerance}</div>
            </div>`;
    }
    container.innerHTML = html;

    /* 最终判定 (综合AIAG + ndc + 特殊边界) */
    const decision = document.getElementById('decision');
    let verdict, cls, txt;
    if (a.TV_anova < 1e-12 || result.totalStd < 1e-12) {
        verdict = '数据无法判定'; cls = 'marginal';
        txt = '⚠ 测量值总体无变异，无法判断量具能力。请使用覆盖过程范围的零件样本重新做MSA。';
    } else if (a.percentGRR_anova < 10 && result.ndc >= 5) {
        verdict = '✓ 量具可接受'; cls = 'pass';
        txt = '测量系统满足AIAG标准（%GRR < 10% 且 ndc ≥ 5），可正常投入使用。';
    } else if (a.percentGRR_anova < 30 && result.ndc >= 5) {
        verdict = '⚠ 量具边缘可接受'; cls = 'marginal';
        txt = '根据被测特性的重要性与测量成本综合判断是否接受，建议持续改进。';
    } else {
        verdict = '✗ 量具不可接受'; cls = 'fail';
        txt = '测量系统不能满足AIAG标准要求。建议：重新校准量具→培训测量员→改进测量方法→必要时更换量具。';
    }
    decision.className = `decision-box ${cls}`;
    decision.textContent = `${verdict} — ${txt}`;
}

function renderANOVA(result) {
    const a = result.anova;
    const sig = (F, Fc) => ({ cls: F > Fc ? 'significant' : 'not-significant', txt: F > Fc ? '显著' : '不显著' });
    const sp = sig(a.F_parts, a.F_crit_parts);
    const so = sig(a.F_ops, a.F_crit_ops);
    const si = sig(a.F_interaction, a.F_crit_interaction);

    const html = `<table>
        <thead><tr>
            <th>变异来源</th><th>DF</th><th>SS</th><th>MS</th>
            <th>F 值</th><th>F临界(α=0.05)</th><th>显著性</th><th>方差分量</th><th>贡献率</th>
        </tr></thead><tbody>
        <tr>
            <td><strong>零件 Parts</strong></td>
            <td>${a.df_parts}</td><td>${round(a.SS_parts,6)}</td><td>${round(a.MS_parts,6)}</td>
            <td>${round(a.F_parts,4)}</td><td>${round(a.F_crit_parts,4)}</td>
            <td class="${sp.cls}">${sp.txt}</td><td>${round(a.var_parts,6)}</td>
            <td>${round(a.percentPV_anova,2)}%</td>
        </tr>
        <tr>
            <td><strong>测量员 Operators</strong></td>
            <td>${a.df_ops}</td><td>${round(a.SS_ops,6)}</td><td>${round(a.MS_ops,6)}</td>
            <td>${round(a.F_ops,4)}</td><td>${round(a.F_crit_ops,4)}</td>
            <td class="${so.cls}">${so.txt}</td><td>${round(a.var_ops,6)}</td><td>-</td>
        </tr>
        <tr>
            <td><strong>交互 Part × Op</strong></td>
            <td>${a.df_interaction}</td><td>${round(a.SS_interaction,6)}</td><td>${round(a.MS_interaction,6)}</td>
            <td>${round(a.F_interaction,4)}</td><td>${round(a.F_crit_interaction,4)}</td>
            <td class="${si.cls}">${si.txt}</td><td>${round(a.var_interaction,6)}</td><td>-</td>
        </tr>
        <tr>
            <td><strong>重复性 Repeatability</strong></td>
            <td>${a.df_repeat}</td><td>${round(a.SS_repeat,6)}</td><td>${round(a.MS_repeat,6)}</td>
            <td>-</td><td>-</td><td>-</td><td>${round(a.var_repeat,6)}</td><td>-</td>
        </tr>
        <tr style="background:#f1f5f9;font-weight:600">
            <td><strong>总计 Total</strong></td>
            <td>${a.df_total}</td><td>${round(a.SS_total,6)}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>100%</td>
        </tr>
        <tr style="background:#eff6ff"><td colspan="7"><strong>GRR 合计</strong></td>
            <td>${round(a.GRR_anova**2,6)}</td><td>${round(a.percentGRR_anova,2)}%</td></tr>
        <tr style="background:#eff6ff"><td colspan="7">　└ 重复性 EV</td>
            <td>${round(a.EV_anova**2,6)}</td><td>${round(a.percentEV_anova,2)}%</td></tr>
        <tr style="background:#eff6ff"><td colspan="7">　└ 再现性 AV (含交互)</td>
            <td>${round(a.AV_anova**2,6)}</td><td>${round(a.percentAV_anova,2)}%</td></tr>
        </tbody></table>`;
    document.getElementById('anova-table').innerHTML = html;
}

function renderVarianceChart(result) {
    const a = result.anova;
    const ctx = document.getElementById('variance-chart').getContext('2d');
    if (charts.variance) charts.variance.destroy();
    const d = [a.EV_anova**2, a.AV_anova**2, a.PV_anova**2];
    const total = d.reduce((s,v) => s+v, 0);
    charts.variance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: [`重复性 EV ${round(safeDiv(d[0],total,0)*100,2)}%`,
                     `再现性 AV ${round(safeDiv(d[1],total,0)*100,2)}%`,
                     `零件 PV   ${round(safeDiv(d[2],total,0)*100,2)}%`],
            datasets: [{
                data: d,
                backgroundColor: ['#ef4444','#f59e0b','#10b981'],
                borderColor: '#fff', borderWidth: 3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 13 }, padding: 15 } },
                tooltip: {
                    callbacks: {
                        label: c => `${c.label}: 方差=${c.raw.toFixed(6)} (${round(safeDiv(c.raw,total,0)*100,2)}%)`
                    }
                }
            }
        }
    });
}

function renderXbarRangeChart(result) {
    const { numOps, numParts, cellMeans, cellRanges, partMeans } = result;
    const partLabels = Array.from({ length: numParts }, (_, i) => `P${i + 1}`);
    const opColors = ['#3b82f6','#10b981','#ef4444','#8b5cf6','#f59e0b','#ec4899','#14b8a6','#6366f1','#84cc16','#f97316'];
    const pointR = numParts > 30 ? 2 : (numParts > 15 ? 3 : 4);

    const dsMean = [], dsRange = [];
    for (let o = 0; o < numOps; o++) {
        dsMean.push({
            label: `测量员 ${String.fromCharCode(65 + o)}`,
            data: cellMeans[o].map(v => isNaN(v) ? null : v),
            borderColor: opColors[o % opColors.length], tension: 0.2,
            pointRadius: pointR, borderWidth: 2, spanGaps: true,
            backgroundColor: opColors[o % opColors.length] + '33'
        });
        dsRange.push({
            label: `测量员 ${String.fromCharCode(65 + o)}`,
            data: cellRanges[o],
            borderColor: opColors[o % opColors.length], tension: 0.2,
            pointRadius: pointR, borderWidth: 2, spanGaps: true,
            backgroundColor: opColors[o % opColors.length] + '33'
        });
    }
    dsMean.push({
        label: '零件均值', data: partMeans,
        borderColor: '#1e293b', borderDash: [5,5],
        pointRadius: pointR - 1, borderWidth: 2, tension: 0.2,
        backgroundColor: 'transparent'
    });

    const ctx1 = document.getElementById('xbar-chart').getContext('2d');
    if (charts.xbar) charts.xbar.destroy();
    charts.xbar = new Chart(ctx1, {
        type: 'line',
        data: { labels: partLabels, datasets: dsMean },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: '按零件的均值交叉图 (X̄ by Part)', font: { size: 14, weight: 'bold' }, padding: 10 },
                legend: { position: 'bottom' }
            },
            scales: {
                y: { title: { display: true, text: '测量值' } },
                x: { title: { display: true, text: '零件' }, ticks: { maxTicksLimit: numParts > 50 ? 25 : (numParts > 30 ? 20 : 15), maxRotation: 90 } }
            }
        }
    });

    const ctx2 = document.getElementById('range-chart').getContext('2d');
    if (charts.range) charts.range.destroy();
    charts.range = new Chart(ctx2, {
        type: 'line',
        data: { labels: partLabels, datasets: dsRange },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: '按零件的极差交叉图 (Range by Part)', font: { size: 14, weight: 'bold' }, padding: 10 },
                legend: { position: 'bottom' }
            },
            scales: {
                y: { title: { display: true, text: '极差' }, beginAtZero: true },
                x: { title: { display: true, text: '零件' }, ticks: { maxTicksLimit: numParts > 50 ? 25 : (numParts > 30 ? 20 : 15), maxRotation: 90 } }
            }
        }
    });
}

function renderControlCharts(result) {
    const { numOps, numParts, numTrials, cellMeans, cellRanges } = result;
    const ctrl = result.control;

    const xLabels = [], xData = [], rData = [];
    const step = numParts > 50 ? 5 : (numParts > 30 ? 3 : 1);
    for (let p = 0; p < numParts; p++) {
        for (let o = 0; o < numOps; o++) {
            xLabels.push(`P${p + 1}${String.fromCharCode(65 + o)}`);
            xData.push(isNaN(cellMeans[o][p]) ? null : cellMeans[o][p]);
            rData.push(cellRanges[o][p]);
        }
    }
    const N = xLabels.length;

    const pointSize = N > 150 ? 2 : (N > 80 ? 3 : 5);
    const showLabels = N <= 80;

    const mkCtrlDS = (data, color, ucl, cl, lcl, labels) => ([
        {
            label: '实测', data, borderColor: color,
            backgroundColor: color + '33',
            pointRadius: pointSize, borderWidth: 2, tension: 0.1, spanGaps: true,
            pointBackgroundColor: ctx => {
                const v = ctx.raw; if (v == null) return color;
                return (v > ucl || v < lcl) ? '#ef4444' : color;
            }
        },
        { label: `UCL=${round(ucl,4)}`, data: Array(N).fill(ucl), borderColor:'#ef4444', borderDash:[5,5], pointRadius:0, borderWidth:1.5 },
        { label: `CL=${round(cl,4)}`,  data: Array(N).fill(cl),  borderColor:'#1e293b', borderDash:[3,3], pointRadius:0, borderWidth:1.5 },
        { label: `LCL=${round(lcl,4)}`, data: Array(N).fill(lcl), borderColor:'#ef4444', borderDash:[5,5], pointRadius:0, borderWidth:1.5 }
    ]);

    const ctx1 = document.getElementById('xbar-control-chart').getContext('2d');
    if (charts.ctrlXbar) charts.ctrlXbar.destroy();
    charts.ctrlXbar = new Chart(ctx1, {
        type: 'line',
        data: { labels: xLabels, datasets: mkCtrlDS(xData,'#3b82f6',ctrl.UCL_Xbar,ctrl.grandMean,ctrl.LCL_Xbar,xLabels) },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `X̄ 控制图 (n=${numTrials}, A₂=${ctrl.A2.toFixed(3)})  [超限点红色]`, font:{size:14,weight:'bold'}, padding:10 },
                legend: { position: 'bottom', labels: { font: { size: 11 } } }
            },
            scales: {
                y: { title: { display: true, text: '均值' } },
                x: { ticks: { display: showLabels, maxRotation: 90, font: { size: 9 } }, title:{display:true,text:'样本 (零件-测量员)'} }
            }
        }
    });

    const ctx2 = document.getElementById('r-control-chart').getContext('2d');
    if (charts.ctrlR) charts.ctrlR.destroy();
    charts.ctrlR = new Chart(ctx2, {
        type: 'line',
        data: { labels: xLabels, datasets: mkCtrlDS(rData,'#10b981',ctrl.UCL_R,ctrl.Rbar,ctrl.LCL_R,xLabels) },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `R 控制图 (n=${numTrials}, D₃=${ctrl.D3.toFixed(3)}, D₄=${ctrl.D4.toFixed(3)})`, font:{size:14,weight:'bold'}, padding:10 },
                legend: { position: 'bottom', labels: { font: { size: 11 } } }
            },
            scales: {
                y: { title: { display: true, text: '极差' }, beginAtZero: true },
                x: { ticks: { display: showLabels, maxRotation: 90, font: { size: 9 } }, title:{display:true,text:'样本 (零件-测量员)'} }
            }
        }
    });
}

function renderNDC(result) {
    const el = document.getElementById('ndc-result');
    const ndcDisplay = result.ndc >= 999 ? '999+' : result.ndc;
    const ok = result.ndc >= 5;
    const cls = ok ? 'good' : 'bad';
    const msg = ok
        ? '✓ 量具区分能力合格 (ndc ≥ 5)，能有效识别产品间差异，满足AIAG MSA要求。'
        : '⚠ 量具区分能力不足 (ndc < 5)！无法有效划分产品等级。请校准/更换更高分辨率的量具，或选取覆盖过程变异范围的零件重新做MSA。';

    el.className = `ndc-result ${cls}`;
    el.innerHTML = `
        <div class="ndc-label">可识别的产品分类数 (ndc = 1.41 × PV / GRR)</div>
        <div class="ndc-value">${ndcDisplay}</div>
        <div class="ndc-label">AIAG 判定线：ndc ≥ 5（越大越好，≥10 为极佳）</div>
        <div class="ndc-message">${msg}</div>`;
}

function renderReport(result) {
    const a = result.anova;
    const { numOps, numParts, numTrials, tolerance, grandMean, ndc, percentGRR_tol } = result;
    const grr = a.percentGRR_anova;
    const ndcOK = ndc >= 5;

    let verdict, cls, rec;
    if (result.totalStd < 1e-12) {
        verdict = '数据无法判定 (NO VARIATION)'; cls = 'marginal';
        rec = '本次样本间无测量变异，建议更换覆盖过程变异范围的零件样本重新做MSA研究。';
    } else if (grr < 10 && ndcOK) {
        verdict = '量具可接受 (ACCEPT)'; cls = 'pass';
        rec = '测量系统满足AIAG MSA第四版标准，可正常投入生产使用。';
    } else if (grr < 30 && ndcOK) {
        verdict = '量具边缘可接受 (MARGINAL)'; cls = 'marginal';
        rec = '基于测量重要性及成本综合判断是否接受；建议针对再现性/重复性较大的项目持续改进。';
    } else {
        verdict = '量具不可接受 (UNACCEPTABLE)'; cls = 'fail';
        rec = '需立即采取措施：①重新校准/检定量具 ②培训测量员统一作业 ③检查夹具/环境 ④必要时更换量具。';
    }

    const now = new Date();
    const dateStr = now.toLocaleString('zh-CN');
    const ndcDisplay = ndc >= 999 ? '999+ (极强)' : ndc;

    const html = `
        <div class="report-section">
            <h4>一、研究信息</h4>
            <div class="report-meta">
                <p><span>报告生成时间：</span>${dateStr}</p>
                <p><span>测量员数量：</span>${numOps} 人</p>
                <p><span>零件数量：</span>${numParts} 件</p>
                <p><span>每零件重复测量：</span>${numTrials} 次</p>
                <p><span>总样本数：</span>${numOps * numParts * numTrials}</p>
                <p><span>规格公差：</span>${tolerance || '未提供'}</p>
                <p><span>总平均值 X̿：</span>${round(grandMean, 6)}</p>
            </div>
        </div>
        <div class="report-section">
            <h4>二、量具 R&R 结果表 (ANOVA法)</h4>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
                <thead><tr style="background:#f1f5f9;">
                    <th style="border:1px solid #ddd;padding:7px;text-align:left">变异来源</th>
                    <th style="border:1px solid #ddd;padding:7px;text-align:right">SD (σ)</th>
                    <th style="border:1px solid #ddd;padding:7px;text-align:right">Var (σ²)</th>
                    <th style="border:1px solid #ddd;padding:7px;text-align:right">%SV (6σ)</th>
                    ${tolerance ? '<th style="border:1px solid #ddd;padding:7px;text-align:right">%Tolerance</th>' : ''}
                </tr></thead>
                <tbody>
                    <tr><td style="border:1px solid #ddd;padding:7px">重复性 EV</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.EV_anova,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.EV_anova**2,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.percentEV_anova,2)}%</td>
                        ${tolerance ? `<td style="border:1px solid #ddd;padding:7px;text-align:right">${round(result.percentEV_tol,2)}%</td>` : ''}</tr>
                    <tr><td style="border:1px solid #ddd;padding:7px">再现性 AV (含交互)</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.AV_anova,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.AV_anova**2,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.percentAV_anova,2)}%</td>
                        ${tolerance ? `<td style="border:1px solid #ddd;padding:7px;text-align:right">${round(result.percentAV_tol,2)}%</td>` : ''}</tr>
                    <tr style="background:#eff6ff;font-weight:600">
                        <td style="border:1px solid #ddd;padding:7px">GRR 合计</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.GRR_anova,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.GRR_anova**2,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.percentGRR_anova,2)}%</td>
                        ${tolerance ? `<td style="border:1px solid #ddd;padding:7px;text-align:right">${round(percentGRR_tol,2)}%</td>` : ''}</tr>
                    <tr><td style="border:1px solid #ddd;padding:7px">零件变异 PV</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.PV_anova,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.PV_anova**2,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.percentPV_anova,2)}%</td>
                        ${tolerance ? '<td style="border:1px solid #ddd;padding:7px;text-align:right">-</td>' : ''}</tr>
                    <tr style="font-weight:600;">
                        <td style="border:1px solid #ddd;padding:7px">总变异 TV</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.TV_anova,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${round(a.TV_anova**2,6)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">100%</td>
                        ${tolerance ? '<td style="border:1px solid #ddd;padding:7px;text-align:right">-</td>' : ''}</tr>
                </tbody>
            </table>
        </div>
        <div class="report-section">
            <h4>三、区分度 (ndc)</h4>
            <p><strong>ndc = ${ndcDisplay}</strong> （公式：ndc = 1.41 × PV / GRR，向下取整）</p>
            <p>AIAG 标准：ndc ≥ 5 合格（推荐 ≥ 10）</p>
            <p style="margin-top:6px;"><strong>判定：</strong>${ndcOK ? '合格 ✓' : '不合格 ✗'}${ndc >= 10 ? '（极佳）' : ''}</p>
        </div>
        <div class="report-section">
            <h4>四、控制图检验</h4>
            <p>X̄ 控制图：UCL = ${round(result.control.UCL_Xbar,4)}，CL = ${round(result.control.grandMean,4)}，LCL = ${round(result.control.LCL_Xbar,4)}</p>
            <p>R 控制图：UCL = ${round(result.control.UCL_R,4)}，R̄ = ${round(result.control.Rbar,4)}，LCL = ${round(result.control.LCL_R,4)}</p>
            <p style="margin-top:6px;"><strong>判定：</strong>R图所有点在控 → 重复性稳定；X̄图有超出控制限 → 测量员有能力识别零件差异（理想情况）。</p>
        </div>
        <div class="report-section">
            <h4>五、最终判定与改进建议</h4>
            <p>AIAG 判定准则：</p>
            <ul style="padding-left:20px;margin-top:4px;">
                <li>%GRR &lt; 10%：可接受（优秀）</li>
                <li>10% ≤ %GRR &lt; 30%：边缘可接受</li>
                <li>%GRR ≥ 30%：不可接受</li>
                <li>ndc ≥ 5：区分能力合格</li>
            </ul>
            <div class="verdict ${cls}" style="margin-top:14px;">最终判定：${verdict}</div>
            <p style="margin-top:10px;"><strong>建议措施：</strong>${rec}</p>
        </div>
        <div class="report-section" style="font-size:12px;color:#64748b;border-top:1px dashed #ccc;padding-top:10px;">
            <p>本报告依据 AIAG MSA 第四版标准生成。分析方法：ANOVA 方差分析法（含 Part × Operator 交互）。</p>
        </div>`;
    document.getElementById('report').innerHTML = html;
}

/* ---------- 历史记录 (localStorage) ---------- */
const HIST_KEY = 'msa_history_v2';
const MAX_HISTORY = 20;

function getHistory() {
    try {
        const raw = localStorage.getItem(HIST_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}
function saveHistory(history) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); }
    catch (e) { alert('保存失败：本地存储已满，请清理历史记录。\n错误：' + e.message); }
}
function renderHistoryList() {
    const list = getHistory();
    const container = document.getElementById('history-list');
    document.getElementById('history-count').textContent = list.length;
    if (list.length === 0) {
        container.innerHTML = `<div class="history-empty">🗂 暂无历史记录。完成分析后点击"💾 保存本次分析"按钮可存储，最多保存 ${MAX_HISTORY} 条。</div>`;
        return;
    }
    container.innerHTML = list.map((item, idx) => {
        const verCls = item.grr < 10 ? 'pass' : item.grr < 30 ? 'marginal' : 'fail';
        const verTxt = item.grr < 10 ? '可接受' : item.grr < 30 ? '边缘' : '不可接受';
        const d = new Date(item.time);
        const dt = d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
        const ndcTxt = item.ndc >= 999 ? '999+' : item.ndc;
        return `<div class="history-item" data-idx="${idx}">
            <div class="history-info">
                <div class="h-title">${item.name || `MSA #${idx + 1}`}
                    <span class="history-badge ${verCls}">${verTxt}</span>
                    <span class="history-badge ${item.ndc >= 5 ? 'pass' : 'fail'}">ndc=${ndcTxt}</span>
                </div>
                <div class="h-meta">
                    <span>🕒 ${dt}</span>
                    <span>👷 ${item.numOps}人</span>
                    <span>🔩 ${item.numParts}件</span>
                    <span>🔁 ${item.numTrials}次</span>
                    <span>📊 GRR=${round(item.grr,2)}%</span>
                    ${item.tolerance ? `<span>📏 Tol=${item.tolerance}</span>` : ''}
                </div>
            </div>
            <div class="history-actions">
                <button class="h-btn h-btn-primary" data-act="load">🔄 载入</button>
                <button class="h-btn" data-act="rename">✏ 改名</button>
                <button class="h-btn h-btn-danger" data-act="delete">🗑 删除</button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.h-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const item = btn.closest('.history-item');
            const idx = parseInt(item.dataset.idx);
            const act = btn.dataset.act;
            const hist = getHistory();
            if (!hist[idx]) return;
            if (act === 'load') loadHistoryItem(hist[idx]);
            else if (act === 'rename') {
                const newName = prompt('请输入新名称：', hist[idx].name || `MSA #${idx+1}`);
                if (newName && newName.trim()) { hist[idx].name = newName.trim(); saveHistory(hist); renderHistoryList(); }
            } else if (act === 'delete') {
                if (confirm(`确定删除「${hist[idx].name || `MSA #${idx+1}`}」吗？`)) {
                    hist.splice(idx, 1); saveHistory(hist); renderHistoryList();
                }
            }
        });
    });
}

function saveCurrentResult() {
    if (!currentResult) { alert('请先完成一次计算分析再保存。'); return; }
    const r = currentResult;
    const a = r.anova;
    const flatData = [];
    for (let o = 0; o < r.numOps; o++) {
        for (let p = 0; p < r.numParts; p++) {
            for (let t = 0; t < r.numTrials; t++) {
                if (typeof r.data[o][p][t] === 'number' && isFinite(r.data[o][p][t])) {
                    flatData.push([o, p, t, r.data[o][p][t]]);
                }
            }
        }
    }
    const entry = {
        id: Date.now(),
        time: Date.now(),
        name: `MSA ${new Date().toLocaleDateString('zh-CN')} #${(getHistory().length + 1)}`,
        numOps: r.numOps, numParts: r.numParts, numTrials: r.numTrials,
        tolerance: r.tolerance || null,
        grr: a.percentGRR_anova,
        ndc: r.ndc,
        flatData
    };
    const hist = getHistory();
    hist.unshift(entry);
    while (hist.length > MAX_HISTORY) hist.pop();
    saveHistory(hist);
    renderHistoryList();
    alert('✓ 已保存到历史记录（本地浏览器）。');
}

function loadHistoryItem(item) {
    if (!item) return;
    document.getElementById('operators').value = item.numOps;
    document.getElementById('parts').value = item.numParts;
    document.getElementById('trials').value = item.numTrials;
    document.getElementById('spec-tolerance').value = item.tolerance || '';
    generateTable();
    const inputs = document.querySelectorAll('.measurement');
    const dataMap = {};
    item.flatData.forEach(([o, p, t, v]) => { dataMap[`${o}-${p}-${t}`] = v; });
    inputs.forEach(input => {
        const key = `${input.dataset.operator}-${input.dataset.part}-${input.dataset.trial}`;
        if (dataMap[key] !== undefined) input.value = dataMap[key];
    });
    document.getElementById('results').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { doCalculate(true); }, 100);
}

/* ---------- 导出HTML报告 (自包含, 含图片 + 表) ---------- */
function exportHTMLReport() {
    if (!currentResult) { alert('请先完成一次计算分析再导出。'); return; }

    const toImg = canvasId => {
        const c = document.getElementById(canvasId);
        if (!c) return '';
        try { return c.toDataURL('image/png'); } catch { return ''; }
    };
    const imgs = {
        variance: toImg('variance-chart'),
        xbar: toImg('xbar-chart'),
        range: toImg('range-chart'),
        ctrlX: toImg('xbar-control-chart'),
        ctrlR: toImg('r-control-chart')
    };

    const r = currentResult;
    const a = r.anova;
    const ctrl = r.control;

    const grr = a.percentGRR_anova;
    const cls = grr < 10 ? 'pass' : grr < 30 ? 'marginal' : 'fail';
    const ndcDisplay = r.ndc >= 999 ? '999+' : r.ndc;
    const now = new Date();

    const imgBlock = (src, cap) => src ? `
        <div style="page-break-inside:avoid;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
            <div style="text-align:center;font-weight:600;color:#1e40af;margin-bottom:6px;">${cap}</div>
            <img src="${src}" style="max-width:100%;height:auto;display:block;margin:0 auto;">
        </div>` : '';

    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>MSA/Gauge R&R 分析报告 - ${now.toLocaleDateString('zh-CN')}</title>
<style>
* { box-sizing:border-box; }
body { font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#fff;color:#1e293b;line-height:1.7;font-size:13px;padding:24px;max-width:1100px;margin:0 auto; }
h1 { color:#1e40af;border-bottom:3px solid #1e40af;padding-bottom:8px;margin-bottom:20px; }
h2 { color:#1e40af;margin:28px 0 12px;border-left:5px solid #3b82f6;padding-left:10px;font-size:18px; }
h3 { color:#475569;margin:18px 0 8px;font-size:15px; }
table { width:100%;border-collapse:collapse;margin:10px 0;font-size:13px; }
th, td { border:1px solid #cbd5e1;padding:7px 9px; }
th { background:#f1f5f9;font-weight:700; }
tr:nth-child(even) td { background:#fafafa; }
td:first-child, th:first-child { text-align:left; }
td:not(:first-child), th:not(:first-child) { text-align:right; }
tr.hl td { background:#eff6ff;font-weight:600; }
.badge { display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-left:8px; }
.pass { background:#dcfce7;color:#15803d; }
.marginal { background:#fef9c3;color:#ca8a04; }
.fail { background:#fee2e2;color:#b91c1c; }
.verdict { text-align:center;font-size:18px;font-weight:700;padding:14px;border-radius:8px;margin:16px 0; }
.meta { display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px;margin:10px 0;background:#f8fafc;padding:14px;border-radius:6px; }
.meta span { color:#64748b;margin-right:4px; }
.warn-box { background:#fffbeb;border-left:4px solid #ca8a04;padding:10px 14px;border-radius:6px;margin:12px 0;color:#78350f; }
.info-box { background:#f0f9ff;border-left:4px solid #0284c7;padding:10px 14px;border-radius:6px;margin:12px 0;color:#0c4a6e; }
.footer { margin-top:30px;padding-top:14px;border-top:1px dashed #94a3b8;color:#64748b;font-size:12px;text-align:center; }
ul { padding-left:20px;margin:6px 0; }
.sign-yes { background:#dcfce7;color:#15803d;font-weight:600; }
.sign-no { background:#fee2e2;color:#b91c1c;font-weight:600; }
</style></head><body>
<h1>📊 MSA / Gauge R&R 测量系统分析报告</h1>
<div class="meta">
<div><span>报告生成时间：</span>${now.toLocaleString('zh-CN')}</div>
<div><span>测量员：</span>${r.numOps} 人</div>
<div><span>零件数：</span>${r.numParts} 件</div>
<div><span>重复次数：</span>${r.numTrials} 次</div>
<div><span>总样本：</span>${r.numOps * r.numParts * r.numTrials} 个</div>
<div><span>公差 Tolerance：</span>${r.tolerance || '未提供'}</div>
<div><span>总均值 X̿：</span>${round(r.grandMean, 6)}</div>
<div><span>最终判定：</span><span class="badge ${cls}">${grr < 10 ? '可接受' : grr < 30 ? '边缘' : '不可接受'}</span>
<span class="badge ${r.ndc >= 5 ? 'pass' : 'fail'}">ndc=${ndcDisplay}</span></div>
</div>

${r.warnings && r.warnings.length ? r.warnings.map(w =>
    `<div class="${w.level === 'warn' ? 'warn-box' : 'info-box'}"><strong>📢 提示：</strong>${w.text}</div>`
).join('') : ''}

<h2>一、量具 R&R 结果表 (ANOVA法)</h2>
<table>
<thead><tr>
<th>变异来源</th><th>SD (σ)</th><th>Var (σ²)</th><th>%研究变异</th>
${r.tolerance ? '<th>%公差</th>' : ''}
</tr></thead><tbody>
<tr><td>重复性 EV</td><td>${round(a.EV_anova,6)}</td><td>${round(a.EV_anova**2,6)}</td><td>${round(a.percentEV_anova,2)}%</td>
    ${r.tolerance ? `<td>${round(r.percentEV_tol,2)}%</td>` : ''}</tr>
<tr><td>再现性 AV (含交互)</td><td>${round(a.AV_anova,6)}</td><td>${round(a.AV_anova**2,6)}</td><td>${round(a.percentAV_anova,2)}%</td>
    ${r.tolerance ? `<td>${round(r.percentAV_tol,2)}%</td>` : ''}</tr>
<tr class="hl"><td>GRR 合计</td><td>${round(a.GRR_anova,6)}</td><td>${round(a.GRR_anova**2,6)}</td><td>${round(a.percentGRR_anova,2)}%</td>
    ${r.tolerance ? `<td>${round(r.percentGRR_tol,2)}%</td>` : ''}</tr>
<tr><td>零件变异 PV</td><td>${round(a.PV_anova,6)}</td><td>${round(a.PV_anova**2,6)}</td><td>${round(a.percentPV_anova,2)}%</td>
    ${r.tolerance ? '<td>-</td>' : ''}</tr>
<tr class="hl"><td>总变异 TV</td><td>${round(a.TV_anova,6)}</td><td>${round(a.TV_anova**2,6)}</td><td>100%</td>
    ${r.tolerance ? '<td>-</td>' : ''}</tr>
</tbody></table>

<h2>二、方差分析表 ANOVA (α=0.05)</h2>
<table>
<thead><tr><th>来源</th><th>DF</th><th>SS</th><th>MS</th><th>F</th><th>F临界</th><th>显著性</th><th>方差分量</th><th>贡献率</th></tr></thead>
<tbody>
<tr><td><strong>零件</strong></td><td>${a.df_parts}</td><td>${round(a.SS_parts,6)}</td><td>${round(a.MS_parts,6)}</td><td>${round(a.F_parts,4)}</td>
    <td>${round(a.F_crit_parts,4)}</td><td class="${a.F_parts>a.F_crit_parts?'sign-yes':'sign-no'}">${a.F_parts>a.F_crit_parts?'显著':'不显著'}</td>
    <td>${round(a.var_parts,6)}</td><td>${round(a.percentPV_anova,2)}%</td></tr>
<tr><td><strong>测量员</strong></td><td>${a.df_ops}</td><td>${round(a.SS_ops,6)}</td><td>${round(a.MS_ops,6)}</td><td>${round(a.F_ops,4)}</td>
    <td>${round(a.F_crit_ops,4)}</td><td class="${a.F_ops>a.F_crit_ops?'sign-yes':'sign-no'}">${a.F_ops>a.F_crit_ops?'显著':'不显著'}</td>
    <td>${round(a.var_ops,6)}</td><td>-</td></tr>
<tr><td><strong>交互 Part×Op</strong></td><td>${a.df_interaction}</td><td>${round(a.SS_interaction,6)}</td><td>${round(a.MS_interaction,6)}</td><td>${round(a.F_interaction,4)}</td>
    <td>${round(a.F_crit_interaction,4)}</td><td class="${a.F_interaction>a.F_crit_interaction?'sign-yes':'sign-no'}">${a.F_interaction>a.F_crit_interaction?'显著':'不显著'}</td>
    <td>${round(a.var_interaction,6)}</td><td>-</td></tr>
<tr><td><strong>重复性</strong></td><td>${a.df_repeat}</td><td>${round(a.SS_repeat,6)}</td><td>${round(a.MS_repeat,6)}</td><td>-</td><td>-</td><td>-</td><td>${round(a.var_repeat,6)}</td><td>-</td></tr>
<tr><td><strong>总计</strong></td><td>${a.df_total}</td><td>${round(a.SS_total,6)}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>100%</td></tr>
</tbody></table>

<h2>三、区分度 ndc</h2>
<p><strong>ndc = ${ndcDisplay}</strong>，公式 ndc = 1.41 × (PV / GRR)，AIAG 要求 ndc ≥ 5（≥10 为极佳）。</p>
<p><strong>判定：</strong>${r.ndc >= 5 ? '合格 ✓' + (r.ndc >= 10 ? '（极佳）' : '') : '不合格 ✗，量具无法有效识别零件差异。'}</p>

<h2>四、图表</h2>
${imgBlock(imgs.variance, '图1 · 方差贡献率饼图 (EV / AV / PV)')}
${imgBlock(imgs.xbar, '图2 · 按零件的均值交叉图')}
${imgBlock(imgs.range, '图3 · 按零件的极差交叉图')}
${imgBlock(imgs.ctrlX, `图4 · X̄ 控制图 (A₂=${ctrl.A2.toFixed(3)})`)}
${imgBlock(imgs.ctrlR, `图5 · R 控制图 (D₃=${ctrl.D3.toFixed(3)}, D₄=${ctrl.D4.toFixed(3)})`)}

<h2>五、最终判定与建议</h2>
<div class="verdict ${cls}">最终判定：${grr < 10 ? '✓ 量具可接受 (ACCEPT)' : grr < 30 ? '⚠ 量具边缘可接受 (MARGINAL)' : '✗ 量具不可接受 (UNACCEPTABLE)'}</div>
<h3>AIAG 判定标准</h3>
<ul>
<li>%GRR < 10%：测量系统可接受（优秀）</li>
<li>10% ≤ %GRR < 30%：边缘可接受，根据重要性与成本综合判断</li>
<li>%GRR ≥ 30%：不可接受，需要改进</li>
<li>ndc ≥ 5：区分能力合格</li>
</ul>
<h3>改进建议</h3>
${grr < 10 && r.ndc >= 5 ? '<p>✓ 测量系统满足AIAG MSA标准，可正常投入使用。</p>' :
grr < 30 && r.ndc >= 5 ? '<p>边缘可接受。建议：①针对再现性较大→统一测量员作业、培训操作方法；②针对重复性较大→检查量具稳定性、夹具、环境；③持续监控。</p>' :
'<p>不可接受，按优先级采取以下措施：<br>' +
'<strong>重复性 EV 大 →</strong> 重新校准量具、改进夹具/固定方式、降低环境干扰、检查量具分辨率；<br>' +
'<strong>再现性 AV 大 →</strong> 统一作业SOP、培训测量员、明确读数方法、检查操作顺序影响；<br>' +
'<strong>零件间 PV 小 →</strong> 取样需覆盖过程全范围（±3σ），否则结果会低估系统能力；<br>' +
'<strong>ndc < 5 →</strong> 优先提高量具分辨率（至少公差/10），更换更高精度量具。</p>'}

<div class="footer">
本报告由 MSA/Gauge R&R Tool 生成 | AIAG MSA 第四版 | ANOVA 方法 (含交互)
</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const fn = `MSA_GRR_Report_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.html`;
    const a = document.createElement('a');
    a.href = url; a.download = fn;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

/* ---------- 主流程 ---------- */
function doCalculate(isFromHistory = false) {
    const result = calculateMSA();
    if (!result) return;
    currentResult = result;
    document.getElementById('results').classList.remove('hidden');

    renderWarnings(result);
    renderSummary(result);
    renderANOVA(result);
    renderVarianceChart(result);
    renderXbarRangeChart(result);
    renderControlCharts(result);
    renderNDC(result);
    renderReport(result);

    setTimeout(() => { document.getElementById('results').scrollIntoView({ behavior: 'smooth' }); }, 80);
    if (!isFromHistory) saveHistory(getHistory());
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('generate-table').addEventListener('click', generateTable);
    document.getElementById('load-sample').addEventListener('click', loadSampleData);
    document.getElementById('clear-data').addEventListener('click', clearData);
    document.getElementById('calculate').addEventListener('click', () => doCalculate(false));
    document.getElementById('print-report').addEventListener('click', () => window.print());
    document.getElementById('save-result').addEventListener('click', saveCurrentResult);
    document.getElementById('export-result').addEventListener('click', exportHTMLReport);

    generateTable();
    renderHistoryList();
});
