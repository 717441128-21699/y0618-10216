const D2_CONSTANTS = {
    2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326,
    6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078
};

const D3_CONSTANTS = {
    2: 0, 3: 0, 4: 0, 5: 0,
    6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223
};

const D4_CONSTANTS = {
    2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114,
    6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777
};

const A2_CONSTANTS = {
    2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577,
    6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308
};

const F_TABLE = {
    '0.05': {
        df1_1: { df2_1: 161.4, df2_2: 18.51, df2_3: 10.13, df2_4: 7.71, df2_5: 6.61, df2_6: 5.99, df2_7: 5.59, df2_8: 5.32, df2_9: 5.12, df2_10: 4.96, df2_inf: 3.84 },
        df1_2: { df2_1: 199.5, df2_2: 19.00, df2_3: 9.55, df2_4: 6.94, df2_5: 5.79, df2_6: 5.14, df2_7: 4.74, df2_8: 4.46, df2_9: 4.26, df2_10: 4.10, df2_inf: 3.00 },
        df1_3: { df2_1: 215.7, df2_2: 19.16, df2_3: 9.28, df2_4: 6.59, df2_5: 5.41, df2_6: 4.76, df2_7: 4.35, df2_8: 4.07, df2_9: 3.86, df2_10: 3.71, df2_inf: 2.60 },
        df1_4: { df2_1: 224.6, df2_2: 19.25, df2_3: 9.12, df2_4: 6.39, df2_5: 5.19, df2_6: 4.53, df2_7: 4.12, df2_8: 3.84, df2_9: 3.63, df2_10: 3.48, df2_inf: 2.37 },
        df1_5: { df2_1: 230.2, df2_2: 19.30, df2_3: 9.01, df2_4: 6.26, df2_5: 5.05, df2_6: 4.39, df2_7: 3.97, df2_8: 3.69, df2_9: 3.48, df2_10: 3.33, df2_inf: 2.21 },
        df1_9: { df2_1: 240.5, df2_2: 19.38, df2_3: 8.81, df2_4: 6.00, df2_5: 4.77, df2_6: 4.10, df2_7: 3.68, df2_8: 3.39, df2_9: 3.18, df2_10: 3.02, df2_inf: 1.88 },
        df1_inf: { df2_1: 253.3, df2_2: 19.50, df2_3: 8.53, df2_4: 5.63, df2_5: 4.36, df2_6: 3.67, df2_7: 3.23, df2_8: 2.93, df2_9: 2.71, df2_10: 2.54, df2_inf: 1.00 }
    }
};

let charts = {};

function getFValue(df1, df2, alpha = 0.05) {
    const table = F_TABLE[alpha];
    if (!table) return 4.0;
    const key1 = df1 <= 5 ? `df1_${df1}` : (df1 <= 9 ? 'df1_9' : 'df1_inf');
    const key2 = df2 <= 10 ? `df2_${df2}` : 'df2_inf';
    const row = table[key1] || table['df1_inf'];
    return row[key2] || row['df2_inf'] || 4.0;
}

function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    const valid = arr.filter(v => !isNaN(v) && isFinite(v));
    if (valid.length === 0) return 0;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function variance(arr) {
    if (!arr || arr.length < 2) return 0;
    const valid = arr.filter(v => !isNaN(v) && isFinite(v));
    if (valid.length < 2) return 0;
    const m = mean(valid);
    return valid.reduce((s, v) => s + (v - m) ** 2, 0) / (valid.length - 1);
}

function range(arr) {
    if (!arr || arr.length === 0) return 0;
    const valid = arr.filter(v => !isNaN(v) && isFinite(v));
    if (valid.length === 0) return 0;
    return Math.max(...valid) - Math.min(...valid);
}

function round(num, decimals = 4) {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
}

function generateTable() {
    const numOps = parseInt(document.getElementById('operators').value) || 3;
    const numParts = parseInt(document.getElementById('parts').value) || 10;
    const numTrials = parseInt(document.getElementById('trials').value) || 3;

    const container = document.getElementById('data-entry');
    let html = '<table>';

    html += '<thead><tr>';
    html += '<th rowspan="2">零件</th>';
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
        html += `<tr><td><strong>${p + 1}</strong></td>`;
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
        for (let p = 0; p < numParts; p++) {
            data[o][p] = [];
        }
    }

    const inputs = document.querySelectorAll('.measurement');
    let hasData = false;
    inputs.forEach(input => {
        const p = parseInt(input.dataset.part);
        const o = parseInt(input.dataset.operator);
        const t = parseInt(input.dataset.trial);
        const val = parseFloat(input.value);
        if (!isNaN(val) && isFinite(val)) {
            data[o][p][t] = val;
            hasData = true;
        }
    });

    return { data, numOps, numParts, numTrials, hasData };
}

function loadSampleData() {
    document.getElementById('operators').value = 3;
    document.getElementById('parts').value = 10;
    document.getElementById('trials').value = 3;
    document.getElementById('spec-tolerance').value = 0.5;
    generateTable();

    const sampleData = [
        [
            [25.01, 25.02, 25.00],
            [25.12, 25.11, 25.13],
            [24.98, 24.99, 24.97],
            [25.23, 25.21, 25.22],
            [25.07, 25.08, 25.06],
            [24.89, 24.88, 24.90],
            [25.15, 25.16, 25.14],
            [25.31, 25.30, 25.32],
            [24.95, 24.94, 24.96],
            [25.05, 25.04, 25.06]
        ],
        [
            [25.02, 25.03, 25.01],
            [25.13, 25.12, 25.14],
            [24.97, 24.98, 24.96],
            [25.24, 25.22, 25.23],
            [25.08, 25.09, 25.07],
            [24.90, 24.89, 24.91],
            [25.16, 25.17, 25.15],
            [25.32, 25.31, 25.33],
            [24.96, 24.95, 24.97],
            [25.06, 25.05, 25.07]
        ],
        [
            [25.00, 25.01, 24.99],
            [25.11, 25.10, 25.12],
            [24.99, 25.00, 24.98],
            [25.22, 25.20, 25.21],
            [25.06, 25.07, 25.05],
            [24.88, 24.87, 24.89],
            [25.14, 25.15, 25.13],
            [25.30, 25.29, 25.31],
            [24.94, 24.93, 24.95],
            [25.04, 25.03, 25.05]
        ]
    ];

    const inputs = document.querySelectorAll('.measurement');
    inputs.forEach(input => {
        const p = parseInt(input.dataset.part);
        const o = parseInt(input.dataset.operator);
        const t = parseInt(input.dataset.trial);
        if (sampleData[o] && sampleData[o][p] && sampleData[o][p][t] !== undefined) {
            input.value = sampleData[o][p][t];
        }
    });
}

function clearData() {
    const inputs = document.querySelectorAll('.measurement');
    inputs.forEach(input => input.value = '');
    document.getElementById('results').classList.add('hidden');
    Object.values(charts).forEach(c => c && c.destroy && c.destroy());
    charts = {};
}

function calculateMSA() {
    const { data, numOps, numParts, numTrials, hasData } = getData();
    if (!hasData) {
        alert('请先输入测量数据！');
        return;
    }

    let allMeasurements = [];
    const operatorMeans = [];
    const operatorRanges = [];
    const partMeans = [];
    const partRanges = [];
    const cellMeans = [];
    const cellRanges = [];

    for (let o = 0; o < numOps; o++) {
        operatorMeans[o] = [];
        operatorRanges[o] = [];
        cellMeans[o] = [];
        cellRanges[o] = [];
        for (let p = 0; p < numParts; p++) {
            const measures = data[o][p].filter(v => !isNaN(v) && isFinite(v));
            cellMeans[o][p] = mean(measures);
            cellRanges[o][p] = range(measures);
            allMeasurements = allMeasurements.concat(measures);
        }
    }

    for (let o = 0; o < numOps; o++) {
        const allOps = [];
        for (let p = 0; p < numParts; p++) {
            allOps.push(...data[o][p].filter(v => !isNaN(v) && isFinite(v)));
        }
        operatorMeans[o] = mean(allOps);
        operatorRanges[o] = mean(cellRanges[o]);
    }

    for (let p = 0; p < numParts; p++) {
        const allParts = [];
        for (let o = 0; o < numOps; o++) {
            allParts.push(...data[o][p].filter(v => !isNaN(v) && isFinite(v)));
        }
        partMeans[p] = mean(allParts);
        partRanges[p] = range(allParts);
    }

    const grandMean = mean(allMeasurements);
    const Rbar = mean(operatorRanges);
    const Xbardiff = range(operatorMeans);
    const Rp = range(partMeans);

    const d2_trials = D2_CONSTANTS[numTrials] || D2_CONSTANTS[3];
    const d2_ops = D2_CONSTANTS[numOps] || D2_CONSTANTS[3];
    const d2_parts = D2_CONSTANTS[numParts > 10 ? 10 : numParts] || D2_CONSTANTS[10];

    const EV = Rbar * d2_trials;
    const AV = Math.sqrt(Math.max(0, (Xbardiff * d2_ops) ** 2 - (EV ** 2) / (numParts * numTrials)));
    const GRR = Math.sqrt(EV ** 2 + AV ** 2);
    const PV = Rp * d2_parts;
    const TV = Math.sqrt(GRR ** 2 + PV ** 2);

    const percentEV = (EV / TV) * 100;
    const percentAV = (AV / TV) * 100;
    const percentGRR = (GRR / TV) * 100;
    const percentPV = (PV / TV) * 100;

    const tolerance = parseFloat(document.getElementById('spec-tolerance').value);
    let percentGRR_tol = null;
    let percentEV_tol = null;
    let percentAV_tol = null;
    if (tolerance && tolerance > 0) {
        percentEV_tol = (6 * EV / tolerance) * 100;
        percentAV_tol = (6 * AV / tolerance) * 100;
        percentGRR_tol = (6 * GRR / tolerance) * 100;
    }

    const ndc = Math.floor(1.41 * (PV / GRR));

    const df_ops = numOps - 1;
    const df_parts = numParts - 1;
    const df_interaction = (numOps - 1) * (numParts - 1);
    const df_repeat = numOps * numParts * (numTrials - 1);
    const df_total = numOps * numParts * numTrials - 1;

    let SS_ops = 0, SS_parts = 0, SS_interaction = 0, SS_repeat = 0, SS_total = 0;

    for (let o = 0; o < numOps; o++) {
        SS_ops += numParts * numTrials * (operatorMeans[o] - grandMean) ** 2;
    }

    for (let p = 0; p < numParts; p++) {
        SS_parts += numOps * numTrials * (partMeans[p] - grandMean) ** 2;
    }

    for (let o = 0; o < numOps; o++) {
        for (let p = 0; p < numParts; p++) {
            SS_interaction += numTrials * (cellMeans[o][p] - operatorMeans[o] - partMeans[p] + grandMean) ** 2;
        }
    }

    for (let o = 0; o < numOps; o++) {
        for (let p = 0; p < numParts; p++) {
            for (let t = 0; t < numTrials; t++) {
                if (!isNaN(data[o][p][t]) && isFinite(data[o][p][t])) {
                    SS_repeat += (data[o][p][t] - cellMeans[o][p]) ** 2;
                }
            }
        }
    }

    SS_total = SS_ops + SS_parts + SS_interaction + SS_repeat;

    const MS_ops = SS_ops / df_ops;
    const MS_parts = SS_parts / df_parts;
    const MS_interaction = SS_interaction / df_interaction;
    const MS_repeat = SS_repeat / df_repeat;

    const F_ops = MS_ops / MS_interaction;
    const F_parts = MS_parts / MS_interaction;
    const F_interaction = MS_interaction / MS_repeat;

    const F_crit_ops = getFValue(df_ops, df_interaction);
    const F_crit_parts = getFValue(df_parts, df_interaction);
    const F_crit_interaction = getFValue(df_interaction, df_repeat);

    const var_repeat = MS_repeat;
    const var_interaction = Math.max(0, (MS_interaction - MS_repeat) / numTrials);
    const var_ops = Math.max(0, (MS_ops - MS_interaction) / (numParts * numTrials));
    const var_parts = Math.max(0, (MS_parts - MS_interaction) / (numOps * numTrials));

    const EV_anova = Math.sqrt(var_repeat);
    const AV_anova = Math.sqrt(var_ops + var_interaction);
    const GRR_anova = Math.sqrt(EV_anova ** 2 + AV_anova ** 2);
    const PV_anova = Math.sqrt(var_parts);
    const TV_anova = Math.sqrt(GRR_anova ** 2 + PV_anova ** 2);

    const percentEV_anova = (EV_anova / TV_anova) * 100;
    const percentAV_anova = (AV_anova / TV_anova) * 100;
    const percentGRR_anova = (GRR_anova / TV_anova) * 100;
    const percentPV_anova = (PV_anova / TV_anova) * 100;

    const A2 = A2_CONSTANTS[numTrials] || A2_CONSTANTS[3];
    const D3 = D3_CONSTANTS[numTrials] || D3_CONSTANTS[3];
    const D4 = D4_CONSTANTS[numTrials] || D4_CONSTANTS[4];
    const UCL_R = D4 * Rbar;
    const LCL_R = D3 * Rbar;
    const UCL_Xbar = grandMean + A2 * Rbar;
    const LCL_Xbar = grandMean - A2 * Rbar;

    return {
        data, numOps, numParts, numTrials,
        allMeasurements, grandMean,
        operatorMeans, operatorRanges,
        partMeans, partRanges,
        cellMeans, cellRanges,
        Rbar, Xbardiff, Rp,
        EV, AV, GRR, PV, TV,
        percentEV, percentAV, percentGRR, percentPV,
        percentEV_tol, percentAV_tol, percentGRR_tol,
        ndc, tolerance,
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
        control: {
            UCL_R, LCL_R, Rbar,
            UCL_Xbar, LCL_Xbar, grandMean,
            A2, D3, D4
        }
    };
}

function renderSummary(result) {
    const container = document.getElementById('summary');
    const { percentGRR_anova, ndc, tolerance, percentGRR_tol } = result;
    const a = result.anova;

    const getClass = val => val < 10 ? 'good' : val < 30 ? 'warn' : 'bad';
    const cls_grr = getClass(percentGRR_anova);

    let html = `
        <div class="summary-item ${cls_grr}">
            <div class="label">GRR %研究变异</div>
            <div class="value">${round(percentGRR_anova, 2)}%</div>
            <div class="sub">AIAG: ${percentGRR_anova < 10 ? '优秀' : percentGRR_anova < 30 ? '边缘' : '不可接受'}</div>
        </div>
        <div class="summary-item">
            <div class="label">重复性 (EV)</div>
            <div class="value">${round(a.EV_anova, 4)}</div>
            <div class="sub">${round(a.percentEV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item">
            <div class="label">再现性 (AV)</div>
            <div class="value">${round(a.AV_anova, 4)}</div>
            <div class="sub">${round(a.percentAV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item">
            <div class="label">零件变异 (PV)</div>
            <div class="value">${round(a.PV_anova, 4)}</div>
            <div class="sub">${round(a.percentPV_anova, 2)}% of TV</div>
        </div>
        <div class="summary-item ${ndc >= 5 ? 'good' : 'bad'}">
            <div class="label">区分度 (ndc)</div>
            <div class="value">${ndc}</div>
            <div class="sub">${ndc >= 5 ? '合格 (≥5)' : '不合格 (<5)'}</div>
        </div>
    `;

    if (percentGRR_tol !== null) {
        html += `
            <div class="summary-item ${getClass(percentGRR_tol)}">
                <div class="label">GRR %公差</div>
                <div class="value">${round(percentGRR_tol, 2)}%</div>
                <div class="sub">Tolerance = ${tolerance}</div>
            </div>
        `;
    }

    container.innerHTML = html;

    const decision = document.getElementById('decision');
    if (percentGRR_anova < 10 && ndc >= 5) {
        decision.className = 'decision-box pass';
        decision.textContent = '✓ 量具可接受 - 测量系统满足AIAG标准要求';
    } else if (percentGRR_anova < 30 && ndc >= 5) {
        decision.className = 'decision-box marginal';
        decision.textContent = '⚠ 量具边缘可接受 - 根据测量重要性和成本考虑是否改进';
    } else {
        decision.className = 'decision-box fail';
        decision.textContent = '✗ 量具不可接受 - 需要重新校准或更换量具';
    }
}

function renderANOVA(result) {
    const a = result.anova;
    const container = document.getElementById('anova-table');

    const checkSig = (F, Fc) => F > Fc ? 'significant' : 'not-significant';
    const sigText = (F, Fc) => F > Fc ? '显著' : '不显著';

    const html = `
        <table>
            <thead>
                <tr>
                    <th>变异来源</th>
                    <th>自由度 (DF)</th>
                    <th>平方和 (SS)</th>
                    <th>均方 (MS)</th>
                    <th>F 值</th>
                    <th>F 临界值 (α=0.05)</th>
                    <th>显著性</th>
                    <th>方差分量</th>
                    <th>贡献率 %</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>零件 (Parts)</strong></td>
                    <td>${a.df_parts}</td>
                    <td>${round(a.SS_parts, 6)}</td>
                    <td>${round(a.MS_parts, 6)}</td>
                    <td>${round(a.F_parts, 4)}</td>
                    <td>${round(a.F_crit_parts, 4)}</td>
                    <td class="${checkSig(a.F_parts, a.F_crit_parts)}">${sigText(a.F_parts, a.F_crit_parts)}</td>
                    <td>${round(a.var_parts, 6)}</td>
                    <td>${round(a.percentPV_anova, 2)}%</td>
                </tr>
                <tr>
                    <td><strong>测量员 (Operators)</strong></td>
                    <td>${a.df_ops}</td>
                    <td>${round(a.SS_ops, 6)}</td>
                    <td>${round(a.MS_ops, 6)}</td>
                    <td>${round(a.F_ops, 4)}</td>
                    <td>${round(a.F_crit_ops, 4)}</td>
                    <td class="${checkSig(a.F_ops, a.F_crit_ops)}">${sigText(a.F_ops, a.F_crit_ops)}</td>
                    <td>${round(a.var_ops, 6)}</td>
                    <td>-</td>
                </tr>
                <tr>
                    <td><strong>交互作用 (Part × Operator)</strong></td>
                    <td>${a.df_interaction}</td>
                    <td>${round(a.SS_interaction, 6)}</td>
                    <td>${round(a.MS_interaction, 6)}</td>
                    <td>${round(a.F_interaction, 4)}</td>
                    <td>${round(a.F_crit_interaction, 4)}</td>
                    <td class="${checkSig(a.F_interaction, a.F_crit_interaction)}">${sigText(a.F_interaction, a.F_crit_interaction)}</td>
                    <td>${round(a.var_interaction, 6)}</td>
                    <td>-</td>
                </tr>
                <tr>
                    <td><strong>重复性 (Repeatability)</strong></td>
                    <td>${a.df_repeat}</td>
                    <td>${round(a.SS_repeat, 6)}</td>
                    <td>${round(a.MS_repeat, 6)}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>${round(a.var_repeat, 6)}</td>
                    <td>-</td>
                </tr>
                <tr style="background-color:#f1f5f9;font-weight:600">
                    <td><strong>总计 (Total)</strong></td>
                    <td>${a.df_total}</td>
                    <td>${round(a.SS_total, 6)}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>100%</td>
                </tr>
                <tr style="background-color:#eff6ff">
                    <td colspan="7"><strong>GRR (再现性+重复性)</strong></td>
                    <td>${round(a.GRR_anova ** 2, 6)}</td>
                    <td>${round(a.percentGRR_anova, 2)}%</td>
                </tr>
                <tr style="background-color:#eff6ff">
                    <td colspan="7">　└ 重复性 (EV)</td>
                    <td>${round(a.EV_anova ** 2, 6)}</td>
                    <td>${round(a.percentEV_anova, 2)}%</td>
                </tr>
                <tr style="background-color:#eff6ff">
                    <td colspan="7">　└ 再现性 (AV, 含交互)</td>
                    <td>${round(a.AV_anova ** 2, 6)}</td>
                    <td>${round(a.percentAV_anova, 2)}%</td>
                </tr>
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

function renderVarianceChart(result) {
    const a = result.anova;
    const ctx = document.getElementById('variance-chart').getContext('2d');

    if (charts.variance) charts.variance.destroy();

    charts.variance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: [
                `重复性 (EV) - ${round(a.percentEV_anova, 2)}%`,
                `再现性 (AV) - ${round(a.percentAV_anova, 2)}%`,
                `零件变异 (PV) - ${round(a.percentPV_anova, 2)}%`
            ],
            datasets: [{
                data: [a.EV_anova ** 2, a.AV_anova ** 2, a.PV_anova ** 2],
                backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                borderColor: ['#ffffff', '#ffffff', '#ffffff'],
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: false },
                legend: { position: 'bottom', labels: { font: { size: 13 }, padding: 15 } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const total = ctx.dataset.data.reduce((s, d) => s + d, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(2);
                            return `${ctx.label.split(' - ')[0]}: 方差=${ctx.raw.toFixed(6)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderXbarRangeChart(result) {
    const { numOps, numParts, operatorMeans, cellMeans, cellRanges, partMeans } = result;

    const partLabels = Array.from({ length: numParts }, (_, i) => `P${i + 1}`);
    const opColors = ['#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#f97316'];

    const datasets_mean = [];
    const datasets_range = [];
    for (let o = 0; o < numOps; o++) {
        datasets_mean.push({
            label: `测量员 ${String.fromCharCode(65 + o)}`,
            data: cellMeans[o],
            borderColor: opColors[o % opColors.length],
            backgroundColor: opColors[o % opColors.length] + '33',
            tension: 0.2,
            pointRadius: 4,
            borderWidth: 2
        });
        datasets_range.push({
            label: `测量员 ${String.fromCharCode(65 + o)}`,
            data: cellRanges[o],
            borderColor: opColors[o % opColors.length],
            backgroundColor: opColors[o % opColors.length] + '33',
            tension: 0.2,
            pointRadius: 4,
            borderWidth: 2
        });
    }

    datasets_mean.push({
        label: '零件均值',
        data: partMeans,
        borderColor: '#1e293b',
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        tension: 0.2,
        pointRadius: 3,
        borderWidth: 2
    });

    const ctx1 = document.getElementById('xbar-chart').getContext('2d');
    if (charts.xbar) charts.xbar.destroy();
    charts.xbar = new Chart(ctx1, {
        type: 'line',
        data: { labels: partLabels, datasets: datasets_mean },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: '按零件的均值 (X-bar) 交叉图', font: { size: 14, weight: 'bold' }, padding: 10 },
                legend: { position: 'bottom' }
            },
            scales: {
                y: { title: { display: true, text: '测量值' } },
                x: { title: { display: true, text: '零件' } }
            }
        }
    });

    const ctx2 = document.getElementById('range-chart').getContext('2d');
    if (charts.range) charts.range.destroy();
    charts.range = new Chart(ctx2, {
        type: 'line',
        data: { labels: partLabels, datasets: datasets_range },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: '按零件的极差 (Range) 交叉图', font: { size: 14, weight: 'bold' }, padding: 10 },
                legend: { position: 'bottom' }
            },
            scales: {
                y: { title: { display: true, text: '极差' }, beginAtZero: true },
                x: { title: { display: true, text: '零件' } }
            }
        }
    });
}

function renderControlCharts(result) {
    const { numOps, numParts, numTrials, cellMeans, cellRanges, partMeans } = result;
    const ctrl = result.control;

    const xbarLabels = [];
    const xbarData = [];
    for (let p = 0; p < numParts; p++) {
        for (let o = 0; o < numOps; o++) {
            xbarLabels.push(`P${p + 1}-${String.fromCharCode(65 + o)}`);
            xbarData.push(cellMeans[o][p]);
        }
    }

    const rangeLabels = [];
    const rangeData = [];
    for (let p = 0; p < numParts; p++) {
        for (let o = 0; o < numOps; o++) {
            rangeLabels.push(`P${p + 1}-${String.fromCharCode(65 + o)}`);
            rangeData.push(cellRanges[o][p]);
        }
    }

    const ctx1 = document.getElementById('xbar-control-chart').getContext('2d');
    if (charts.ctrlXbar) charts.ctrlXbar.destroy();

    const ucl_x_arr = new Array(xbarData.length).fill(round(ctrl.UCL_Xbar, 4));
    const lcl_x_arr = new Array(xbarData.length).fill(round(ctrl.LCL_Xbar, 4));
    const cl_x_arr = new Array(xbarData.length).fill(round(ctrl.grandMean, 4));

    charts.ctrlXbar = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: xbarLabels,
            datasets: [
                {
                    label: '均值 X̄',
                    data: xbarData,
                    borderColor: '#3b82f6',
                    backgroundColor: '#3b82f633',
                    pointRadius: 5,
                    pointBackgroundColor: function(ctx) {
                        const v = ctx.raw;
                        return v > ctrl.UCL_Xbar || v < ctrl.LCL_Xbar ? '#ef4444' : '#3b82f6';
                    },
                    borderWidth: 2,
                    tension: 0.1
                },
                { label: `UCL = ${round(ctrl.UCL_Xbar, 4)}`, data: ucl_x_arr, borderColor: '#ef4444', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 },
                { label: `CL = ${round(ctrl.grandMean, 4)}`, data: cl_x_arr, borderColor: '#1e293b', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5 },
                { label: `LCL = ${round(ctrl.LCL_Xbar, 4)}`, data: lcl_x_arr, borderColor: '#ef4444', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `X̄ 控制图 (n=${numTrials}, A₂=${ctrl.A2})`, font: { size: 14, weight: 'bold' }, padding: 10 },
                legend: { position: 'bottom', labels: { font: { size: 11 } } }
            },
            scales: {
                y: { title: { display: true, text: '均值' } },
                x: { title: { display: true, text: '样本（零件-测量员）' }, ticks: { font: { size: 9 }, maxRotation: 90 } }
            }
        }
    });

    const ctx2 = document.getElementById('r-control-chart').getContext('2d');
    if (charts.ctrlR) charts.ctrlR.destroy();

    const ucl_r_arr = new Array(rangeData.length).fill(round(ctrl.UCL_R, 4));
    const lcl_r_arr = new Array(rangeData.length).fill(round(ctrl.LCL_R, 4));
    const cl_r_arr = new Array(rangeData.length).fill(round(ctrl.Rbar, 4));

    charts.ctrlR = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: rangeLabels,
            datasets: [
                {
                    label: '极差 R',
                    data: rangeData,
                    borderColor: '#10b981',
                    backgroundColor: '#10b98133',
                    pointRadius: 5,
                    pointBackgroundColor: function(ctx) {
                        const v = ctx.raw;
                        return v > ctrl.UCL_R || v < ctrl.LCL_R ? '#ef4444' : '#10b981';
                    },
                    borderWidth: 2,
                    tension: 0.1
                },
                { label: `UCL = ${round(ctrl.UCL_R, 4)}`, data: ucl_r_arr, borderColor: '#ef4444', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 },
                { label: `R̄ = ${round(ctrl.Rbar, 4)}`, data: cl_r_arr, borderColor: '#1e293b', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.5 },
                { label: `LCL = ${round(ctrl.LCL_R, 4)}`, data: lcl_r_arr, borderColor: '#ef4444', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `R 控制图 (n=${numTrials}, D₃=${ctrl.D3}, D₄=${ctrl.D4})`, font: { size: 14, weight: 'bold' }, padding: 10 },
                legend: { position: 'bottom', labels: { font: { size: 11 } } }
            },
            scales: {
                y: { title: { display: true, text: '极差' }, beginAtZero: true },
                x: { title: { display: true, text: '样本（零件-测量员）' }, ticks: { font: { size: 9 }, maxRotation: 90 } }
            }
        }
    });
}

function renderNDC(result) {
    const { ndc } = result;
    const container = document.getElementById('ndc-result');
    const cls = ndc >= 5 ? 'good' : 'bad';
    const msg = ndc >= 5
        ? '✓ 量具区分能力合格，能够有效识别产品间的差异。ndc ≥ 5 满足AIAG要求。'
        : '⚠ 警告：量具区分度不足 (ndc < 5)！当前量具无法有效识别产品分类。建议重新校准、更换量具或改进测量方法。';

    container.className = `ndc-result ${cls}`;
    container.innerHTML = `
        <div class="ndc-label">测量系统能识别的产品分类数 (ndc = 1.41 × PV / GRR)</div>
        <div class="ndc-value">${ndc}</div>
        <div class="ndc-label">AIAG 标准：ndc ≥ 5</div>
        <div class="ndc-message">${msg}</div>
    `;
}

function renderReport(result) {
    const a = result.anova;
    const { numOps, numParts, numTrials, percentGRR_anova, ndc, tolerance, percentGRR_tol, grandMean } = result;

    let verdict = '';
    let verdictCls = '';
    let recommendation = '';

    if (percentGRR_anova < 10 && ndc >= 5) {
        verdict = '量具可接受 (ACCEPT)';
        verdictCls = 'pass';
        recommendation = '测量系统满足AIAG MSA标准，可正常使用。';
    } else if (percentGRR_anova < 30 && ndc >= 5) {
        verdict = '量具边缘可接受 (MARGINAL)';
        verdictCls = 'marginal';
        recommendation = '根据被测特性重要性和测量成本综合判断。建议考虑改进测量系统。';
    } else {
        verdict = '量具不可接受 (UNACCEPTABLE)';
        verdictCls = 'fail';
        recommendation = '测量系统不能满足要求，必须采取改进措施：重新校准量具、培训测量员、改进测量方法或更换量具。';
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN') + ' ' + now.toLocaleTimeString('zh-CN');

    const html = `
        <div class="report-section">
            <h4>一、基本信息</h4>
            <div class="report-meta">
                <p><span>报告日期：</span>${dateStr}</p>
                <p><span>测量员数量：</span>${numOps}</p>
                <p><span>零件数量：</span>${numParts}</p>
                <p><span>重复测量次数：</span>${numTrials}</p>
                <p><span>规格公差 (Tolerance)：</span>${tolerance ? tolerance : '未提供'}</p>
                <p><span>总平均值：</span>${round(grandMean, 6)}</p>
            </div>
        </div>

        <div class="report-section">
            <h4>二、量具 R&amp;R 分析结果 (ANOVA 方法)</h4>
            <table style="width:100%;border-collapse:collapse;margin-top:10px;">
                <thead>
                    <tr style="background:#f1f5f9;">
                        <th style="border:1px solid #ddd;padding:8px;text-align:left">变异来源</th>
                        <th style="border:1px solid #ddd;padding:8px;text-align:right">标准差 (SD)</th>
                        <th style="border:1px solid #ddd;padding:8px;text-align:right">方差 (Var)</th>
                        <th style="border:1px solid #ddd;padding:8px;text-align:right">%研究变异 (%SV)</th>
                        ${tolerance ? '<th style="border:1px solid #ddd;padding:8px;text-align:right">%公差 (%Tol)</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border:1px solid #ddd;padding:8px">重复性 (EV - Equipment Variation)</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.EV_anova, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.EV_anova ** 2, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.percentEV_anova, 2)}%</td>
                        ${tolerance ? `<td style="border:1px solid #ddd;padding:8px;text-align:right">${round(result.percentEV_tol, 2)}%</td>` : ''}
                    </tr>
                    <tr>
                        <td style="border:1px solid #ddd;padding:8px">再现性 (AV - Appraiser Variation)</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.AV_anova, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.AV_anova ** 2, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.percentAV_anova, 2)}%</td>
                        ${tolerance ? `<td style="border:1px solid #ddd;padding:8px;text-align:right">${round(result.percentAV_tol, 2)}%</td>` : ''}
                    </tr>
                    <tr style="font-weight:600;background:#eff6ff;">
                        <td style="border:1px solid #ddd;padding:8px">R&amp;R 合计 (GRR)</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.GRR_anova, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.GRR_anova ** 2, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.percentGRR_anova, 2)}%</td>
                        ${tolerance ? `<td style="border:1px solid #ddd;padding:8px;text-align:right">${round(percentGRR_tol, 2)}%</td>` : ''}
                    </tr>
                    <tr>
                        <td style="border:1px solid #ddd;padding:8px">零件变异 (PV - Part Variation)</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.PV_anova, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.PV_anova ** 2, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.percentPV_anova, 2)}%</td>
                        ${tolerance ? '<td style="border:1px solid #ddd;padding:8px;text-align:right">-</td>' : ''}
                    </tr>
                    <tr style="font-weight:600;">
                        <td style="border:1px solid #ddd;padding:8px">总变异 (TV - Total Variation)</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.TV_anova, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">${round(a.TV_anova ** 2, 6)}</td>
                        <td style="border:1px solid #ddd;padding:8px;text-align:right">100.00%</td>
                        ${tolerance ? '<td style="border:1px solid #ddd;padding:8px;text-align:right">-</td>' : ''}
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="report-section">
            <h4>三、区分度分析 (Number of Distinct Categories)</h4>
            <p><strong>ndc = ${ndc}</strong>（计算公式：ndc = 1.41 × (PV / GRR)）</p>
            <p>AIAG 标准：ndc ≥ 5</p>
            <p style="margin-top:8px;"><strong>判定：</strong>${ndc >= 5 ? '合格 ✓' : '不合格 ✗（量具区分能力不足）'}</p>
        </div>

        <div class="report-section">
            <h4>四、控制图检验</h4>
            <p>X̄ 控制图：UCL = ${round(result.control.UCL_Xbar, 4)}, CL = ${round(result.control.grandMean, 4)}, LCL = ${round(result.control.LCL_Xbar, 4)}</p>
            <p>R 控制图：UCL = ${round(result.control.UCL_R, 4)}, R̄ = ${round(result.control.Rbar, 4)}, LCL = ${round(result.control.LCL_R, 4)}</p>
            <p style="margin-top:8px;"><strong>判定标准：</strong>所有点在控制限内，且无异常趋势模式，则测量过程稳定。</p>
        </div>

        <div class="report-section">
            <h4>五、最终判定与建议</h4>
            <p>AIAG 判定标准：</p>
            <ul style="padding-left:20px;margin-top:6px;">
                <li>%GRR &lt; 10%：测量系统可接受（优秀）</li>
                <li>10% ≤ %GRR &lt; 30%：测量系统边缘可接受</li>
                <li>%GRR ≥ 30%：测量系统不可接受</li>
                <li>ndc ≥ 5：量具区分能力足够</li>
            </ul>
            <div class="verdict ${verdictCls}" style="margin-top:16px;">最终判定：${verdict}</div>
            <p style="margin-top:12px;"><strong>建议：</strong>${recommendation}</p>
        </div>

        <div class="report-section" style="font-size:12px;color:#64748b;border-top:1px dashed #ccc;padding-top:12px;">
            <p>本报告依据 AIAG MSA 第四版 (Measurement Systems Analysis) 标准生成。</p>
            <p>分析方法：ANOVA（方差分析）法，同时考虑重复性、再现性及其交互作用。</p>
        </div>
    `;
    document.getElementById('report').innerHTML = html;
}

function doCalculate() {
    const result = calculateMSA();
    if (!result) return;

    document.getElementById('results').classList.remove('hidden');

    renderSummary(result);
    renderANOVA(result);
    renderVarianceChart(result);
    renderXbarRangeChart(result);
    renderControlCharts(result);
    renderNDC(result);
    renderReport(result);

    setTimeout(() => {
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
    }, 100);
}

function printReport() {
    window.print();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('generate-table').addEventListener('click', generateTable);
    document.getElementById('load-sample').addEventListener('click', loadSampleData);
    document.getElementById('clear-data').addEventListener('click', clearData);
    document.getElementById('calculate').addEventListener('click', doCalculate);
    document.getElementById('print-report').addEventListener('click', printReport);
    generateTable();
});
