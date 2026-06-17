/* =========================================================
   MSA / Gauge R&R Analysis - v3.1
   =========================================================
   统一判定逻辑：所有模块调用 getVerdict(r)
   50+ 零件 ndc 校准：采用 ANOVA-PV 与 标准差法融合
   批次对比：多选 2-3 条历史，指标卡+缩略图+跳转完整报告
   批次趋势：按时间追踪 %GRR、ndc、EV/AV/PV，标注变差节点
   INVALID 判定规则增强：PV/TV < 10% 也视为样本不适合分析
   CSV/Excel 导出：4 个 CSV 打包成 ZIP，无效样本统一 N/A
   ========================================================= */

/* ---------- 控制图常数 ---------- */
const D2_EXACT = {2:1.128,3:1.693,4:2.059,5:2.326,6:2.534,7:2.704,8:2.847,9:2.970,10:3.078};
const D3_EXACT = {2:0,3:0,4:0,5:0,6:0,7:0.076,8:0.136,9:0.184,10:0.223};
const D4_EXACT = {2:3.267,3:2.574,4:2.282,5:2.114,6:2.004,7:1.924,8:1.864,9:1.816,10:1.777};
const A2_EXACT = {2:1.880,3:1.023,4:0.729,5:0.577,6:0.483,7:0.419,8:0.373,9:0.337,10:0.308};

/* d2 连续近似，n>=11；n→∞ 时 d2→3.472 (Tippett极限) */
function d2Approx(n) {
    if (n <= 1) return 1;
    if (n <= 10) return D2_EXACT[n];
    return 3.47201 - 3.04159 / Math.sqrt(n) - 0.77242 / n + 0.31986 / (n * Math.sqrt(n));
}
function d3Approx(n) { if (n <= 10) return D3_EXACT[n]; return Math.max(0, 0.010 + 0.0011 * (n - 10)); }
function d4Approx(n) { if (n <= 10) return D4_EXACT[n]; return 2 - d3Approx(n); }
function a2Approx(n) { if (n <= 10) return A2_EXACT[n]; return 3 / (d2Approx(n) * Math.sqrt(n)); }

/* ---------- F分布临界值 (α=0.05) + 插值 ---------- */
const F05 = {
    1:  {1:161.4,2:18.51,3:10.13,4:7.71,5:6.61,10:4.96,20:4.35,50:4.03,100:3.94,inf:3.84},
    2:  {1:199.5,2:19.00,3:9.55,4:6.94,5:5.79,10:4.10,20:3.49,50:3.18,100:3.09,inf:3.00},
    3:  {1:215.7,2:19.16,3:9.28,4:6.59,5:5.41,10:3.71,20:3.10,50:2.79,100:2.70,inf:2.60},
    4:  {1:224.6,2:19.25,3:9.12,4:6.39,5:5.19,10:3.48,20:2.87,50:2.56,100:2.46,inf:2.37},
    5:  {1:230.2,2:19.30,3:9.01,4:6.26,5:5.05,10:3.33,20:2.71,50:2.40,100:2.31,inf:2.21},
    10: {1:241.9,2:19.40,3:8.79,4:5.96,5:4.74,10:2.98,20:2.35,50:2.03,100:1.94,inf:1.83},
    20: {1:248.0,2:19.45,3:8.66,4:5.80,5:4.56,10:2.77,20:2.12,50:1.78,100:1.68,inf:1.57}
};
function getF05(df1, df2) {
    if (df1 <= 0 || df2 <= 0) return 4;
    const pickRow = v => v <= 5 ? v : v <= 10 ? 10 : 20;
    const row = F05[pickRow(df1)] || F05[20];
    const keys = [1,2,3,4,5,10,20,50,100,Infinity];
    let i = 0; while (i < keys.length - 1 && keys[i] < df2) i++;
    if (i === 0) return row[keys[0].toString()];
    const k0 = keys[i - 1], k1 = keys[i];
    const v0 = row[k0 === Infinity ? 'inf' : k0.toString()];
    const v1 = row[k1 === Infinity ? 'inf' : k1.toString()];
    if (k1 === k0) return v1;
    if (k1 === Infinity) return v0 + (v1 - v0) * Math.min(1, (df2 - k0) / (100 - k0));
    const t = (df2 - k0) / (k1 - k0);
    return v0 + (v1 - v0) * t;
}

/* ---------- 工具函数 ---------- */
function mean(arr) {
    const v = (arr || []).filter(x => typeof x === 'number' && isFinite(x));
    if (!v.length) return 0;
    return v.reduce((s, x) => s + x, 0) / v.length;
}
function variance(arr, sample = true) {
    const v = (arr || []).filter(x => typeof x === 'number' && isFinite(x));
    if (v.length < 2) return 0;
    const m = mean(v);
    return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - (sample ? 1 : 0));
}
function stddev(arr, sample = true) { return Math.sqrt(variance(arr, sample)); }
function range(arr) {
    const v = (arr || []).filter(x => typeof x === 'number' && isFinite(x));
    if (!v.length) return 0;
    return Math.max(...v) - Math.min(...v);
}
function round(num, d = 4) {
    if (typeof num !== 'number' || !isFinite(num)) return num;
    const f = Math.pow(10, d); return Math.round(num * f) / f;
}
function safeDiv(a, b, fb = 0) {
    if (!isFinite(a) || !isFinite(b) || b === 0) return fb;
    return a / b;
}

/* =========================================================
   【判定统一入口】
   返回 { code: 'INVALID'|'PASS'|'MARGINAL'|'UNACCEPT',
           label, short, color, cls }
   所有渲染模块必须使用本函数，保证结论一致。
   ========================================================= */
const VERDICT = {
    INVALID:   { code:'INVALID',   label:'⚠ 无法判定（样本不适合分析）', short:'无法判定', cls:'invalid',  color:'#4338ca' },
    PASS:      { code:'PASS',      label:'✓ 量具可接受',                short:'可接受',   cls:'pass',     color:'#15803d' },
    MARGINAL:  { code:'MARGINAL',  label:'⚠ 量具边缘可接受',            short:'边缘',     cls:'marginal', color:'#ca8a04' },
    UNACCEPT:  { code:'UNACCEPT',  label:'✗ 量具不可接受',              short:'不可接受', cls:'fail',     color:'#b91c1c' }
};

function getVerdict(r) {
    if (!r) return VERDICT.INVALID;
    // 规则1：整体几乎无变异 → 样本不合适
    if ((r.totalStd || 0) < 1e-10) return VERDICT.INVALID;
    // 规则2：零件间几乎无差异 → PV≈0 会让 %GRR 虚高，结果不可信
    const PV = r.anova ? (r.anova.PV_final || r.anova.PV_anova || 0) : 0;
    if (PV < 1e-10) return VERDICT.INVALID;
    // 规则3：PV占TV比例低于10% → 零件间差异远小于测量系统波动，
    //        样本未能覆盖过程变异，判定为样本不适合分析（AIAG推荐）
    const TV = r.anova ? (r.anova.TV_final || r.anova.TV_anova || 0) : 0;
    if (TV > 0 && (PV * PV) / (TV * TV) < 0.10) return VERDICT.INVALID;
    const grr = r.anova ? r.anova.percentGRR_anova : 0;
    const ndc = r.ndc || 0;
    // 规则4：AIAG 分级
    if (grr < 10 && ndc >= 5) return VERDICT.PASS;
    if (grr < 30 && ndc >= 5) return VERDICT.MARGINAL;
    return VERDICT.UNACCEPT;
}

let charts = {};
let currentResult = null;
let historySelection = new Set();
let compareCharts = [];

/* =========================================================
   数据表 / 获取数据
   ========================================================= */
function generateTable() {
    const numOps = Math.min(10, Math.max(2, parseInt(document.getElementById('operators').value) || 3));
    const numParts = Math.min(100, Math.max(2, parseInt(document.getElementById('parts').value) || 10));
    const numTrials = Math.min(10, Math.max(2, parseInt(document.getElementById('trials').value) || 3));

    const c = document.getElementById('data-entry');
    let h = '<table><thead><tr>';
    h += '<th rowspan="2" style="min-width:60px;position:sticky;left:0;z-index:2;background:#f1f5f9;">零件</th>';
    for (let i = 0; i < numOps; i++) h += `<th class="operator-header" colspan="${numTrials}">测量员 ${String.fromCharCode(65 + i)}</th>`;
    h += '</tr><tr>';
    for (let i = 0; i < numOps; i++) for (let j = 0; j < numTrials; j++) h += `<th class="trial-header">第${j+1}次</th>`;
    h += '</tr></thead><tbody>';
    for (let p = 0; p < numParts; p++) {
        h += `<tr><td style="position:sticky;left:0;background:#fafafa;"><strong>${p+1}</strong></td>`;
        for (let o = 0; o < numOps; o++) for (let t = 0; t < numTrials; t++)
            h += `<td><input type="number" step="any" class="measurement" data-part="${p}" data-operator="${o}" data-trial="${t}"></td>`;
        h += '</tr>';
    }
    h += '</tbody></table>';
    c.innerHTML = h;
}

function getData() {
    const numOps = parseInt(document.getElementById('operators').value) || 3;
    const numParts = parseInt(document.getElementById('parts').value) || 10;
    const numTrials = parseInt(document.getElementById('trials').value) || 3;
    const data = [];
    for (let o = 0; o < numOps; o++) { data[o] = []; for (let p = 0; p < numParts; p++) data[o][p] = []; }
    let has = false, cnt = 0;
    document.querySelectorAll('.measurement').forEach(i => {
        const p = +i.dataset.part, o = +i.dataset.operator, t = +i.dataset.trial;
        const v = parseFloat(i.value);
        if (!isNaN(v) && isFinite(v)) { data[o][p][t] = v; has = true; cnt++; }
    });
    return { data, numOps, numParts, numTrials, hasData: has, count: cnt };
}

/* =========================================================
   三种预设场景数据生成
   ========================================================= */
function fillTable(numOps, numParts, numTrials, generatorFn) {
    document.getElementById('operators').value = numOps;
    document.getElementById('parts').value = numParts;
    document.getElementById('trials').value = numTrials;
    generateTable();
    document.querySelectorAll('.measurement').forEach(i => {
        const p = +i.dataset.part, o = +i.dataset.operator, t = +i.dataset.trial;
        i.value = generatorFn(o, p, t).toFixed(4);
    });
}

/* 场景1：正常/高零件差异 — 典型合格MSA */
function loadSampleHighVar() {
    document.getElementById('spec-tolerance').value = 0.5;
    const partTrue = [];
    for (let p = 0; p < 10; p++) partTrue[p] = 25 + (p - 4.5) * 0.05;  // 零件差异 ±0.225
    const opBias = [0, 0.006, -0.006];
    fillTable(3, 10, 3, (o, p, t) =>
        partTrue[p] + opBias[o] + (Math.random() - 0.5) * 0.010
    );
}

/* 场景2：低零件差异 — 所有零件真值接近，应判定 INVALID */
function loadSampleLowVar() {
    document.getElementById('spec-tolerance').value = 0.5;
    fillTable(3, 10, 3, (o, p, t) =>
        25.00 + (p - 4.5) * 0.002 + (Math.random() - 0.5) * 0.008
    );
}

/* 场景3：全相同数据 — 所有值一样，应判定 INVALID */
function loadSampleSame() {
    document.getElementById('spec-tolerance').value = 0.5;
    fillTable(3, 10, 3, (o, p, t) => 25.000);
}

function clearData() {
    document.querySelectorAll('.measurement').forEach(i => i.value = '');
    document.getElementById('results').classList.add('hidden');
    Object.values(charts).forEach(c => c && c.destroy && c.destroy());
    charts = {}; currentResult = null;
}

/* =========================================================
   【核心 MSA 计算】
   ========================================================= */
function calculateMSA() {
    const { data, numOps, numParts, numTrials, hasData, count } = getData();
    if (!hasData) { alert('请先输入测量数据！'); return null; }
    const totalExpected = numOps * numParts * numTrials;
    if (count < totalExpected * 0.6) {
        if (!confirm(`录入数据不足 ${count}/${totalExpected}，继续分析可能结果失真，是否继续？`)) return null;
    }

    // 1) 收集单元统计量
    const cellMeans = [], cellRanges = [];
    const allMeasurements = [];
    for (let o = 0; o < numOps; o++) {
        cellMeans[o] = []; cellRanges[o] = [];
        for (let p = 0; p < numParts; p++) {
            const m = data[o][p].filter(v => typeof v === 'number' && isFinite(v));
            cellMeans[o][p] = m.length ? mean(m) : NaN;
            cellRanges[o][p] = range(m);
            allMeasurements.push(...m);
        }
    }

    const grandMean = mean(allMeasurements);
    const totalStd = stddev(allMeasurements, true);
    const operatorMeans = [], operatorRanges = [];
    for (let o = 0; o < numOps; o++) {
        const vals = [], ranges = [];
        for (let p = 0; p < numParts; p++) {
            vals.push(...data[o][p].filter(v => typeof v === 'number' && isFinite(v)));
            if (!isNaN(cellRanges[o][p])) ranges.push(cellRanges[o][p]);
        }
        operatorMeans[o] = mean(vals);
        operatorRanges[o] = mean(ranges);
    }
    const partMeans = [];
    for (let p = 0; p < numParts; p++) {
        const vals = [];
        for (let o = 0; o < numOps; o++)
            vals.push(...data[o][p].filter(v => typeof v === 'number' && isFinite(v)));
        partMeans[p] = mean(vals);
    }

    const Rbar = mean(operatorRanges);
    const Xbardiff = range(operatorMeans);
    const Rp = range(partMeans);

    /* === 数据质量警告 === */
    const warnings = [];
    if (totalStd < 1e-10) {
        warnings.push({ level: 'warn', text: '<strong>所有测量值完全相同</strong>，总体标准差≈0。MSA要求样本覆盖过程变异范围（推荐 ±3σ），否则无法判定量具能力。' });
    }
    if (!isNaN(Rbar) && Rbar < 1e-12) {
        warnings.push({ level: 'info', text: '同一测量员多次测量极差均为0（重复性EV≈0）。若为复制粘贴数据，则无法体现真实重复性。' });
    }
    if (Rp < 1e-12 || stddev(partMeans) < 1e-10) {
        warnings.push({ level: 'warn', text: '<strong>零件间几乎无差异</strong>（PV≈0）。取样未覆盖过程范围会导致%GRR虚高、ndc偏低，<strong>本次结果判定为"无法判定"</strong>，请扩大零件取样范围后重做MSA。' });
    }
    if (count < totalExpected) {
        warnings.push({ level: 'info', text: `存在缺失数据（${count}/${totalExpected}），ANOVA为近似结果。建议补全。` });
    }
    if (grandMean !== 0 && Rbar / Math.abs(grandMean) > 0.5) {
        warnings.push({ level: 'info', text: '极差相对均值比例超过50%，请检查是否存在单位错误或粗大误差。' });
    }

    /* === 极差法 === */
    const d2_t = d2Approx(numTrials);
    const d2_o = d2Approx(numOps);
    const d2_p = d2Approx(Math.min(numParts, 100));

    const EV = Rbar < 1e-12 ? 0 : Rbar * d2_t;
    const AV_sq = Math.max(0, (Xbardiff * d2_o) ** 2 - (EV ** 2) / Math.max(1, numParts * numTrials));
    const AV = Math.sqrt(AV_sq);
    const GRR_range = Math.sqrt(EV * EV + AV * AV);
    const PV_range = Rp < 1e-12 ? 0 : Rp * d2_p;

    /* =========================================================
       【50+ 零件 ndc 校准】
       零件数很大时极差法只用到 max/min 两点，信息量不足。
       融合策略：
       - ANOVA 法给出的 PV_anova（期望均方推导，使用全部数据）作为主估计
       - 零件均值标准差法 SD(partMeans)*sqrt(2) 作为辅助估计
       - 最终 PV_final = 0.7·PV_anova + 0.3·PV_sd（加权融合，兼顾稳定与偏差）
       - ndc 基于融合后的 PV_final 与 GRR_anova 计算
       ========================================================= */
    const df_ops = Math.max(0, numOps - 1);
    const df_parts = Math.max(0, numParts - 1);
    const df_inter = Math.max(0, (numOps - 1) * (numParts - 1));
    const df_repeat = Math.max(1, count - numOps * numParts);

    let SS_ops = 0, SS_parts = 0, SS_inter = 0, SS_rep = 0;
    for (let o = 0; o < numOps; o++) SS_ops += numParts * numTrials * (operatorMeans[o] - grandMean) ** 2;
    for (let p = 0; p < numParts; p++) SS_parts += numOps * numTrials * (partMeans[p] - grandMean) ** 2;
    for (let o = 0; o < numOps; o++) for (let p = 0; p < numParts; p++)
        if (!isNaN(cellMeans[o][p]))
            SS_inter += numTrials * (cellMeans[o][p] - operatorMeans[o] - partMeans[p] + grandMean) ** 2;
    for (let o = 0; o < numOps; o++) for (let p = 0; p < numParts; p++) for (let t = 0; t < numTrials; t++) {
        const v = data[o][p][t];
        if (typeof v === 'number' && isFinite(v) && !isNaN(cellMeans[o][p]))
            SS_rep += (v - cellMeans[o][p]) ** 2;
    }

    const MS_ops   = df_ops   > 0 ? SS_ops   / df_ops   : 0;
    const MS_parts = df_parts > 0 ? SS_parts / df_parts : 0;
    const MS_inter = df_inter > 0 ? SS_inter / df_inter : 0;
    const MS_rep   = df_repeat > 0 ? SS_rep   / df_repeat : 1e-30;

    let F_ops = 0, F_parts = 0, F_inter = 0;
    if (MS_inter > 1e-20) { F_ops = MS_ops / MS_inter; F_parts = MS_parts / MS_inter; }
    else if (MS_rep > 0)  { F_ops = MS_ops / MS_rep;   F_parts = MS_parts / MS_rep; }
    if (MS_rep > 0) F_inter = MS_inter / MS_rep;

    const Fc_ops   = df_ops   > 0 && df_inter > 0 ? getF05(df_ops,   df_inter) : 4;
    const Fc_parts = df_parts > 0 && df_inter > 0 ? getF05(df_parts, df_inter) : 4;
    const Fc_inter = df_inter > 0 && df_repeat > 0? getF05(df_inter, df_repeat): 4;

    const var_rep = MS_rep;
    const var_inter = df_inter > 0 ? Math.max(0, (MS_inter - MS_rep) / numTrials) : 0;
    const var_ops   = (df_ops > 0 && df_parts > 0) ? Math.max(0, (MS_ops - MS_inter) / Math.max(1, numParts * numTrials)) : 0;
    const var_parts = (df_parts > 0 && numOps > 0) ? Math.max(0, (MS_parts - MS_inter) / Math.max(1, numOps * numTrials)) : 0;

    const EV_anova = Math.sqrt(var_rep);
    const AV_anova = Math.sqrt(var_ops + var_inter);
    const GRR_anova = Math.sqrt(EV_anova * EV_anova + AV_anova * AV_anova);
    const PV_anova = Math.sqrt(var_parts);

    /* --- PV 融合估计 --- */
    const PV_sd = stddev(partMeans, true) * Math.sqrt(2);   // 标准差法
    let PV_final;
    if (numParts >= 20) {
        PV_final = 0.7 * PV_anova + 0.3 * PV_sd;              // 大样本：融合
    } else if (numParts >= 8) {
        PV_final = 0.85 * PV_anova + 0.15 * PV_sd;             // 中样本：轻度融合
    } else {
        PV_final = PV_anova;                                    // 小样本：ANOVA 为主 (AIAG 方法)
    }
    // 极小值归 0 防误判
    if (PV_final < 1e-10) PV_final = 0;

    const TV_final = Math.sqrt(GRR_anova * GRR_anova + PV_final * PV_final);
    const percentGRR_final = safeDiv(GRR_anova, TV_final, 0) * 100;
    const percentEV_final  = safeDiv(EV_anova,  TV_final, 0) * 100;
    const percentAV_final  = safeDiv(AV_anova,  TV_final, 0) * 100;
    const percentPV_final  = safeDiv(PV_final,  TV_final, 0) * 100;

    /* %公差 */
    const tolerance = parseFloat(document.getElementById('spec-tolerance').value);
    let pctTolGRR = null, pctTolEV = null, pctTolAV = null;
    if (tolerance && tolerance > 0 && isFinite(tolerance)) {
        pctTolEV  = safeDiv(6 * EV_anova,  tolerance, 0) * 100;
        pctTolAV  = safeDiv(6 * AV_anova,  tolerance, 0) * 100;
        pctTolGRR = safeDiv(6 * GRR_anova, tolerance, 0) * 100;
    }

    /* ndc (使用融合后的 PV_final) */
    let ndc;
    if (totalStd < 1e-10 || PV_final < 1e-10) {
        ndc = 0;
    } else if (GRR_anova < 1e-12) {
        ndc = 999;
    } else {
        ndc = Math.floor(1.41 * (PV_final / GRR_anova));
    }

    /* 控制图 */
    const A2 = a2Approx(numTrials), D3 = d3Approx(numTrials), D4 = d4Approx(numTrials);
    const UCL_R = D4 * Rbar, LCL_R = D3 * Rbar;
    const UCL_X = grandMean + A2 * Rbar, LCL_X = grandMean - A2 * Rbar;

    const r = {
        data, numOps, numParts, numTrials,
        allMeasurements, grandMean, totalStd,
        operatorMeans, operatorRanges, partMeans, cellMeans, cellRanges,
        Rbar, Xbardiff, Rp,
        EV, AV, GRR: GRR_range, PV: PV_range,
        tolerance, warnings,
        ndc,
        percentEV_tol: pctTolEV, percentAV_tol: pctTolAV, percentGRR_tol: pctTolGRR,
        anova: {
            df_ops, df_parts, df_interaction: df_inter, df_repeat,
            SS_ops, SS_parts, SS_interaction: SS_inter, SS_repeat: SS_rep, SS_total: SS_ops + SS_parts + SS_inter + SS_rep,
            MS_ops, MS_parts, MS_interaction: MS_inter, MS_repeat: MS_rep,
            F_ops, F_parts, F_interaction: F_inter,
            F_crit_ops: Fc_ops, F_crit_parts: Fc_parts, F_crit_interaction: Fc_inter,
            var_repeat: var_rep, var_interaction: var_inter, var_ops, var_parts,
            EV_anova, AV_anova, GRR_anova, PV_anova,
            PV_final, TV_final,
            percentEV_anova: percentEV_final,
            percentAV_anova: percentAV_final,
            percentGRR_anova: percentGRR_final,
            percentPV_anova: percentPV_final
        },
        control: { UCL_R, LCL_R, Rbar, UCL_Xbar: UCL_X, LCL_Xbar: LCL_X, grandMean, A2, D3, D4 }
    };
    // 最后补充样本覆盖度警告（需依赖已计算的 PV_final/TV_final）
    if (TV_final > 0 && PV_final > 0 && (PV_final * PV_final) / (TV_final * TV_final) < 0.10) {
        const exist = warnings.some(w => /零件间/.test(w.text));
        if (!exist) {
            warnings.push({ level: 'warn', text: `<strong>零件差异覆盖不足</strong>（零件变异仅占总变异的 ${round(percentPV_final, 1)}%，低于 10%）。样本间差异远小于测量系统波动，<strong>本次结果判定为"无法判定"</strong>，建议扩大取样范围（覆盖过程 ±3σ）后重做 MSA。` });
        }
    }
    r.verdict = getVerdict(r);
    return r;
}

/* =========================================================
   渲染模块 — 全量使用 r.verdict，保证一致性
   ========================================================= */
function renderWarnings(r) {
    const el = document.getElementById('data-warning');
    if (!r.warnings || !r.warnings.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    const hasW = r.warnings.some(w => w.level === 'warn');
    el.className = 'data-warning' + (hasW ? ' warn' : '');
    el.innerHTML = '<strong>📢 数据质量提示：</strong><ul style="margin-top:6px;padding-left:22px;">' +
        r.warnings.map(w => `<li>${w.text}</li>`).join('') + '</ul>';
}

function renderSummary(r) {
    const a = r.anova, v = r.verdict;
    const clsGRR = v.code === 'INVALID' ? 'warn' :
                   (a.percentGRR_anova < 10 ? 'good' : a.percentGRR_anova < 30 ? 'warn' : 'bad');
    const ndcDisp = r.ndc >= 999 ? '999+' : r.ndc;
    const ndcSub  = v.code === 'INVALID' ? '— 无法判定 —' :
                    (r.ndc >= 10 ? '极佳 (≥10)' : r.ndc >= 5 ? '合格 (≥5)' : '不合格 (<5)');
    const ndcCls  = v.code === 'INVALID' ? 'warn' : (r.ndc >= 5 ? 'good' : 'bad');

    let html = `
        <div class="summary-item ${clsGRR}">
            <div class="label">GRR %研究变异</div>
            <div class="value">${v.code === 'INVALID' ? '—' : round(a.percentGRR_anova, 2) + '%'}</div>
            <div class="sub">${v.code === 'INVALID' ? v.short : (a.percentGRR_anova < 10 ? '优秀' : a.percentGRR_anova < 30 ? '边缘' : '不可接受')}</div>
        </div>
        <div class="summary-item">
            <div class="label">重复性 EV</div>
            <div class="value">${round(a.EV_anova, 4)}</div>
            <div class="sub">${round(a.percentEV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item">
            <div class="label">再现性 AV</div>
            <div class="value">${round(a.AV_anova, 4)}</div>
            <div class="sub">${round(a.percentAV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item">
            <div class="label">零件变异 PV${r.numParts >= 20 ? ' (融合)' : ''}</div>
            <div class="value">${round(a.PV_final, 4)}</div>
            <div class="sub">${round(a.percentPV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item ${ndcCls}">
            <div class="label">区分度 ndc</div>
            <div class="value">${v.code === 'INVALID' ? '—' : ndcDisp}</div>
            <div class="sub">${ndcSub}</div>
        </div>`;
    if (r.percentGRR_tol !== null) {
        const c = v.code === 'INVALID' ? 'warn' : (r.percentGRR_tol < 10 ? 'good' : r.percentGRR_tol < 30 ? 'warn' : 'bad');
        html += `<div class="summary-item ${c}">
            <div class="label">GRR %公差</div>
            <div class="value">${v.code === 'INVALID' ? '—' : round(r.percentGRR_tol, 2) + '%'}</div>
            <div class="sub">Tolerance=${r.tolerance}</div></div>`;
    }
    document.getElementById('summary').innerHTML = html;

    const d = document.getElementById('decision');
    d.className = `decision-box ${v.cls}`;
    if (v.code === 'INVALID') {
        d.textContent = v.label + ' — 样本整体无变异或零件差异过小，建议使用覆盖过程 ±3σ 范围的零件样本重新研究。';
    } else if (v.code === 'PASS') {
        d.textContent = v.label + ' — 测量系统满足AIAG标准（%GRR<10% 且 ndc≥5），可正常使用。';
    } else if (v.code === 'MARGINAL') {
        d.textContent = v.label + ' — 根据被测特性重要性与成本综合判断；建议针对重复性或再现性较大项持续改进。';
    } else {
        d.textContent = v.label + ' — 按优先级改进：校准量具→培训测量员→改进方法→更换量具。';
    }
}

function renderANOVA(r) {
    const a = r.anova, v = r.verdict;
    const sig = (F, Fc) => ({ cls: F > Fc ? 'significant' : 'not-significant', txt: F > Fc ? '显著' : '不显著' });
    const sp = sig(a.F_parts, a.F_crit_parts);
    const so = sig(a.F_ops, a.F_crit_ops);
    const si = sig(a.F_interaction, a.F_crit_interaction);
    const dash = v.code === 'INVALID' ? '<span class="invalid-flag">N/A</span>' : '';

    const cell = (val, d = 4, showDash = true) =>
        (showDash && v.code === 'INVALID') ? dash :
        (typeof val === 'number' ? round(val, d) : val);

    document.getElementById('anova-table').innerHTML = `<table>
        <thead><tr><th>变异来源</th><th>DF</th><th>SS</th><th>MS</th><th>F</th><th>F临界(α=0.05)</th><th>显著性</th><th>方差分量</th><th>贡献率</th></tr></thead>
        <tbody>
        <tr><td><strong>零件 Parts</strong></td>
            <td>${a.df_parts}</td><td>${cell(a.SS_parts, 6, false)}</td><td>${cell(a.MS_parts, 6, false)}</td>
            <td>${cell(a.F_parts, 4, false)}</td><td>${cell(a.F_crit_parts, 4, false)}</td>
            <td class="${sp.cls}">${sp.txt}</td><td>${cell(a.var_parts, 6)}</td><td>${cell(a.percentPV_anova, 2) + (v.code !== 'INVALID' ? '%' : '')}</td></tr>
        <tr><td><strong>测量员 Operators</strong></td>
            <td>${a.df_ops}</td><td>${cell(a.SS_ops, 6, false)}</td><td>${cell(a.MS_ops, 6, false)}</td>
            <td>${cell(a.F_ops, 4, false)}</td><td>${cell(a.F_crit_ops, 4, false)}</td>
            <td class="${so.cls}">${so.txt}</td><td>${cell(a.var_ops, 6, false)}</td><td>-</td></tr>
        <tr><td><strong>交互 Part × Op</strong></td>
            <td>${a.df_interaction}</td><td>${cell(a.SS_interaction, 6, false)}</td><td>${cell(a.MS_interaction, 6, false)}</td>
            <td>${cell(a.F_interaction, 4, false)}</td><td>${cell(a.F_crit_interaction, 4, false)}</td>
            <td class="${si.cls}">${si.txt}</td><td>${cell(a.var_interaction, 6, false)}</td><td>-</td></tr>
        <tr><td><strong>重复性 Repeatability</strong></td>
            <td>${a.df_repeat}</td><td>${cell(a.SS_repeat, 6, false)}</td><td>${cell(a.MS_repeat, 6, false)}</td>
            <td>-</td><td>-</td><td>-</td><td>${cell(a.var_repeat, 6)}</td><td>-</td></tr>
        <tr style="background:#f1f5f9;font-weight:600">
            <td><strong>总计</strong></td><td>${a.df_repeat + a.df_interaction + a.df_ops + a.df_parts}</td>
            <td>${cell(a.SS_total, 6, false)}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>100%</td></tr>
        <tr style="background:#eff6ff"><td colspan="7"><strong>GRR 合计</strong></td>
            <td>${cell(a.GRR_anova ** 2, 6)}</td><td>${cell(a.percentGRR_anova, 2) + (v.code !== 'INVALID' ? '%' : '')}</td></tr>
        <tr style="background:#eff6ff"><td colspan="7">　└ 重复性 EV</td>
            <td>${cell(a.EV_anova ** 2, 6)}</td><td>${cell(a.percentEV_anova, 2) + (v.code !== 'INVALID' ? '%' : '')}</td></tr>
        <tr style="background:#eff6ff"><td colspan="7">　└ 再现性 AV (含交互)</td>
            <td>${cell(a.AV_anova ** 2, 6)}</td><td>${cell(a.percentAV_anova, 2) + (v.code !== 'INVALID' ? '%' : '')}</td></tr>
        </tbody></table>`;
}

function renderVarianceChart(r) {
    const a = r.anova, ctx = document.getElementById('variance-chart').getContext('2d');
    if (charts.variance) charts.variance.destroy();
    const d = [a.EV_anova ** 2, a.AV_anova ** 2, a.PV_final ** 2];
    const total = d.reduce((s, v) => s + v, 0);
    const labels = r.verdict.code === 'INVALID'
        ? ['重复性 EV (参考)', '再现性 AV (参考)', '零件 PV (参考 — 样本无差异)']
        : [`重复性 EV ${round(safeDiv(d[0],total,0)*100,2)}%`,
           `再现性 AV ${round(safeDiv(d[1],total,0)*100,2)}%`,
           `零件 PV   ${round(safeDiv(d[2],total,0)*100,2)}%`];
    charts.variance = new Chart(ctx, {
        type: 'pie',
        data: { labels, datasets: [{ data: d, backgroundColor: ['#ef4444','#f59e0b','#10b981'], borderColor: '#fff', borderWidth: 3 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: r.verdict.code === 'INVALID', text: '⚠ 样本不适合分析，以下比例仅作参考', color: '#ca8a04', font: { weight: 'bold' } },
                legend: { position: 'bottom', labels: { font: { size: 13 }, padding: 15 } },
                tooltip: { callbacks: { label: c => `${c.label}: 方差=${c.raw.toFixed(6)} (${round(safeDiv(c.raw,total,0)*100,2)}%)` } }
            }
        }
    });
}

function renderXbarRangeChart(r) {
    const { numOps, numParts, cellMeans, cellRanges, partMeans } = r;
    const partLabels = Array.from({ length: numParts }, (_, i) => `P${i + 1}`);
    const colors = ['#3b82f6','#10b981','#ef4444','#8b5cf6','#f59e0b','#ec4899','#14b8a6','#6366f1','#84cc16','#f97316'];
    const pR = numParts > 30 ? 2 : (numParts > 15 ? 3 : 4);
    const mtL = numParts > 50 ? 25 : (numParts > 30 ? 20 : 15);

    const dsMean = [], dsRange = [];
    for (let o = 0; o < numOps; o++) {
        dsMean.push({
            label: `测量员 ${String.fromCharCode(65 + o)}`,
            data: cellMeans[o].map(v => isNaN(v) ? null : v),
            borderColor: colors[o % colors.length], tension: 0.2, pointRadius: pR, borderWidth: 2, spanGaps: true,
            backgroundColor: colors[o % colors.length] + '33'
        });
        dsRange.push({
            label: `测量员 ${String.fromCharCode(65 + o)}`,
            data: cellRanges[o], borderColor: colors[o % colors.length], tension: 0.2, pointRadius: pR, borderWidth: 2, spanGaps: true,
            backgroundColor: colors[o % colors.length] + '33'
        });
    }
    dsMean.push({
        label: '零件均值', data: partMeans, borderColor: '#1e293b', borderDash: [5, 5],
        pointRadius: pR - 1, borderWidth: 2, tension: 0.2, backgroundColor: 'transparent'
    });

    const mkOpt = (title, yLabel, beginZero) => ({
        responsive: true, maintainAspectRatio: false,
        plugins: { title: { display: true, text: title, font: { size: 14, weight: 'bold' }, padding: 10 }, legend: { position: 'bottom' } },
        scales: {
            y: { title: { display: true, text: yLabel }, beginAtZero: !!beginZero },
            x: { title: { display: true, text: '零件' }, ticks: { maxTicksLimit: mtL, maxRotation: 90 } }
        }
    });

    const ctx1 = document.getElementById('xbar-chart').getContext('2d');
    if (charts.xbar) charts.xbar.destroy();
    charts.xbar = new Chart(ctx1, { type: 'line', data: { labels: partLabels, datasets: dsMean }, options: mkOpt('按零件的均值交叉图', '测量值', false) });

    const ctx2 = document.getElementById('range-chart').getContext('2d');
    if (charts.range) charts.range.destroy();
    charts.range = new Chart(ctx2, { type: 'line', data: { labels: partLabels, datasets: dsRange }, options: mkOpt('按零件的极差交叉图', '极差', true) });
}

function renderControlCharts(r) {
    const { numOps, numParts, numTrials, cellMeans, cellRanges } = r;
    const c = r.control;
    const xLabels = [], xData = [], rData = [];
    for (let p = 0; p < numParts; p++) for (let o = 0; o < numOps; o++) {
        xLabels.push(`P${p+1}${String.fromCharCode(65+o)}`);
        xData.push(isNaN(cellMeans[o][p]) ? null : cellMeans[o][p]);
        rData.push(cellRanges[o][p]);
    }
    const N = xLabels.length;
    const ps = N > 150 ? 2 : (N > 80 ? 3 : 5);
    const showL = N <= 80;

    const mkDS = (data, color, ucl, cl, lcl) => ([
        {
            label: '实测', data, borderColor: color, backgroundColor: color + '33',
            pointRadius: ps, borderWidth: 2, tension: 0.1, spanGaps: true,
            pointBackgroundColor: ctx => { const v = ctx.raw; if (v == null) return color; return (v > ucl || v < lcl) ? '#ef4444' : color; }
        },
        { label: `UCL=${round(ucl,4)}`, data: Array(N).fill(ucl), borderColor: '#ef4444', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 },
        { label: `CL=${round(cl,4)}`,  data: Array(N).fill(cl),  borderColor: '#1e293b', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5 },
        { label: `LCL=${round(lcl,4)}`, data: Array(N).fill(lcl), borderColor: '#ef4444', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 }
    ]);

    const mkOpt = (title, yLabel, beginZero) => ({
        responsive: true, maintainAspectRatio: false,
        plugins: {
            title: { display: true, text: title, font: { size: 14, weight: 'bold' }, padding: 10 },
            legend: { position: 'bottom', labels: { font: { size: 11 } } }
        },
        scales: {
            y: { title: { display: true, text: yLabel }, beginAtZero: !!beginZero },
            x: { ticks: { display: showL, maxRotation: 90, font: { size: 9 } }, title: { display: true, text: '样本 (零件-测量员)' } }
        }
    });

    const c1 = document.getElementById('xbar-control-chart').getContext('2d');
    if (charts.ctrlXbar) charts.ctrlXbar.destroy();
    charts.ctrlXbar = new Chart(c1, { type: 'line', data: { labels: xLabels, datasets: mkDS(xData, '#3b82f6', c.UCL_Xbar, c.grandMean, c.LCL_Xbar) }, options: mkOpt(`X̄ 控制图 (n=${numTrials}, A₂=${c.A2.toFixed(3)})`, '均值', false) });

    const c2 = document.getElementById('r-control-chart').getContext('2d');
    if (charts.ctrlR) charts.ctrlR.destroy();
    charts.ctrlR = new Chart(c2, { type: 'line', data: { labels: xLabels, datasets: mkDS(rData, '#10b981', c.UCL_R, c.Rbar, c.LCL_R) }, options: mkOpt(`R 控制图 (n=${numTrials}, D₃=${c.D3.toFixed(3)}, D₄=${c.D4.toFixed(3)})`, '极差', true) });
}

function renderNDC(r) {
    const v = r.verdict;
    const el = document.getElementById('ndc-result');
    if (v.code === 'INVALID') {
        el.className = 'ndc-result warn';
        el.innerHTML = `
            <div class="ndc-label">可识别的产品分类数 ndc</div>
            <div class="ndc-value" style="color:#ca8a04;">—</div>
            <div class="ndc-label">AIAG 标准 ndc ≥ 5</div>
            <div class="ndc-message" style="background:#fffbeb;color:#78350f;">
                ⚠ 样本无法用于判定区分度。<br>
                当所有测量值几乎相同或零件真值无差异时，ndc 计算失去意义。<br>
                <strong>请重新选取覆盖过程 ±3σ 变异范围的零件样本</strong>后再进行 MSA 研究。
            </div>`;
        return;
    }
    const ok = r.ndc >= 5, disp = r.ndc >= 999 ? '999+' : r.ndc, cls = ok ? 'good' : 'bad';
    el.className = `ndc-result ${cls}`;
    el.innerHTML = `
        <div class="ndc-label">可识别的产品分类数 ndc = 1.41 × PV / GRR${r.numParts >= 20 ? '（PV采用融合估计）' : ''}</div>
        <div class="ndc-value">${disp}</div>
        <div class="ndc-label">AIAG：ndc ≥ 5 合格；≥ 10 极佳</div>
        <div class="ndc-message">${ok ? '✓ 量具区分能力合格，能有效识别产品间差异。' : '⚠ 量具区分能力不足，无法有效划分产品等级，请提高量具分辨率或改进测量系统。'}</div>`;
}

function renderReport(r) {
    const a = r.anova, v = r.verdict;
    const now = new Date(), dt = now.toLocaleString('zh-CN');
    const ndcDisp = v.code === 'INVALID' ? 'N/A' : (r.ndc >= 999 ? '999+' : r.ndc);
    const grrPct = v.code === 'INVALID' ? 'N/A' : round(a.percentGRR_anova, 2) + '%';
    const na = v.code === 'INVALID';

    const valPct = x => na ? 'N/A' : round(x, 2) + '%';
    const val = x => na ? 'N/A' : round(x, 6);

    const invalidBox = v.code === 'INVALID'
        ? `<div class="warn-box" style="background:#fffbeb;border-left:4px solid #ca8a04;padding:10px 14px;border-radius:6px;color:#78350f;margin:12px 0;">
             <strong>⚠ 数据质量问题导致"无法判定"</strong><br>
             ${r.warnings ? r.warnings.map(w => '• ' + w.text).join('<br>') : ''}
           </div>` : '';

    let verTxt, rec;
    if (v.code === 'INVALID') {
        verTxt = '无法判定（样本不适合分析）';
        rec = '请重新组织 MSA：选取覆盖过程 ±3σ 变异范围的 10+ 个零件样本，由 2-3 名测量员每人对每个零件重复测量 2-3 次，再重新分析。';
    } else if (v.code === 'PASS') {
        verTxt = '✓ 量具可接受 (ACCEPT)';
        rec = '测量系统满足 AIAG MSA 第四版标准要求，可正常投入使用。';
    } else if (v.code === 'MARGINAL') {
        verTxt = '⚠ 量具边缘可接受 (MARGINAL)';
        rec = '根据测量特性重要性及测量成本综合判断；建议对再现性/重复性较大的项目持续改进。';
    } else {
        verTxt = '✗ 量具不可接受 (UNACCEPTABLE)';
        rec = '按优先级改进：①重新校准/检定；②统一作业SOP、培训测量员；③检查夹具、环境、方法；④必要时更换更高精度量具。';
    }

    document.getElementById('report').innerHTML = `
        <div class="report-section">
            <h4>一、研究信息</h4>
            <div class="report-meta">
                <p><span>报告时间：</span>${dt}</p>
                <p><span>测量员：</span>${r.numOps} 人</p>
                <p><span>零件：</span>${r.numParts} 件</p>
                <p><span>重复测量：</span>${r.numTrials} 次</p>
                <p><span>总样本：</span>${r.numOps * r.numParts * r.numTrials}</p>
                <p><span>规格公差：</span>${r.tolerance || '未提供'}</p>
                <p><span>总均值 X̿：</span>${round(r.grandMean, 6)}</p>
                <p><span>总体标准差：</span>${round(r.totalStd, 6)}</p>
            </div>
            ${invalidBox}
        </div>
        <div class="report-section">
            <h4>二、量具 R&R 结果表 (ANOVA法)</h4>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
                <thead><tr style="background:#f1f5f9;">
                    <th style="border:1px solid #ddd;padding:7px;text-align:left">变异来源</th>
                    <th style="border:1px solid #ddd;padding:7px;text-align:right">SD (σ)</th>
                    <th style="border:1px solid #ddd;padding:7px;text-align:right">Var (σ²)</th>
                    <th style="border:1px solid #ddd;padding:7px;text-align:right">%研究变异</th>
                    ${r.tolerance ? '<th style="border:1px solid #ddd;padding:7px;text-align:right">%公差</th>' : ''}
                </tr></thead>
                <tbody>
                    <tr><td style="border:1px solid #ddd;padding:7px">重复性 EV</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.EV_anova)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.EV_anova ** 2)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${valPct(a.percentEV_anova)}</td>
                        ${r.tolerance ? `<td style="border:1px solid #ddd;padding:7px;text-align:right">${valPct(r.percentEV_tol)}</td>` : ''}</tr>
                    <tr><td style="border:1px solid #ddd;padding:7px">再现性 AV (含交互)</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.AV_anova)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.AV_anova ** 2)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${valPct(a.percentAV_anova)}</td>
                        ${r.tolerance ? `<td style="border:1px solid #ddd;padding:7px;text-align:right">${valPct(r.percentAV_tol)}</td>` : ''}</tr>
                    <tr style="background:#eff6ff;font-weight:600">
                        <td style="border:1px solid #ddd;padding:7px">GRR 合计</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.GRR_anova)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.GRR_anova ** 2)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${grrPct}</td>
                        ${r.tolerance ? `<td style="border:1px solid #ddd;padding:7px;text-align:right">${valPct(r.percentGRR_tol)}</td>` : ''}</tr>
                    <tr><td style="border:1px solid #ddd;padding:7px">零件变异 PV${r.numParts >= 20 ? ' (融合估计)' : ''}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.PV_final)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.PV_final ** 2)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${valPct(a.percentPV_anova)}</td>
                        ${r.tolerance ? '<td style="border:1px solid #ddd;padding:7px;text-align:right">-</td>' : ''}</tr>
                    <tr style="font-weight:600">
                        <td style="border:1px solid #ddd;padding:7px">总变异 TV</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.TV_final)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${val(a.TV_final ** 2)}</td>
                        <td style="border:1px solid #ddd;padding:7px;text-align:right">${na ? 'N/A' : '100%'}</td>
                        ${r.tolerance ? '<td style="border:1px solid #ddd;padding:7px;text-align:right">-</td>' : ''}</tr>
                </tbody>
            </table>
        </div>
        <div class="report-section">
            <h4>三、区分度 ndc</h4>
            <p><strong>ndc = ${ndcDisp}</strong>（公式 ndc = 1.41 × PV / GRR，向下取整）</p>
            <p>AIAG 要求：ndc ≥ 5 合格（推荐 ≥ 10）</p>
            <p style="margin-top:6px;"><strong>判定：</strong>${v.code === 'INVALID' ? '无法判定（样本不适合）' : (r.ndc >= 5 ? '合格 ✓' + (r.ndc >= 10 ? '（极佳）' : '') : '不合格 ✗')}</p>
        </div>
        <div class="report-section">
            <h4>四、控制图检验</h4>
            <p>X̄：UCL = ${round(r.control.UCL_Xbar, 4)}，CL = ${round(r.control.grandMean, 4)}，LCL = ${round(r.control.LCL_Xbar, 4)}</p>
            <p>R：UCL = ${round(r.control.UCL_R, 4)}，R̄ = ${round(r.control.Rbar, 4)}，LCL = ${round(r.control.LCL_R, 4)}</p>
            <p style="margin-top:6px;"><strong>判定要点：</strong>R 图所有点在控 → 重复性稳定；X̄ 图大量点出界 → 测量员能识别零件差异（理想状态）。</p>
        </div>
        <div class="report-section">
            <h4>五、最终判定与建议</h4>
            <p>AIAG 判定准则：</p>
            <ul style="padding-left:20px;margin-top:4px;">
                <li>%GRR &lt; 10%：可接受（优秀）</li>
                <li>10% ≤ %GRR &lt; 30%：边缘可接受</li>
                <li>%GRR ≥ 30%：不可接受</li>
                <li>ndc ≥ 5：区分能力合格</li>
                <li style="color:#4338ca;"><strong>样本无变异或零件差异极小 → 无法判定，需重做 MSA</strong></li>
            </ul>
            <div class="verdict ${v.cls}" style="margin-top:14px;">最终判定：${verTxt}</div>
            <p style="margin-top:10px;"><strong>建议措施：</strong>${rec}</p>
        </div>
        <div class="report-section" style="font-size:12px;color:#64748b;border-top:1px dashed #ccc;padding-top:10px;">
            本报告依据 AIAG MSA 第四版标准生成。${r.numParts >= 20 ? '零件数 ≥ 20，PV 采用 ANOVA 与标准差法加权融合估计以提高稳健性。' : ''}
        </div>`;
}

/* =========================================================
   历史记录 (localStorage, 最多 20 条)
   ========================================================= */
const HIST_KEY = 'msa_history_v3';
const MAX_HISTORY = 20;

function getHistory() {
    try {
        const r = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
        return Array.isArray(r) ? r : [];
    } catch { return []; }
}
function setHistory(list) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); }
    catch (e) { alert('保存失败：' + e.message); }
}

/* 根据 flatData 恢复 r.verdict / r.anova 关键指标（用于历史列表展示） */
function hydrateHistoryItem(h) {
    const data = [];
    for (let o = 0; o < h.numOps; o++) { data[o] = []; for (let p = 0; p < h.numParts; p++) data[o][p] = []; }
    h.flatData.forEach(([o, p, t, v]) => { if (data[o]) data[o][p][t] = v; });

    const cellMeans = [], cellRanges = [], all = [], operatorMeans = [], operatorRanges = [], partMeans = [];
    for (let o = 0; o < h.numOps; o++) {
        cellMeans[o] = []; cellRanges[o] = [];
        const oVals = [], oRanges = [];
        for (let p = 0; p < h.numParts; p++) {
            const m = data[o][p].filter(v => typeof v === 'number' && isFinite(v));
            cellMeans[o][p] = m.length ? mean(m) : NaN;
            cellRanges[o][p] = range(m);
            oVals.push(...m); if (m.length) oRanges.push(cellRanges[o][p]);
            all.push(...m);
        }
        operatorMeans[o] = mean(oVals);
        operatorRanges[o] = mean(oRanges);
    }
    for (let p = 0; p < h.numParts; p++) {
        const pVals = [];
        for (let o = 0; o < h.numOps; o++) pVals.push(...data[o][p].filter(v => typeof v === 'number' && isFinite(v)));
        partMeans[p] = mean(pVals);
    }
    const grandMean = mean(all);
    const totalStd = stddev(all, true);
    const Rbar = mean(operatorRanges);
    const d2_t = d2Approx(h.numTrials);
    const d2_p = d2Approx(Math.min(h.numParts, 100));
    const Xbardiff = range(operatorMeans);
    const d2_o = d2Approx(h.numOps);
    const EV = (Rbar || 0) * d2_t;
    const AV_sq = Math.max(0, (Xbardiff * d2_o) ** 2 - EV * EV / Math.max(1, h.numParts * h.numTrials));
    const AV = Math.sqrt(AV_sq);

    const df_ops = h.numOps - 1, df_parts = h.numParts - 1;
    const df_inter = (h.numOps - 1) * (h.numParts - 1);
    const df_rep = Math.max(1, h.flatData.length - h.numOps * h.numParts);
    let SS_ops = 0, SS_parts = 0, SS_inter = 0, SS_rep = 0;
    for (let o = 0; o < h.numOps; o++) SS_ops += h.numParts * h.numTrials * (operatorMeans[o] - grandMean) ** 2;
    for (let p = 0; p < h.numParts; p++) SS_parts += h.numOps * h.numTrials * (partMeans[p] - grandMean) ** 2;
    for (let o = 0; o < h.numOps; o++) for (let p = 0; p < h.numParts; p++)
        if (!isNaN(cellMeans[o][p])) SS_inter += h.numTrials * (cellMeans[o][p] - operatorMeans[o] - partMeans[p] + grandMean) ** 2;
    for (let o = 0; o < h.numOps; o++) for (let p = 0; p < h.numParts; p++) for (let t = 0; t < h.numTrials; t++) {
        const v = data[o][p][t];
        if (typeof v === 'number' && isFinite(v) && !isNaN(cellMeans[o][p])) SS_rep += (v - cellMeans[o][p]) ** 2;
    }
    const MS_ops = df_ops > 0 ? SS_ops / df_ops : 0;
    const MS_parts = df_parts > 0 ? SS_parts / df_parts : 0;
    const MS_inter = df_inter > 0 ? SS_inter / df_inter : 0;
    const MS_rep = df_rep > 0 ? SS_rep / df_rep : 1e-30;
    const var_rep = MS_rep;
    const var_inter = df_inter > 0 ? Math.max(0, (MS_inter - MS_rep) / h.numTrials) : 0;
    const var_ops = (df_ops > 0 && df_parts > 0) ? Math.max(0, (MS_ops - MS_inter) / (h.numParts * h.numTrials)) : 0;
    const var_parts = (df_parts > 0 && h.numOps > 0) ? Math.max(0, (MS_parts - MS_inter) / (h.numOps * h.numTrials)) : 0;
    const EV_anova = Math.sqrt(var_rep);
    const AV_anova = Math.sqrt(var_ops + var_inter);
    const GRR_anova = Math.sqrt(EV_anova ** 2 + AV_anova ** 2);
    const PV_anova = Math.sqrt(var_parts);
    const PV_sd = stddev(partMeans, true) * Math.sqrt(2);
    let PV_final;
    if (h.numParts >= 20) PV_final = 0.7 * PV_anova + 0.3 * PV_sd;
    else if (h.numParts >= 8) PV_final = 0.85 * PV_anova + 0.15 * PV_sd;
    else PV_final = PV_anova;
    if (PV_final < 1e-10) PV_final = 0;
    const TV_final = Math.sqrt(GRR_anova ** 2 + PV_final ** 2);
    const percentGRR_final = safeDiv(GRR_anova, TV_final, 0) * 100;
    const percentEV_final = safeDiv(EV_anova, TV_final, 0) * 100;
    const percentAV_final = safeDiv(AV_anova, TV_final, 0) * 100;
    const percentPV_final = safeDiv(PV_final, TV_final, 0) * 100;
    let ndc;
    if (totalStd < 1e-10 || PV_final < 1e-10) ndc = 0;
    else if (GRR_anova < 1e-12) ndc = 999;
    else ndc = Math.floor(1.41 * PV_final / GRR_anova);

    const pctTolGRR = h.tolerance ? safeDiv(6 * GRR_anova, h.tolerance, 0) * 100 : null;

    const r = {
        numOps: h.numOps, numParts: h.numParts, numTrials: h.numTrials,
        totalStd, ndc, tolerance: h.tolerance,
        percentGRR_tol: pctTolGRR,
        anova: {
            EV_anova, AV_anova, GRR_anova, PV_anova, PV_final, TV_final,
            percentEV_anova: percentEV_final,
            percentAV_anova: percentAV_final,
            percentGRR_anova: percentGRR_final,
            percentPV_anova: percentPV_final
        },
        operatorMeans, partMeans, cellMeans
    };
    r.verdict = getVerdict(r);
    return r;
}

function renderHistoryList() {
    const list = getHistory();
    document.getElementById('history-count').textContent = list.length;
    document.getElementById('sel-count').textContent = historySelection.size;
    document.getElementById('compare-history').disabled = historySelection.size < 2 || historySelection.size > 3;
    document.getElementById('clear-selection').disabled = historySelection.size === 0;
    const c = document.getElementById('history-list');
    if (list.length === 0) {
        c.innerHTML = `<div class="history-empty">🗂 暂无历史记录。完成分析后点击"💾 保存本次分析"按钮可存储。</div>`;
        return;
    }
    c.innerHTML = list.map((h, idx) => {
        const r = hydrateHistoryItem(h);
        const v = r.verdict;
        const d = new Date(h.time);
        const dt = d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const ndcTxt = v.code === 'INVALID' ? 'N/A' : (r.ndc >= 999 ? '999+' : r.ndc);
        const grrTxt = v.code === 'INVALID' ? 'N/A' : round(r.anova.percentGRR_anova, 2) + '%';
        const sel = historySelection.has(h.id) ? 'selected' : '';
        const chk = historySelection.has(h.id) ? 'checked' : '';
        return `<div class="history-item ${sel}" data-id="${h.id}">
            <input type="checkbox" data-id="${h.id}" ${chk} title="勾选后参与批次对比">
            <div class="history-info">
                <div class="h-title">${h.name || `MSA #${idx + 1}`}
                    <span class="history-badge ${v.cls}">${v.short}</span>
                    <span class="history-badge ${r.ndc >= 5 ? 'pass' : 'fail'}">ndc=${ndcTxt}</span>
                </div>
                <div class="h-meta">
                    <span>🕒 ${dt}</span>
                    <span>👷 ${h.numOps}人</span>
                    <span>🔩 ${h.numParts}件</span>
                    <span>🔁 ${h.numTrials}次</span>
                    <span>📊 GRR=${grrTxt}</span>
                    ${h.tolerance ? `<span>📏 Tol=${h.tolerance}</span>` : ''}
                </div>
            </div>
            <div class="history-actions">
                <button class="h-btn h-btn-primary" data-act="load">🔄 载入</button>
                <button class="h-btn" data-act="rename">✏ 改名</button>
                <button class="h-btn h-btn-danger" data-act="delete">🗑</button>
            </div>
        </div>`;
    }).join('');

    c.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = +cb.dataset.id;
            if (cb.checked) {
                if (historySelection.size >= 3) {
                    cb.checked = false;
                    alert('最多选择 3 条进行批次对比。');
                    return;
                }
                historySelection.add(id);
            } else {
                historySelection.delete(id);
            }
            renderHistoryList();
        });
    });
    c.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', e => {
            e.stopPropagation();
            const id = +b.closest('.history-item').dataset.id;
            const list = getHistory();
            const idx = list.findIndex(x => x.id === id);
            if (idx < 0) return;
            const act = b.dataset.act;
            if (act === 'load') {
                loadHistoryItem(list[idx]);
            } else if (act === 'rename') {
                const nm = prompt('请输入新名称：', list[idx].name || '');
                if (nm && nm.trim()) { list[idx].name = nm.trim(); setHistory(list); renderHistoryList(); }
            } else if (act === 'delete') {
                if (confirm(`删除「${list[idx].name || '该记录'}」？`)) {
                    list.splice(idx, 1); historySelection.delete(id);
                    setHistory(list); renderHistoryList();
                }
            }
        });
    });
}

function saveCurrentResult() {
    if (!currentResult) { alert('请先完成一次计算分析再保存。'); return; }
    const r = currentResult;
    const flatData = [];
    for (let o = 0; o < r.numOps; o++) for (let p = 0; p < r.numParts; p++) for (let t = 0; t < r.numTrials; t++) {
        const v = r.data[o][p][t];
        if (typeof v === 'number' && isFinite(v)) flatData.push([o, p, t, v]);
    }
    const hist = getHistory();
    const d = new Date();
    const entry = {
        id: Date.now(), time: Date.now(),
        name: `MSA ${d.toLocaleDateString('zh-CN')} #${hist.length + 1}`,
        numOps: r.numOps, numParts: r.numParts, numTrials: r.numTrials,
        tolerance: r.tolerance || null, flatData
    };
    hist.unshift(entry);
    while (hist.length > MAX_HISTORY) hist.pop();
    setHistory(hist);
    renderHistoryList();
    try { renderTrendView(); } catch (_) {}
    alert('✓ 已保存到历史记录（本地浏览器）。');
}

function loadHistoryItem(h) {
    document.getElementById('operators').value = h.numOps;
    document.getElementById('parts').value = h.numParts;
    document.getElementById('trials').value = h.numTrials;
    document.getElementById('spec-tolerance').value = h.tolerance || '';
    generateTable();
    const mp = {}; h.flatData.forEach(([o, p, t, v]) => { mp[`${o}-${p}-${t}`] = v; });
    document.querySelectorAll('.measurement').forEach(i => {
        const k = `${i.dataset.operator}-${i.dataset.part}-${i.dataset.trial}`;
        if (mp[k] !== undefined) i.value = mp[k];
    });
    document.getElementById('results').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => doCalculate(), 120);
}

/* =========================================================
   批次对比视图
   ========================================================= */
function renderCompareView() {
    compareCharts.forEach(c => c && c.destroy && c.destroy());
    compareCharts = [];
    const ids = Array.from(historySelection);
    if (ids.length < 2 || ids.length > 3) {
        document.getElementById('compare-panel').classList.add('hidden');
        return;
    }
    const list = getHistory().filter(h => ids.includes(h.id));
    if (list.length < 2) { document.getElementById('compare-panel').classList.add('hidden'); return; }

    document.getElementById('compare-panel').classList.remove('hidden');
    document.getElementById('compare-badge').textContent = `${list.length} 个批次`;
    document.getElementById('compare-panel').scrollIntoView({ behavior: 'smooth' });

    const items = list.map(h => ({ hist: h, r: hydrateHistoryItem(h) }));

    // 标记最佳/最差（只对有效样本比较GRR；无效样本排最后）
    const validIdx = items.map((it, i) => it.r.verdict.code !== 'INVALID' ? i : -1).filter(i => i >= 0);
    let bestIdx = -1, worstIdx = -1;
    if (validIdx.length >= 2) {
        bestIdx = validIdx.reduce((a, b) => items[a].r.anova.percentGRR_anova < items[b].r.anova.percentGRR_anova ? a : b);
        worstIdx = validIdx.reduce((a, b) => items[a].r.anova.percentGRR_anova > items[b].r.anova.percentGRR_anova ? a : b);
    }

    const cards = items.map((it, i) => {
        const r = it.r, h = it.hist, v = r.verdict;
        const cls = (i === bestIdx ? 'best ' : '') + (i === worstIdx ? 'worst' : '');
        const tag = (i === bestIdx) ? '<span class="compare-tag best">最佳 ✓</span>' :
                    (i === worstIdx) ? '<span class="compare-tag worst">最差 ✗</span>' : '';
        const d = new Date(h.time);
        const ndcTxt = v.code === 'INVALID' ? '—' : (r.ndc >= 999 ? '999+' : r.ndc);
        const grrTxt = v.code === 'INVALID' ? '—' : round(r.anova.percentGRR_anova, 2) + '%';
        const evTxt = v.code === 'INVALID' ? '—' : round(r.anova.EV_anova, 4);
        const avTxt = v.code === 'INVALID' ? '—' : round(r.anova.AV_anova, 4);
        const pvTxt = v.code === 'INVALID' ? '—' : round(r.anova.PV_final, 4);
        const tolTxt = (v.code === 'INVALID' || r.percentGRR_tol === null) ? '—' : round(r.percentGRR_tol, 2) + '%';

        return `<div class="compare-card ${cls}">
            ${tag}
            <h4>${h.name || '未命名'}</h4>
            <div class="c-sub">${d.toLocaleString('zh-CN')} · 👷${h.numOps} 🔩${h.numParts} 🔁${h.numTrials}${h.tolerance ? ' 📏'+h.tolerance : ''}</div>
            <div class="c-metric"><span class="c-label">%GRR (研究变异)</span><span class="c-value">${grrTxt}</span></div>
            <div class="c-metric"><span class="c-label">ndc 区分度</span><span class="c-value">${ndcTxt}</span></div>
            <div class="c-metric"><span class="c-label">重复性 EV</span><span class="c-value">${evTxt}</span></div>
            <div class="c-metric"><span class="c-label">再现性 AV</span><span class="c-value">${avTxt}</span></div>
            <div class="c-metric"><span class="c-label">零件变异 PV</span><span class="c-value">${pvTxt}</span></div>
            <div class="c-metric"><span class="c-label">%GRR (公差)</span><span class="c-value">${tolTxt}</span></div>
            <div class="c-verdict ${v.cls}">${v.label}</div>

            <div class="cmp-thumb-grid">
                <div class="cmp-thumb"><div class="ct-title">① 方差贡献率</div><canvas id="cmp-pie-${i}"></canvas></div>
                <div class="cmp-thumb"><div class="ct-title">② 均值交叉图 (X̄ by Part)</div><canvas id="cmp-xbar-${i}"></canvas></div>
                <div class="cmp-thumb"><div class="ct-title">③ R 控制图 (极差)</div><canvas id="cmp-rctrl-${i}"></canvas></div>
            </div>

            <div class="cmp-batch-actions">
                <button class="cmp-btn cmp-primary" data-jump="${h.id}">📄 跳到完整报告</button>
                <button class="cmp-btn" data-delete="${h.id}">🗑 删除此批次</button>
            </div>
        </div>`;
    }).join('');

    const colors = ['#3b82f6', '#ef4444', '#10b981'];
    const labels = items.map((it, i) => (it.hist.name || `批次${i+1}`).slice(0, 18));

    const mkBarCanvas = id => `<div class="compare-chart-box"><h5>${id.title}</h5><canvas id="${id.id}"></canvas></div>`;
    const chartSpecs = [
        { id: 'cmp-grr', title: '%GRR 对比（越低越好，<10% 绿色）' },
        { id: 'cmp-ndc', title: 'ndc 区分度对比（越高越好，≥5 合格）' },
        { id: 'cmp-evavpv', title: 'EV / AV / PV 分解 (σ)' }
    ];

    document.getElementById('compare-content').innerHTML = `
        <div class="compare-grid">${cards}</div>
        <div class="compare-charts">${chartSpecs.map(mkBarCanvas).join('')}</div>`;

    // 为每个批次绘制缩略图（饼图/均值交叉/R控制图）
    items.forEach((it, i) => {
        const r = it.r, v = it.r.verdict;

        // 缩略图1：方差贡献饼图
        try {
            const pieCtx = document.getElementById(`cmp-pie-${i}`);
            if (pieCtx && v.code !== 'INVALID') {
                compareCharts.push(new Chart(pieCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['EV 重复性', 'AV 再现性', 'PV 零件'],
                        datasets: [{
                            data: [round(r.anova.percentEV_anova, 2), round(r.anova.percentAV_anova, 2), round(r.anova.percentPV_anova, 2)],
                            backgroundColor: ['#ef4444', '#f59e0b', '#10b981']
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } },
                            tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed}%` } }
                        }
                    }
                }));
            } else if (pieCtx) {
                pieCtx.parentNode.innerHTML = '<div class="ct-title">① 方差贡献率</div><div style="padding:22px 0;text-align:center;color:#4338ca;font-size:12px;font-weight:600;">⚠ 样本不适合分析，贡献率无法判定</div>';
            }
        } catch (_) {}

        // 缩略图2：均值交叉图（按零件）
        try {
            const xbCtx = document.getElementById(`cmp-xbar-${i}`);
            if (xbCtx && v.code !== 'INVALID') {
                const partLabels = r.partMeans.map((_, j) => `P${j + 1}`);
                const opDatasets = r.opPartMeans.map((opm, oi) => ({
                    label: '测量员 ' + String.fromCharCode(65 + oi),
                    data: opm,
                    borderColor: ['#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#f97316'][oi % 5],
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: 2,
                    tension: 0.1
                }));
                compareCharts.push(new Chart(xbCtx, {
                    type: 'line',
                    data: { labels: partLabels, datasets: opDatasets },
                    options: { responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } }
                    }
                }));
            } else if (xbCtx) {
                xbCtx.parentNode.innerHTML = '<div class="ct-title">② 均值交叉图 (X̄ by Part)</div><div style="padding:22px 0;text-align:center;color:#4338ca;font-size:12px;font-weight:600;">⚠ 样本无差异，无法绘制</div>';
            }
        } catch (_) {}

        // 缩略图3：R 控制图（极差）
        try {
            const rcCtx = document.getElementById(`cmp-rctrl-${i}`);
            if (rcCtx && v.code !== 'INVALID') {
                const rctrlLbl = [];
                const rctrlVals = [];
                r.controlR.forEach((row, o) => {
                    row.forEach((rv, j) => {
                        rctrlLbl.push(`${String.fromCharCode(65+o)}-${j+1}`);
                        rctrlVals.push(rv);
                    });
                });
                compareCharts.push(new Chart(rcCtx, {
                    type: 'line',
                    data: { labels: rctrlLbl, datasets: [
                        { label: 'R', data: rctrlVals, borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 2, showLine: false },
                        { label: 'UCL', data: rctrlLbl.map(() => r.rangeUCL), borderColor: '#ef4444', borderDash: [4, 3], pointRadius: 0, borderWidth: 1 },
                        { label: 'CL', data: rctrlLbl.map(() => r.rangeCL), borderColor: '#10b981', pointRadius: 0, borderWidth: 1 }
                    ] },
                    options: { responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { x: { ticks: { display: false } }, y: { ticks: { font: { size: 9 } } } }
                    }
                }));
            } else if (rcCtx) {
                rcCtx.parentNode.innerHTML = '<div class="ct-title">③ R 控制图 (极差)</div><div style="padding:22px 0;text-align:center;color:#4338ca;font-size:12px;font-weight:600;">⚠ 样本无波动，无法绘制</div>';
            }
        } catch (_) {}
    });

    // 绑定跳转/删除按钮
    document.querySelectorAll('[data-jump]').forEach(b => {
        b.addEventListener('click', () => {
            const hid = b.getAttribute('data-jump');
            const h = getHistory().find(x => x.id == hid);
            if (!h) return;
            loadHistoryItem(h);
            // 立即自动计算并滚动到结果区
            setTimeout(() => {
                doCalculate();
                document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
            }, 120);
        });
    });
    document.querySelectorAll('[data-delete]').forEach(b => {
        b.addEventListener('click', () => {
            const hid = b.getAttribute('data-delete');
            if (!confirm('确定要删除该历史记录吗？')) return;
            deleteHistory(hid);
            historySelection.delete(hid);
            renderHistoryList();
            renderCompareView();
            renderTrendView();
        });
    });

    // 绘制 3 个对比柱状图
    const grrData = items.map(it => it.r.verdict.code === 'INVALID' ? null : round(it.r.anova.percentGRR_anova, 2));
    compareCharts.push(new Chart(document.getElementById('cmp-grr'), {
        type: 'bar',
        data: { labels, datasets: [{ label: '%GRR', data: grrData, backgroundColor: items.map((it, i) =>
            it.r.verdict.code === 'INVALID' ? '#94a3b8' :
            (i === bestIdx ? '#10b981' : i === worstIdx ? '#ef4444' : colors[i])) }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } }
        }
    }));

    const ndcData = items.map(it => it.r.verdict.code === 'INVALID' ? 0 : Math.min(it.r.ndc, 30));
    compareCharts.push(new Chart(document.getElementById('cmp-ndc'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'ndc', data: ndcData, backgroundColor: items.map((it, i) =>
            it.r.verdict.code === 'INVALID' ? '#94a3b8' :
            it.r.ndc >= 5 ? '#10b981' : '#ef4444') }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'ndc' } } }
        }
    }));

    compareCharts.push(new Chart(document.getElementById('cmp-evavpv'), {
        type: 'bar',
        data: { labels, datasets: [
            { label: 'EV', data: items.map(it => it.r.verdict.code === 'INVALID' ? 0 : round(it.r.anova.EV_anova, 4)), backgroundColor: '#ef4444' },
            { label: 'AV', data: items.map(it => it.r.verdict.code === 'INVALID' ? 0 : round(it.r.anova.AV_anova, 4)), backgroundColor: '#f59e0b' },
            { label: 'PV', data: items.map(it => it.r.verdict.code === 'INVALID' ? 0 : round(it.r.anova.PV_final, 4)), backgroundColor: '#10b981' }
        ] },
        options: { responsive: true, maintainAspectRatio: false,
            scales: { x: { stacked: false }, y: { beginAtZero: true, title: { display: true, text: 'σ' } } }
        }
    }));
}

/* =========================================================
   批次趋势视图（按保存时间追踪量具表现）
   ========================================================= */
let trendCharts = [];
function renderTrendView() {
    trendCharts.forEach(c => c && c.destroy && c.destroy());
    trendCharts = [];
    const list = getHistory().sort((a, b) => a.time - b.time);
    const emptyDiv = document.getElementById('trend-empty');
    const alertsDiv = document.getElementById('trend-alerts');

    if (!list.length) {
        emptyDiv.classList.remove('hidden');
        alertsDiv.innerHTML = '';
        ['trend-grr', 'trend-ndc', 'trend-evavpv'].forEach(id => {
            const c = document.getElementById(id);
            if (c) { const p = c.parentNode; if (p) p.innerHTML = `<h5>${p.querySelector('h5')?.innerText || ''}</h5><div style="padding:60px 0;text-align:center;color:#94a3b8;font-size:13px;">暂无数据</div>`; }
        });
        return;
    }
    emptyDiv.classList.add('hidden');

    const labels = list.map(h => {
        const d = new Date(h.time);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    const results = list.map(h => hydrateHistoryItem(h));

    // 识别变差节点（PASS→MARGINAL/UNACCEPT 或 MARGINAL→UNACCEPT 或 INVALID→...）
    const VERDICT_RANK = { INVALID: -1, PASS: 0, MARGINAL: 1, UNACCEPT: 2 };
    const alerts = [];
    const anomalyIdx = [];
    for (let i = 1; i < results.length; i++) {
        const prev = VERDICT_RANK[results[i - 1].verdict.code] ?? -1;
        const curr = VERDICT_RANK[results[i].verdict.code] ?? -1;
        const prevGRR = results[i - 1].verdict.code === 'INVALID' ? 0 : results[i - 1].anova.percentGRR_anova;
        const currGRR = results[i].verdict.code === 'INVALID' ? 0 : results[i].anova.percentGRR_anova;
        const grrJump = prevGRR > 0 && (currGRR - prevGRR) / prevGRR >= 0.25; // %GRR 上升 ≥25%
        if (curr > prev && prev >= 0) {
            alerts.push({ level: 'danger', idx: i, msg: `「${list[i].name || '未命名'}」判定恶化：${results[i - 1].verdict.short} → ${results[i].verdict.short}` });
            anomalyIdx.push(i);
        } else if (grrJump) {
            alerts.push({ level: 'warn', idx: i, msg: `「${list[i].name || '未命名'}」%GRR 上升 ${Math.round((currGRR - prevGRR) / prevGRR * 100)}%（${round(prevGRR, 1)}% → ${round(currGRR, 1)}%）` });
            anomalyIdx.push(i);
        } else if (prev === -1 && curr > 0) {
            alerts.push({ level: 'warn', idx: i, msg: `「${list[i].name || '未命名'}」首次获得有效判定：${results[i].verdict.short}` });
        }
    }
    if (!alerts.length) {
        alertsDiv.innerHTML = `<div class="trend-alert-ok">✓ 近 ${list.length} 次分析未发现明显量具恶化节点</div>`;
    } else {
        alertsDiv.innerHTML = alerts.map(a => {
            const d = new Date(list[a.idx].time);
            return `<div class="trend-alert ${a.level === 'warn' ? 'warn' : ''}">
                <span>⚠ ${a.msg}</span>
                <span class="ta-time">${d.toLocaleString('zh-CN')}</span>
            </div>`;
        }).join('');
    }

    // 图1：%GRR 趋势
    trendCharts.push(new Chart(document.getElementById('trend-grr'), {
        type: 'line',
        data: { labels, datasets: [
            {
                label: '%GRR (研究变异)',
                data: results.map(r => r.verdict.code === 'INVALID' ? null : round(r.anova.percentGRR_anova, 2)),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                spanGaps: true,
                pointRadius: 3,
                pointBackgroundColor: results.map((_, i) => anomalyIdx.includes(i) ? '#dc2626' : '#3b82f6'),
                pointRadius: results.map((_, i) => anomalyIdx.includes(i) ? 6 : 3)
            },
            { label: '合格线 <10%', data: labels.map(() => 10), borderColor: '#10b981', borderDash: [6, 3], pointRadius: 0 },
            { label: '不合格线 ≥30%', data: labels.map(() => 30), borderColor: '#ef4444', borderDash: [6, 3], pointRadius: 0 }
        ] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        title: items => {
                            const i = items[0].dataIndex;
                            return `${list[i].name || '未命名'}\n${new Date(list[i].time).toLocaleString('zh-CN')}`;
                        }
                    }
                }
            },
            scales: { y: { beginAtZero: true, suggestedMax: 40, title: { display: true, text: '%GRR' } } }
        }
    }));

    // 图2：ndc 趋势
    trendCharts.push(new Chart(document.getElementById('trend-ndc'), {
        type: 'line',
        data: { labels, datasets: [
            {
                label: 'ndc 区分度',
                data: results.map(r => r.verdict.code === 'INVALID' ? null : Math.min(r.ndc, 50)),
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139,92,246,0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                spanGaps: true,
                pointRadius: 3,
                pointBackgroundColor: results.map((_, i) => anomalyIdx.includes(i) ? '#dc2626' : '#8b5cf6'),
                pointRadius: results.map((_, i) => anomalyIdx.includes(i) ? 6 : 3)
            },
            { label: '合格线 ndc≥5', data: labels.map(() => 5), borderColor: '#10b981', borderDash: [6, 3], pointRadius: 0 }
        ] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        title: items => {
                            const i = items[0].dataIndex;
                            return `${list[i].name || '未命名'}\n${new Date(list[i].time).toLocaleString('zh-CN')}`;
                        }
                    }
                }
            },
            scales: { y: { beginAtZero: true, suggestedMax: 20, title: { display: true, text: 'ndc' } } }
        }
    }));

    // 图3：EV/AV/PV 分解趋势
    trendCharts.push(new Chart(document.getElementById('trend-evavpv'), {
        type: 'line',
        data: { labels, datasets: [
            { label: 'EV (重复性 σ)', data: results.map(r => r.verdict.code === 'INVALID' ? null : round(r.anova.EV_anova, 4)), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 2, fill: true, tension: 0.2, spanGaps: true, pointRadius: 2 },
            { label: 'AV (再现性 σ)', data: results.map(r => r.verdict.code === 'INVALID' ? null : round(r.anova.AV_anova, 4)), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 2, fill: true, tension: 0.2, spanGaps: true, pointRadius: 2 },
            { label: 'PV (零件变异 σ)', data: results.map(r => r.verdict.code === 'INVALID' ? null : round(r.anova.PV_final, 4)), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 2, fill: true, tension: 0.2, spanGaps: true, pointRadius: 2 }
        ] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        title: items => {
                            const i = items[0].dataIndex;
                            return `${list[i].name || '未命名'}\n${new Date(list[i].time).toLocaleString('zh-CN')}`;
                        }
                    }
                }
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'σ' } } }
        }
    }));
}

/* =========================================================
   导出模块
   ========================================================= */
function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}
function toCSV(rows) {
    return rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

/* 从历史记录（或当前）构造统一结果 r 用于导出 */
function buildResultFromHistory(h) { return hydrateHistoryItem(h); }

async function exportCSV() {
    if (!currentResult) { alert('请先完成一次计算分析再导出。'); return; }
    if (typeof JSZip === 'undefined') { alert('JSZip 未加载，请检查网络后重试。'); return; }

    const r = currentResult;
    const a = r.anova, v = r.verdict;
    const isInvalid = v.code === 'INVALID';
    const na = 'N/A';
    const pctVal = x => isInvalid ? na : (round(x, 2) + '%');
    const numVal = x => isInvalid ? na : round(x, 6);
    const zip = new JSZip();

    /* Sheet1: 原始测量数据表 */
    const rawRows = [['零件', '测量员', '测量次数', '测量值']];
    for (let o = 0; o < r.numOps; o++) {
        for (let p = 0; p < r.numParts; p++) {
            for (let t = 0; t < r.numTrials; t++) {
                const val = r.data[o][p][t];
                if (typeof val === 'number' && isFinite(val))
                    rawRows.push([p + 1, String.fromCharCode(65 + o), t + 1, val]);
            }
        }
    }
    zip.file('01_原始测量数据.csv', '\uFEFF' + toCSV(rawRows));

    /* Sheet2: R&R 结果（无效样本所有指标统一 N/A / 无法判定） */
    const rr = [];
    rr.push(['MSA/Gauge R&R 分析结果 — 依据 AIAG MSA 第四版']);
    rr.push([]);
    rr.push(['基本信息']);
    rr.push(['测量员', r.numOps, '零件数', r.numParts, '重复次数', r.numTrials]);
    rr.push(['规格公差', r.tolerance || '', '总均值', round(r.grandMean, 6), '总体标准差', isInvalid ? na : round(r.totalStd, 6)]);
    rr.push([]);
    rr.push(['最终判定', v.label, isInvalid ? '（请扩大样本覆盖范围后重新分析）' : '']);
    if (isInvalid) {
        rr.push([]);
        rr.push(['说明', '零件间差异远小于测量系统波动（或样本完全无变异），本次分析结果不可信。']);
        rr.push(['', '请选取能覆盖过程 ±3σ 变异范围的零件样本重新做 MSA。']);
        rr.push([]);
    }
    rr.push(['变异来源', 'SD (σ)', 'Var (σ²)', '%研究变异', r.tolerance ? '%公差' : '']);
    rr.push(['重复性 EV', numVal(a.EV_anova), numVal(a.EV_anova ** 2), pctVal(a.percentEV_anova), r.tolerance ? (isInvalid ? na : round(r.percentEV_tol, 2) + '%') : '']);
    rr.push(['再现性 AV (含交互)', numVal(a.AV_anova), numVal(a.AV_anova ** 2), pctVal(a.percentAV_anova), r.tolerance ? (isInvalid ? na : round(r.percentAV_tol, 2) + '%') : '']);
    rr.push(['GRR 合计', numVal(a.GRR_anova), numVal(a.GRR_anova ** 2), isInvalid ? '无法判定' : (round(a.percentGRR_anova, 2) + '%'), r.tolerance ? (isInvalid ? '无法判定' : (round(r.percentGRR_tol, 2) + '%')) : '']);
    rr.push([`零件变异 PV${r.numParts >= 20 ? ' (融合估计)' : ''}`, numVal(a.PV_final), numVal(a.PV_final ** 2), pctVal(a.percentPV_anova), '']);
    rr.push(['总变异 TV', numVal(a.TV_final), numVal(a.TV_final ** 2), isInvalid ? na : '100%', '']);
    rr.push([]);
    rr.push(['区分度 ndc', isInvalid ? '无法判定' : (r.ndc >= 999 ? '999+' : r.ndc), isInvalid ? '（样本不适合分析，ndc计算无意义）' : (r.ndc >= 5 ? '合格' : '不合格')]);
    zip.file('02_RR结果与判定.csv', '\uFEFF' + toCSV(rr));

    /* Sheet3: ANOVA 方差分析表 */
    const ao = [];
    ao.push(['ANOVA 方差分析表 (α=0.05)']);
    if (isInvalid) { ao.push([]); ao.push(['数据质量警告', v.label + '：ANOVA 各变异分量仅供参考，贡献率与判定不具备统计意义。']); }
    ao.push([]);
    ao.push(['来源', 'DF', 'SS', 'MS', 'F', 'F临界', '显著性', '方差分量']);
    const pS = a.F_parts > a.F_crit_parts, oS = a.F_ops > a.F_crit_ops, iS = a.F_interaction > a.F_crit_interaction;
    ao.push(['零件 Parts', a.df_parts, round(a.SS_parts, 6), round(a.MS_parts, 6), round(a.F_parts, 4), round(a.F_crit_parts, 4), isInvalid ? '样本不足' : (pS ? '显著' : '不显著'), isInvalid ? na : round(a.var_parts, 6)]);
    ao.push(['测量员 Operators', a.df_ops, round(a.SS_ops, 6), round(a.MS_ops, 6), round(a.F_ops, 4), round(a.F_crit_ops, 4), isInvalid ? '样本不足' : (oS ? '显著' : '不显著'), isInvalid ? na : round(a.var_ops, 6)]);
    ao.push(['交互 Part×Op', a.df_interaction, round(a.SS_interaction, 6), round(a.MS_interaction, 6), round(a.F_interaction, 4), round(a.F_crit_interaction, 4), isInvalid ? '样本不足' : (iS ? '显著' : '不显著'), isInvalid ? na : round(a.var_interaction, 6)]);
    ao.push(['重复性 Repeatability', a.df_repeat, round(a.SS_repeat, 6), round(a.MS_repeat, 6), '', '', '', isInvalid ? na : round(a.var_repeat, 6)]);
    zip.file('03_ANOVA方差分析.csv', '\uFEFF' + toCSV(ao));

    /* Sheet4: 历史对比摘要 */
    const hist = getHistory();
    const comp = [['历史记录对比摘要（共 ' + hist.length + ' 条）']];
    comp.push([]);
    comp.push(['ID', '名称', '时间', '测量员', '零件', '次数', '公差', '%GRR', 'ndc', '最终判定', '说明']);
    hist.forEach((h, i) => {
        const hr = buildResultFromHistory(h);
        const vv = hr.verdict;
        const d = new Date(h.time);
        const hInvalid = vv.code === 'INVALID';
        comp.push([
            i + 1,
            h.name || '',
            d.toLocaleString('zh-CN'),
            h.numOps, h.numParts, h.numTrials,
            h.tolerance || '',
            hInvalid ? 'N/A' : round(hr.anova.percentGRR_anova, 2) + '%',
            hInvalid ? 'N/A' : (hr.ndc >= 999 ? '999+' : hr.ndc),
            vv.label,
            hInvalid ? '样本不适合分析' : ''
        ]);
    });
    zip.file('04_历史对比摘要.csv', '\uFEFF' + toCSV(comp));

    const now = new Date();
    const fn = `MSA_GRR_Export_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.zip`;
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const an = document.createElement('a');
    an.href = url; an.download = fn; an.click();
    URL.revokeObjectURL(url);
}

/* HTML 报告导出（复用自 v2 基础 + 一致性判定） */
function exportHTMLReport() {
    if (!currentResult) { alert('请先完成一次计算分析再导出。'); return; }
    const r = currentResult, a = r.anova, v = r.verdict;
    const toImg = id => { try { const c = document.getElementById(id); return c ? c.toDataURL('image/png') : ''; } catch { return ''; } };
    const imgs = {
        variance: toImg('variance-chart'),
        xbar: toImg('xbar-chart'),
        range: toImg('range-chart'),
        ctrlX: toImg('xbar-control-chart'),
        ctrlR: toImg('r-control-chart')
    };

    const ndcDisp = v.code === 'INVALID' ? 'N/A' : (r.ndc >= 999 ? '999+' : r.ndc);
    const grrPct = v.code === 'INVALID' ? 'N/A' : round(a.percentGRR_anova, 2) + '%';
    const now = new Date();
    const valPct = x => v.code === 'INVALID' ? 'N/A' : round(x, 2) + '%';
    const val = x => v.code === 'INVALID' ? 'N/A' : round(x, 6);

    const warnBox = (r.warnings && r.warnings.length)
        ? `<div style="background:#fffbeb;border-left:4px solid #ca8a04;padding:10px 14px;border-radius:6px;color:#78350f;margin:12px 0;">
            <strong>📢 数据质量提示：</strong><ul style="margin:6px 0 0 20px;">
            ${r.warnings.map(w => `<li>${w.text}</li>`).join('')}</ul></div>` : '';

    let verTxt, rec;
    if (v.code === 'INVALID') { verTxt = '无法判定（样本不适合分析）'; rec = '请选取覆盖过程±3σ范围的零件样本重新做MSA。'; }
    else if (v.code === 'PASS') { verTxt = '✓ 量具可接受 (ACCEPT)'; rec = '测量系统满足AIAG标准，可正常使用。'; }
    else if (v.code === 'MARGINAL') { verTxt = '⚠ 量具边缘可接受 (MARGINAL)'; rec = '综合测量重要性与成本判断；建议持续改进。'; }
    else { verTxt = '✗ 量具不可接受 (UNACCEPTABLE)'; rec = '需改进：校准→培训→改进方法→更换量具。'; }

    const imgBlock = (src, cap) => src ? `<div style="page-break-inside:avoid;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
        <div style="text-align:center;font-weight:600;color:#1e40af;margin-bottom:6px;">${cap}</div>
        <img src="${src}" style="max-width:100%;height:auto;display:block;margin:0 auto;"></div>` : '';

    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>MSA/Gauge R&R 报告 ${now.toLocaleDateString('zh-CN')}</title>
<style>
body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#fff;color:#1e293b;line-height:1.7;font-size:13px;padding:24px;max-width:1100px;margin:0 auto;}
h1{color:#1e40af;border-bottom:3px solid #1e40af;padding-bottom:8px;margin-bottom:20px;}
h2{color:#1e40af;margin:28px 0 12px;border-left:5px solid #3b82f6;padding-left:10px;font-size:18px;}
h3{color:#475569;margin:18px 0 8px;font-size:15px;}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;}
th,td{border:1px solid #cbd5e1;padding:7px 9px;}
th{background:#f1f5f9;font-weight:700;}
tr:nth-child(even) td{background:#fafafa;}
td:first-child,th:first-child{text-align:left;}
td:not(:first-child),th:not(:first-child){text-align:right;}
tr.hl td{background:#eff6ff;font-weight:600;}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-left:8px;}
.pass{background:#dcfce7;color:#15803d;}
.marginal{background:#fef9c3;color:#ca8a04;}
.fail{background:#fee2e2;color:#b91c1c;}
.invalid{background:#e0e7ff;color:#4338ca;}
.verdict{text-align:center;font-size:18px;font-weight:700;padding:14px;border-radius:8px;margin:16px 0;}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px;margin:10px 0;background:#f8fafc;padding:14px;border-radius:6px;}
.meta span{color:#64748b;margin-right:4px;}
.sign-yes{background:#dcfce7;color:#15803d;font-weight:600;}
.sign-no{background:#fee2e2;color:#b91c1c;font-weight:600;}
.footer{margin-top:30px;padding-top:14px;border-top:1px dashed #94a3b8;color:#64748b;font-size:12px;text-align:center;}
ul{padding-left:20px;margin:6px 0;}
</style></head><body>
<h1>📊 MSA / Gauge R&amp;R 测量系统分析报告</h1>
<div class="meta">
<div><span>生成时间：</span>${now.toLocaleString('zh-CN')}</div>
<div><span>测量员：</span>${r.numOps} 人</div>
<div><span>零件数：</span>${r.numParts} 件</div>
<div><span>重复次数：</span>${r.numTrials} 次</div>
<div><span>公差：</span>${r.tolerance || '未提供'}</div>
<div><span>总均值：</span>${round(r.grandMean, 6)}</div>
<div><span>总体标准差：</span>${round(r.totalStd, 6)}</div>
<div><span>最终判定：</span><span class="badge ${v.cls}">${v.short}</span>
<span class="badge ${r.ndc >= 5 ? 'pass' : r.ndc === 0 ? 'invalid' : 'fail'}">ndc=${ndcDisp}</span></div>
</div>
${warnBox}

<h2>一、R&amp;R 结果表 (ANOVA法)</h2>
<table>
<thead><tr style="background:#f1f5f9;">
<th>变异来源</th><th>SD (σ)</th><th>Var (σ²)</th><th>%研究变异</th>${r.tolerance ? '<th>%公差</th>' : ''}
</tr></thead><tbody>
<tr><td>重复性 EV</td><td>${val(a.EV_anova)}</td><td>${val(a.EV_anova ** 2)}</td><td>${valPct(a.percentEV_anova)}</td>${r.tolerance ? `<td>${valPct(r.percentEV_tol)}</td>` : ''}</tr>
<tr><td>再现性 AV (含交互)</td><td>${val(a.AV_anova)}</td><td>${val(a.AV_anova ** 2)}</td><td>${valPct(a.percentAV_anova)}</td>${r.tolerance ? `<td>${valPct(r.percentAV_tol)}</td>` : ''}</tr>
<tr class="hl"><td>GRR 合计</td><td>${val(a.GRR_anova)}</td><td>${val(a.GRR_anova ** 2)}</td><td>${grrPct}</td>${r.tolerance ? `<td>${valPct(r.percentGRR_tol)}</td>` : ''}</tr>
<tr><td>零件变异 PV${r.numParts >= 20 ? ' (融合)' : ''}</td><td>${val(a.PV_final)}</td><td>${val(a.PV_final ** 2)}</td><td>${valPct(a.percentPV_anova)}</td>${r.tolerance ? '<td>-</td>' : ''}</tr>
<tr class="hl"><td>总变异 TV</td><td>${val(a.TV_final)}</td><td>${val(a.TV_final ** 2)}</td><td>${v.code === 'INVALID' ? 'N/A' : '100%'}</td>${r.tolerance ? '<td>-</td>' : ''}</tr>
</tbody></table>

<h2>二、ANOVA 方差分析表</h2>
<table>
<thead><tr><th>来源</th><th>DF</th><th>SS</th><th>MS</th><th>F</th><th>F临界</th><th>显著性</th><th>方差分量</th></tr></thead>
<tbody>
<tr><td><strong>零件</strong></td><td>${a.df_parts}</td><td>${round(a.SS_parts, 6)}</td><td>${round(a.MS_parts, 6)}</td><td>${round(a.F_parts, 4)}</td>
    <td>${round(a.F_crit_parts, 4)}</td><td class="${a.F_parts > a.F_crit_parts ? 'sign-yes' : 'sign-no'}">${a.F_parts > a.F_crit_parts ? '显著' : '不显著'}</td><td>${round(a.var_parts, 6)}</td></tr>
<tr><td><strong>测量员</strong></td><td>${a.df_ops}</td><td>${round(a.SS_ops, 6)}</td><td>${round(a.MS_ops, 6)}</td><td>${round(a.F_ops, 4)}</td>
    <td>${round(a.F_crit_ops, 4)}</td><td class="${a.F_ops > a.F_crit_ops ? 'sign-yes' : 'sign-no'}">${a.F_ops > a.F_crit_ops ? '显著' : '不显著'}</td><td>${round(a.var_ops, 6)}</td></tr>
<tr><td><strong>交互</strong></td><td>${a.df_interaction}</td><td>${round(a.SS_interaction, 6)}</td><td>${round(a.MS_interaction, 6)}</td><td>${round(a.F_interaction, 4)}</td>
    <td>${round(a.F_crit_interaction, 4)}</td><td class="${a.F_interaction > a.F_crit_interaction ? 'sign-yes' : 'sign-no'}">${a.F_interaction > a.F_crit_interaction ? '显著' : '不显著'}</td><td>${round(a.var_interaction, 6)}</td></tr>
<tr><td><strong>重复性</strong></td><td>${a.df_repeat}</td><td>${round(a.SS_repeat, 6)}</td><td>${round(a.MS_repeat, 6)}</td><td>-</td><td>-</td><td>-</td><td>${round(a.var_repeat, 6)}</td></tr>
</tbody></table>

<h2>三、区分度 ndc</h2>
<p><strong>ndc = ${ndcDisp}</strong> &nbsp;&nbsp; AIAG 要求 ndc ≥ 5，推荐 ≥ 10</p>
<p><strong>判定：</strong>${v.code === 'INVALID' ? '无法判定（样本不适合分析）' : (r.ndc >= 5 ? '合格 ✓' : '不合格 ✗')}</p>

<h2>四、图表</h2>
${imgBlock(imgs.variance, '图1 · 方差贡献率饼图')}
${imgBlock(imgs.xbar, '图2 · 按零件的均值交叉图')}
${imgBlock(imgs.range, '图3 · 按零件的极差交叉图')}
${imgBlock(imgs.ctrlX, '图4 · X̄ 控制图')}
${imgBlock(imgs.ctrlR, '图5 · R 控制图')}

<h2>五、最终判定与建议</h2>
<ul>
<li>%GRR &lt; 10%：可接受</li>
<li>10% ≤ %GRR &lt; 30%：边缘可接受</li>
<li>%GRR ≥ 30%：不可接受</li>
<li>ndc ≥ 5：区分能力合格</li>
<li style="color:#4338ca;"><strong>样本无变异 / 零件间无差异 → 无法判定，需重做 MSA</strong></li>
</ul>
<div class="verdict ${v.cls}">最终判定：${verTxt}</div>
<p><strong>建议措施：</strong>${rec}</p>

<div class="footer">MSA/Gauge R&R 报告 · AIAG MSA 第四版 · ANOVA 方法 · ${now.toLocaleDateString('zh-CN')}</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const fn = `MSA_GRR_Report_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.html`;
    const linkEl = document.createElement('a');
    linkEl.href = url; linkEl.download = fn; linkEl.click(); linkEl.remove();
    URL.revokeObjectURL(url);
}

/* =========================================================
   主流程
   ========================================================= */
function doCalculate() {
    const r = calculateMSA();
    if (!r) return;
    currentResult = r;
    document.getElementById('results').classList.remove('hidden');
    renderWarnings(r);
    renderSummary(r);
    renderANOVA(r);
    renderVarianceChart(r);
    renderXbarRangeChart(r);
    renderControlCharts(r);
    renderNDC(r);
    renderReport(r);
    setTimeout(() => document.getElementById('results').scrollIntoView({ behavior: 'smooth' }), 80);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('generate-table').addEventListener('click', generateTable);
    document.getElementById('load-sample').addEventListener('click', loadSampleHighVar);
    document.getElementById('load-sample-lowvar').addEventListener('click', loadSampleLowVar);
    document.getElementById('load-same').addEventListener('click', loadSampleSame);
    document.getElementById('clear-data').addEventListener('click', clearData);
    document.getElementById('calculate').addEventListener('click', doCalculate);
    document.getElementById('save-result').addEventListener('click', saveCurrentResult);
    document.getElementById('compare-history').addEventListener('click', renderCompareView);
    document.getElementById('clear-selection').addEventListener('click', () => { historySelection.clear(); renderHistoryList(); });
    document.getElementById('close-compare').addEventListener('click', () => document.getElementById('compare-panel').classList.add('hidden'));
    document.getElementById('print-report').addEventListener('click', () => window.print());
    document.getElementById('refresh-trend').addEventListener('click', renderTrendView);

    /* 导出下拉菜单 */
    const eb = document.getElementById('export-btn'), em = document.getElementById('export-menu');
    eb.addEventListener('click', e => { e.stopPropagation(); em.classList.toggle('show'); });
    document.addEventListener('click', () => em.classList.remove('show'));
    document.querySelectorAll('.dropdown-item').forEach(b => {
        b.addEventListener('click', () => {
            em.classList.remove('show');
            const t = b.dataset.type;
            if (t === 'html') exportHTMLReport();
            else if (t === 'csv') exportCSV();
            else if (t === 'print') window.print();
        });
    });

    generateTable();
    renderHistoryList();
    try { renderTrendView(); } catch (e) { /* 忽略首次图表未就绪错误 */ }
});
