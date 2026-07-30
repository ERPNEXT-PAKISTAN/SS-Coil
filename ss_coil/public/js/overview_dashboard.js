/* Live database binding for Web Page "overview" (/or). */
(() => {
  'use strict';
  const API = 'overview_dashboard_api';
  const money = (n) => Math.round(Number(n || 0)).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0});
  const total = (rows, key = 'count') => (rows || []).reduce((s, r) => s + Number(r[key] || 0), 0);
  const byStatus = (rows, statuses) => (rows || []).filter(r => statuses.includes(r.status)).reduce((s, r) => s + Number(r.count || 0), 0);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const date = (v) => v ? new Date(`${String(v).slice(0,10)}T00:00:00`).toLocaleDateString() : '—';
  const sectionCard = (title) => [...document.querySelectorAll('.section-title')].find(x => x.textContent.trim().startsWith(title))?.closest('.card');
  const pill = (status) => `<span class="pill pill-${/paid|complete|received|delivered/i.test(status)?'green':/cancel|stop|overdue/i.test(status)?'red':/draft|pending|process|bill|receive|deliver/i.test(status)?'amber':'blue'}">${esc(status || 'Unknown')}</span>`;
  const chartValueLabels={id:'overviewValueLabels',afterDatasetsDraw(chart){const {ctx}=chart;ctx.save();ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--text').trim()||'#e2e8f0';ctx.font='700 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';chart.data.datasets.forEach((set,di)=>chart.getDatasetMeta(di).data.forEach((point,i)=>{const value=Number(set.data[i]||0);if(value)ctx.fillText(money(value),point.x,Math.max(10,point.y-4-(di%3)*10));}));ctx.restore();}};

  function installControls() {
    if (document.getElementById('overview-controls')) return;
    const now=new Date(), first=new Date(now.getFullYear(),now.getMonth(),1), iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, urlParams=new URLSearchParams(location.search), fromValue=urlParams.get('from_date')||iso(first), toValue=urlParams.get('to_date')||iso(now);
    const style=document.createElement('style');style.textContent=`
      #overview-controls{margin-left:auto;padding:0;background:transparent;border:0;display:flex;align-items:center;gap:8px;transition:.2s;white-space:nowrap}
      #overview-controls input{background:var(--bg3);color:var(--text);border:1px solid var(--border2);border-radius:7px;padding:5px 8px;font-size:11px;width:132px}
      header .nav-tabs{margin-left:28px}
      .kpi-card .kpi-value,.kpi-card .counter{font-size:30px!important;line-height:1.12!important;font-weight:800!important;letter-spacing:-.7px;color:#38bdf8!important;font-variant-numeric:tabular-nums;text-shadow:0 0 18px rgba(56,189,248,.15)}
      .kpi-card:nth-child(4n+2) .kpi-value,.kpi-card:nth-child(4n+2) .counter{color:#34d399!important;text-shadow:0 0 18px rgba(52,211,153,.15)}
      .kpi-card:nth-child(4n+3) .kpi-value,.kpi-card:nth-child(4n+3) .counter{color:#fbbf24!important;text-shadow:0 0 18px rgba(251,191,36,.15)}
      .kpi-card:nth-child(4n+4) .kpi-value,.kpi-card:nth-child(4n+4) .counter{color:#a78bfa!important;text-shadow:0 0 18px rgba(167,139,250,.15)}
      .kpi-card .kpi-label{font-size:11px!important;font-weight:700!important;letter-spacing:.45px}
      .kpi-live-trend{margin-top:7px}.kpi-trend-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--text3)}
      .kpi-trend-pct{font-weight:800}.kpi-trend-pct.up{color:#10b981}.kpi-trend-pct.down{color:#ef4444}.kpi-trend-pct.flat{color:var(--text3)}
      .kpi-live-spark{display:block;width:100%;height:18px;margin-top:2px;overflow:visible}.kpi-live-spark .area{fill:color-mix(in srgb,currentColor 5%,transparent)}.kpi-live-spark .line{fill:none;stroke:currentColor;stroke-width:1;stroke-linecap:round;vector-effect:non-scaling-stroke}.kpi-live-spark circle{fill:var(--bg2);stroke:currentColor;stroke-width:1;vector-effect:non-scaling-stroke}
      #financial-statements-card{background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important}#financial-statements-card>.financial-statement-grid>div{background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:18px;box-shadow:0 4px 18px rgba(0,0,0,.08)}
      #finished-production-matrix .scroll-x{overflow-x:auto}#finished-production-matrix table{width:100%!important;min-width:980px!important;table-layout:fixed;font-size:10px}#finished-production-matrix th,#finished-production-matrix td{padding:7px 3px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#finished-production-matrix th:first-child,#finished-production-matrix td:first-child{width:175px!important;white-space:normal}#finished-production-matrix th:nth-child(2),#finished-production-matrix td:nth-child(2){width:55px!important}
      .chart-toggle{display:flex;gap:4px;padding:3px;background:var(--bg3);border:1px solid var(--border);border-radius:8px}.chart-toggle button{border:0;background:transparent;color:var(--text3);padding:5px 9px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer}.chart-toggle button.active{background:var(--accent);color:#fff;box-shadow:0 2px 8px rgba(59,130,246,.25)}
      .doc-flow{justify-content:center!important;align-items:center!important;gap:10px!important;margin-inline:auto}.doc-flow .doc-node{flex:0 1 125px;min-width:105px;max-width:140px}.doc-flow .doc-arrow{flex:0 0 auto}
      body[data-overview-theme="light"]{--bg:#eef3f9;--bg2:#fff;--bg3:#e8eff7;--border:rgba(30,64,100,.13);--border2:rgba(30,64,100,.25);--text:#172033;--text2:#53657d;--text3:#718198;--glow:rgba(37,99,235,.12);background:var(--bg)!important}
      body[data-overview-theme="light"] header{background:rgba(255,255,255,.95)!important}body[data-overview-theme="light"] .card,body[data-overview-theme="light"] .kpi-card{box-shadow:0 4px 18px rgba(30,64,100,.07)}
      body[data-overview-theme="light"] .kpi-card .kpi-value,body[data-overview-theme="light"] .kpi-card .counter{text-shadow:none}
    `;document.head.appendChild(style);
    const bar=document.createElement('div');bar.id='overview-controls';bar.innerHTML=`<i class="ti ti-calendar" style="color:var(--accent)"></i><input id="overview-from" type="date" title="From date" aria-label="From date" value="${fromValue}"><span style="color:var(--text3)">→</span><input id="overview-to" type="date" title="To date" aria-label="To date" value="${toValue}"><button id="overview-theme-toggle" class="header-btn" title="Switch black / white theme" aria-label="Switch color theme"></button>`;
    const pageHeader=document.querySelector('header'),headerRight=document.querySelector('.header-right');
	if(pageHeader)pageHeader.insertBefore(bar,headerRight||null);
    const saved=localStorage.getItem('overview-theme')||'light';document.body.dataset.overviewTheme=saved;
	const themeButton=document.getElementById('overview-theme-toggle'),setThemeIcon=()=>themeButton.innerHTML=`<i class="ti ${document.body.dataset.overviewTheme==='light'?'ti-moon':'ti-sun'}"></i>`;
	themeButton.onclick=()=>{const next=document.body.dataset.overviewTheme==='light'?'dark':'light';document.body.dataset.overviewTheme=next;localStorage.setItem('overview-theme',next);setThemeIcon();};setThemeIcon();
	if(headerRight)headerRight.remove();
	// The static shell is layout only. Never expose its sample values while live data loads.
	document.querySelectorAll('.kpi-card .counter').forEach(el=>{const clean=el.cloneNode(false);clean.textContent='—';delete clean.dataset.target;el.replaceWith(clean);});
	document.querySelectorAll('.kpi-card .kpi-change').forEach(el=>el.remove());
	document.querySelectorAll('.kpi-sparkline').forEach(el=>el.style.display='none');
	document.querySelectorAll('.data-table tbody').forEach(body=>body.innerHTML=`<tr><td colspan="20" style="padding:24px;text-align:center;color:var(--text3)">Loading records…</td></tr>`);
	document.querySelectorAll('.pipe-count,.doc-count,.step-metric .val,.fin-value').forEach(el=>el.textContent='—');
	document.querySelectorAll('.machine-grid').forEach(el=>el.innerHTML='<div style="color:var(--text3)">Loading status…</div>');
	document.querySelectorAll('.prog-bar-fill,.fin-bar-fill').forEach(el=>el.style.width='0');
	if(typeof Chart!=='undefined')document.querySelectorAll('canvas').forEach(canvas=>{Chart.getChart(canvas)?.destroy();const ctx=canvas.getContext?.('2d');ctx?.clearRect(0,0,canvas.width,canvas.height);});
	let filterTimer;bar.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(load,250);}));
	document.querySelectorAll('.btn-sm').forEach(btn=>{if(btn.textContent.trim()==='Filter')btn.remove();});
  }

  function wireCreateButtons() {
    const routes={'New Order':'/app/sales-order/new-sales-order-1','New SO':'/app/sales-order/new-sales-order-1','New DN':'/app/delivery-note/new-delivery-note-1','New PO':'/app/purchase-order/new-purchase-order-1','New PR':'/app/purchase-receipt/new-purchase-receipt-1'};
    document.querySelectorAll('button').forEach(btn=>{const label=btn.textContent.replace('+','').trim();if(routes[label])btn.onclick=()=>location.href=routes[label];});
  }

  function renderTable(title, rowsHtml, colspan) {
    const tbody = sectionCard(title)?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = rowsHtml || `<tr><td colspan="${colspan}" style="padding:28px;text-align:center;color:var(--text3)">No records found for the selected dates</td></tr>`;
  }

  function renderAllDetails(d) {
    let monthlySalesCard=document.getElementById('sales-monthly-chart-card');
    if(!monthlySalesCard){monthlySalesCard=document.createElement('div');monthlySalesCard.id='sales-monthly-chart-card';monthlySalesCard.className='card';const salesSection=document.getElementById('sec-sales'),salesKpis=salesSection?.querySelector('.kpi-grid');if(salesKpis)salesKpis.insertAdjacentElement('afterend',monthlySalesCard);else salesSection?.prepend(monthlySalesCard);}
    if(monthlySalesCard)monthlySalesCard.innerHTML='<div class="section-hdr"><div class="section-title"><i class="ti ti-chart-bar"></i><span id="sales-chart-title">Month-wise Sales</span></div><div class="chart-toggle"><button type="button" data-sales-view="month" class="active">Months</button><button type="button" data-sales-view="customer">Customer Groups</button></div></div><div style="height:300px;position:relative"><canvas id="salesMonthlyChart" role="img" aria-label="Sales analysis bar chart"></canvas></div>';
    const drawSalesChart=view=>{
      const title=document.getElementById('sales-chart-title'),monthRows=d.sales.months||[],groupRows=d.sales.customer_group_months||[];
      let labels,datasets;
      if(view==='customer'){
        const monthKeys=[...new Set(groupRows.map(x=>x.month_key))],groups=[...new Set(groupRows.map(x=>x.customer_group))],palette=['#10b981','#3b82f6','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#f97316'];
        labels=monthKeys.map(key=>groupRows.find(x=>x.month_key===key)?.label||key);
        datasets=groups.map((group,i)=>({label:group,data:monthKeys.map(key=>Number(groupRows.find(x=>x.month_key===key&&x.customer_group===group)?.value||0)),backgroundColor:`${palette[i%palette.length]}40`,borderColor:palette[i%palette.length],borderWidth:1.3,borderRadius:5,maxBarThickness:44}));
      }else{labels=monthRows.map(x=>x.label);datasets=[{label:`Sales (${d.currency})`,data:monthRows.map(x=>Number(x.revenue||0)),backgroundColor:'rgba(59,130,246,.28)',borderColor:'#3b82f6',borderWidth:1.5,borderRadius:6,maxBarThickness:64}];}
      if(title)title.textContent=view==='customer'?'Monthly Sales by Customer Group':'Month-wise Sales';
      monthlySalesCard?.querySelectorAll('[data-sales-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.salesView===view));
      replaceChart('salesMonthlyChart',{type:'bar',plugins:[chartValueLabels],data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:28}},plugins:{legend:{display:view==='customer',position:'bottom',labels:{color:'#64748b',usePointStyle:true,boxWidth:8}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${d.currency} ${money(ctx.raw)}`}}},scales:{x:{offset:true,grid:{display:false},ticks:{align:'center',color:'#64748b',autoSkip:false,maxRotation:25,minRotation:0}},y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>money(v)},grid:{color:'rgba(148,163,184,.10)'}}}}});
    };
    monthlySalesCard?.querySelectorAll('[data-sales-view]').forEach(btn=>btn.onclick=()=>drawSalesChart(btn.dataset.salesView));drawSalesChart('month');
    renderTable('Recent Sales Orders', (d.sales.recent_orders||[]).map(r => `<tr><td class="td-bold">${esc(r.name)}</td><td>${esc(r.customer)}</td><td>${esc(r.item)}</td><td>${money(r.qty)}</td><td>${esc(d.currency)} ${money(r.amount)}</td><td>${pill(r.status)}</td><td>${date(r.transaction_date)}</td></tr>`).join(''), 7);
    renderTable('Delivery Note & Invoice Tracker', (d.sales.deliveries||[]).map(r => `<tr><td class="td-bold">${esc(r.name)}</td><td>${esc(r.sales_order||'—')}</td><td>${esc(r.customer)}</td><td>${esc(r.item)} / ${money(r.qty)}</td><td>—</td><td>—</td><td>${pill(r.status)}</td><td>—</td><td>${date(r.posting_date)}</td></tr>`).join(''), 9);
    renderTable('Purchase Orders', (d.purchases.recent_orders||[]).map(r => `<tr><td class="td-bold">${esc(r.name)}</td><td>${esc(r.supplier)}</td><td>${esc(r.item)}</td><td>${money(r.qty)}</td><td>${esc(d.currency)} ${money(r.amount)}</td><td>${pill(r.status)}</td></tr>`).join(''), 6);
	let receiptCard=document.getElementById('purchase-receipts-card');if(!receiptCard){receiptCard=document.createElement('div');receiptCard.id='purchase-receipts-card';receiptCard.className='card';document.getElementById('sec-purchase')?.appendChild(receiptCard);}
	receiptCard.innerHTML=`<div class="section-hdr"><div class="section-title"><i class="ti ti-package-import"></i>Purchase Receipts</div><button class="btn-sm primary" data-create-doctype="Purchase Receipt"><i class="ti ti-plus"></i>New PR</button></div><div class="scroll-x"><table class="data-table"><thead><tr><th>Receipt #</th><th>Supplier</th><th>Item</th><th>Qty</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${(d.purchases.receipts||[]).map(r=>`<tr><td class="td-bold">${esc(r.name)}</td><td>${esc(r.supplier)}</td><td>${esc(r.item)}</td><td>${money(r.qty)}</td><td>${esc(d.currency)} ${money(r.amount)}</td><td>${pill(r.status)}</td><td>${date(r.posting_date)}</td></tr>`).join('')||'<tr><td colspan="7" style="padding:28px;text-align:center;color:var(--text3)">No Purchase Receipts for the selected dates</td></tr>'}</tbody></table></div>`;
	wireCreateButtons();
    renderTable('Active Work Orders', (d.production.work_orders||[]).map(r => { const pct=r.target?Math.min(100,Number(r.actual||0)/Number(r.target)*100):0; return `<tr><td class="td-bold">${esc(r.job_no)}</td><td>${esc(r.operation)}</td><td>${money(r.target)}</td><td><div class="prog-bar-track" style="width:120px"><div class="prog-bar-fill" style="width:${Math.round(pct)}%;background:#10b981"></div></div><div style="font-size:10px;color:var(--text3);margin-top:2px">${Math.round(pct)}% actual</div></td><td>${pill(r.status)}</td></tr>`; }).join(''), 5);
	const workTitle=[...document.querySelectorAll('.section-title')].find(x=>x.textContent.trim()==='Active Work Orders');if(workTitle)workTitle.innerHTML='<i class="ti ti-list-check"></i>Recent Coil Jobs';
    renderTable('Trial Balance Snapshot', (d.trial_balance||[]).map(r => `<tr><td class="td-bold">${esc(r.account)}</td><td>${esc(r.type)}</td><td>${money(r.debit)}</td><td>${money(r.credit)}</td><td>${money(r.balance)} ${Number(r.balance)>=0?'Dr':'Cr'}</td></tr>`).join(''), 5);

    const machineGrid = document.querySelector('#sec-production .machine-grid');
    if (machineGrid) machineGrid.innerHTML = (d.production.machines||[]).map(m => `<div class="machine-card"><div class="m-icon">⚙️</div><div class="m-name">${esc(m.machine||'Unassigned')}</div><div class="m-status">${pill(Number(m.active)>0?'Active':'No active job')}</div><div style="font-size:11px;color:var(--text2)">${Number(m.jobs)} jobs · ${Number(m.completed)} completed</div><div class="machine-eff"><div class="machine-eff-fill" style="width:${m.jobs?Number(m.completed)/Number(m.jobs)*100:0}%;background:#10b981"></div></div><div class="machine-temp"><span>ERP job completion</span><span>${m.jobs?Math.round(Number(m.completed)/Number(m.jobs)*100):0}%</span></div></div>`).join('') || '<div style="color:var(--text3)">No machines assigned in SS Coil jobs.</div>';
    const machineBadge = sectionCard('Machine Status')?.querySelector('.live-badge');
    if (machineBadge) machineBadge.innerHTML='<span class="live-dot"></span>ERP job status';

    let operationsCard=document.getElementById('operations-status-card');
    if(!operationsCard){operationsCard=document.createElement('div');operationsCard.id='operations-status-card';operationsCard.className='card';const machineCard=sectionCard('Machine Status');machineCard?.insertAdjacentElement('afterend',operationsCard);}
    if(operationsCard){const operations=d.production.operations||[];operationsCard.innerHTML=`<div class="section-hdr"><div class="section-title"><i class="ti ti-route"></i>Operations</div><span class="section-badge">Selected period</span></div><div class="machine-grid">${operations.map(o=>{const pct=o.jobs?Number(o.completed)/Number(o.jobs)*100:0;return `<div class="machine-card"><div class="m-icon"><i class="ti ti-tool"></i></div><div class="m-name">${esc(o.operation)}</div><div class="m-status">${pill(Number(o.active)>0?'Active':Number(o.completed)>0?'Completed':'No active job')}</div><div style="font-size:11px;color:var(--text2)">${money(o.jobs)} jobs · ${money(o.completed)} completed</div><div class="machine-eff"><div class="machine-eff-fill" style="width:${Math.min(100,pct)}%;background:#06b6d4"></div></div><div class="machine-temp"><span>Completion</span><span>${Math.round(pct)}%</span></div></div>`;}).join('')||'<div style="color:var(--text3)">No operations found for the selected dates.</div>'}</div>`;}

    const steps = document.querySelectorAll('#sec-production .process-step .step-metric');
    const stepValues = [[d.stock.items,'stock items'],[d.production.in_progress,'active jobs'],[d.production.completed,'completed'],[d.production.in_progress,'jobs'],[d.production.in_progress,'jobs'],[d.production.completed,'completed'],[d.documents.delivery_notes_today,'today']];
    steps.forEach((el,i) => { if(stepValues[i]) el.innerHTML=`<div class="val">${stepValues[i][0]}</div><div class="unit">${stepValues[i][1]}</div>`; });
    const oee = sectionCard('OEE Gauge');
    if (oee) oee.innerHTML='<div class="section-hdr"><div class="section-title"><i class="ti ti-chart-bar"></i>OEE Gauge</div></div><div style="padding:28px;text-align:center;color:var(--text3)"><i class="ti ti-plug-connected-x" style="font-size:28px"></i><div style="margin-top:8px">No machine telemetry/OEE source is configured in ERP</div></div>';

    const salesProgress = document.querySelectorAll('#sec-sales .prog-bar-wrap');
    const soCount=total(d.sales.orders), dn=d.documents.delivery_notes_month, inv=d.documents.sales_invoices_month, pay=d.documents.payment_entries_month;
    [[soCount?dn/soCount*100:0,'Sales Order → Delivery Note'],[dn?inv/dn*100:0,'Delivery Note → Invoice'],[inv?pay/inv*100:0,'Invoice → Payment']].forEach((x,i)=>{const el=salesProgress[i];if(!el)return;el.querySelector('.prog-bar-header').innerHTML=`<span>${x[1]}</span><span>${Math.round(x[0])}%</span>`;el.querySelector('.prog-bar-fill').style.width=`${Math.min(100,x[0])}%`;});

    const purchaseCard=sectionCard('Purchase by Category');
    if(purchaseCard){const rows=d.purchases.categories||[], sum=total(rows,'value'); purchaseCard.querySelectorAll('.prog-bar-wrap').forEach(x=>x.remove()); rows.forEach(r=>{const pct=sum?Number(r.value)/sum*100:0;purchaseCard.insertAdjacentHTML('beforeend',`<div class="prog-bar-wrap"><div class="prog-bar-header"><span>${esc(r.label)}</span><span>${Math.round(pct)}%</span></div><div class="prog-bar-track"><div class="prog-bar-fill" style="width:${pct}%;background:#f97316"></div></div></div>`);});}

    const attendanceCard=sectionCard('Attendance & Leave Today');
    if(attendanceCard){attendanceCard.querySelectorAll('.prog-bar-wrap').forEach(x=>x.remove());(d.hr.attendance_departments||[]).forEach(r=>{const pct=r.employees?Number(r.present)/Number(r.employees)*100:0;attendanceCard.insertAdjacentHTML('beforeend',`<div class="prog-bar-wrap"><div class="prog-bar-header"><span>${esc(r.label)}</span><span>${r.present}/${r.employees} (${pct.toFixed(0)}%)</span></div><div class="prog-bar-track"><div class="prog-bar-fill" style="width:${pct}%;background:#10b981"></div></div></div>`);});}
    const payrollTitle=[...document.querySelectorAll('.section-title')].find(x=>x.textContent.includes('Payroll Summary'));
    if(payrollTitle){payrollTitle.innerHTML='<i class="ti ti-cash"></i>Payroll Summary – Current Period';const box=payrollTitle.closest('.card'), labels=box.querySelectorAll('[style*="font-size:10px"]'),vals=box.querySelectorAll('[style*="font-size:18px"]'),p=d.documents.payroll||{};['Gross Pay','Deductions','Net Pay'].forEach((v,i)=>{if(labels[i])labels[i].textContent=v;});[p.gross,p.deductions,p.net].forEach((v,i)=>{if(vals[i])vals[i].textContent=money(v);});}

    const finVals=document.querySelectorAll('#sec-finance .fin-value');
    [d.finance.receivable,d.finance.payable,d.finance.bank_balance,d.finance.stock_value].forEach((v,i)=>{if(finVals[i])finVals[i].textContent=`${d.currency} ${money(v)}`;});
    document.querySelectorAll('#sec-finance .fin-change').forEach(el=>el.style.display='none');
    document.querySelectorAll('#sec-finance .fin-bar').forEach(el=>el.style.display='none');
    const statementCard=document.getElementById('financial-statements-card')||sectionCard('Trial Balance Snapshot');
	if(statementCard){
	  statementCard.id='financial-statements-card';
	  const normal=r=>['Income','Liability','Equity'].includes(r.root_type)?-Number(r.balance||0):Number(r.balance||0);
	  const tree=(title,allRows,showProfit)=>{
	    const rows=allRows.filter(r=>Number(r.depth)===0||Math.abs(Number(r.balance||0))>=0.5);
	    const rootRows=allRows.filter(r=>Number(r.depth)===0);
	    const income=rootRows.filter(r=>r.root_type==='Income').reduce((s,r)=>s+normal(r),0);
	    const expense=rootRows.filter(r=>r.root_type==='Expense').reduce((s,r)=>s+normal(r),0);
	    const firstExpenseGroups=allRows.filter(r=>r.root_type==='Expense'&&Number(r.depth)===1&&Number(r.is_group));
	    const rowStyle=r=>{
	      if(Number(r.depth)===0)return 'background:var(--bg3);font-weight:700;border-radius:7px';
	      if(r.root_type==='Expense'&&Number(r.depth)===1&&Number(r.is_group))return `background:${firstExpenseGroups.indexOf(r)%2===0?'rgba(59,130,246,.13)':'rgba(245,158,11,.13)'};font-weight:700;border-radius:6px`;
	      return Number(r.is_group)?'font-weight:650':'';
	    };
	    return `<div><div class="section-title" style="margin-bottom:14px"><i class="ti ti-report-money"></i>${title}</div>${rows.map(r=>`<div style="display:flex;justify-content:space-between;padding:8px 10px 8px ${10+Number(r.depth||0)*20}px;border-bottom:1px solid var(--border);${rowStyle(r)}"><span>${esc(r.account_name)}</span><span>${esc(d.currency)} ${money(normal(r))}</span></div>`).join('')}${showProfit?`<div style="display:flex;justify-content:space-between;margin-top:12px;padding:11px;background:${income-expense>=0?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)'};border-radius:8px;font-weight:800"><span>Net Profit / Loss</span><span>${esc(d.currency)} ${money(income-expense)}</span></div>`:''}</div>`;
	  };
	  statementCard.innerHTML=`<div class="financial-statement-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${tree('Profit and Loss',d.profit_loss_hierarchy||[],true)}${tree('Balance Sheet',d.balance_sheet_hierarchy||[],false)}</div>`;
	}
	const plCard=sectionCard('P&L Trend'),accountCard=sectionCard('Account Balances');if(plCard&&accountCard&&plCard.parentElement===accountCard.parentElement){plCard.parentElement.style.gridTemplateColumns='3fr 2fr';plCard.style.gridColumn='1';accountCard.style.gridColumn='2';}

	const hrTop=document.querySelector('#sec-hr > div:first-child');if(hrTop){hrTop.style.gridTemplateColumns='repeat(5,1fr)';let checkin=document.getElementById('employee-checkin-kpi');if(!checkin){checkin=document.createElement('div');checkin.id='employee-checkin-kpi';checkin.className='kpi-card';hrTop.appendChild(checkin);}checkin.innerHTML=`<i class="ti ti-fingerprint kpi-icon"></i><div class="kpi-label">Employee Checkins</div><div class="kpi-value">${money(d.documents.employee_checkins)}</div>`;}

    let matrix=document.getElementById('finished-production-matrix');if(!matrix){matrix=document.createElement('div');matrix.id='finished-production-matrix';matrix.className='card';const productionSection=document.getElementById('sec-production');productionSection?.insertBefore(matrix,productionSection.firstElementChild);}
    const fg=d.production.finished_goods||[], toDate=new Date(`${d.filters.to_date}T00:00:00`), days=Array.from({length:toDate.getDate()},(_,i)=>i+1), items=[...new Set(fg.map(x=>x.item_code))], monthLabel=toDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    matrix.innerHTML=`<div class="section-hdr"><div class="section-title"><i class="ti ti-packages"></i>Finished-Goods Production Matrix — ${monthLabel}</div><span class="section-badge">Stock Entry · Finished Items</span></div><div class="scroll-x"><table class="data-table"><thead><tr><th>Item</th><th>Tot</th>${days.map(x=>`<th style="text-align:center">${x}</th>`).join('')}</tr></thead><tbody>${items.map(code=>{const rows=fg.filter(x=>x.item_code===code),name=rows[0]?.item_name||code,uom=rows[0]?.uom||'',vals=days.map(day=>rows.filter(x=>Number(String(x.posting_date).slice(8,10))===day).reduce((s,x)=>s+Number(x.qty||0),0)),sum=vals.reduce((a,b)=>a+b,0);return `<tr><td class="td-bold" title="${esc(name)} · ${esc(code)}">${esc(name)}<div class="td-sub">${esc(code)} · ${esc(uom)}</div></td><td class="td-bold">${money(sum)}</td>${vals.map(v=>`<td style="text-align:center">${v?money(v):''}</td>`).join('')}</tr>`;}).join('')||`<tr><td colspan="${days.length+2}" style="padding:28px;text-align:center;color:var(--text3)">No submitted finished-goods Stock Entries for ${monthLabel} through day ${toDate.getDate()}</td></tr>`}</tbody></table></div>`;

    const colors=['#3b82f6','#06b6d4','#f59e0b','#8b5cf6','#10b981','#f97316'];
    replaceChart('revenueChart',{type:'bar',plugins:[chartValueLabels],data:{labels:(d.sales.top_products||[]).map(x=>x.label),datasets:[{data:(d.sales.top_products||[]).map(x=>x.value),backgroundColor:colors.map(x=>x+'40'),borderColor:colors,borderWidth:2,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:24}},plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b'}},y:{ticks:{color:'#64748b',callback:v=>money(v)}}}}});
    replaceChart('purchaseChart',{type:'bar',plugins:[chartValueLabels],data:{labels:(d.purchases.categories||[]).map(x=>x.label),datasets:[{data:(d.purchases.categories||[]).map(x=>x.value),backgroundColor:'#f9731640',borderColor:'#f97316',borderWidth:2,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:24}},plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b'}},y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>money(v)}}}}});
    const pl=d.pl_months||[];replaceChart('plChart',{type:'line',plugins:[chartValueLabels],data:{labels:pl.map(x=>x.label),datasets:[{label:'Income',data:pl.map(x=>x.income),borderColor:'#10b981',pointRadius:3},{label:'Expense',data:pl.map(x=>x.expense),borderColor:'#ef4444',pointRadius:3},{label:'Profit',data:pl.map(x=>Number(x.income)-Number(x.expense)),borderColor:'#8b5cf6',pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:30}},plugins:{legend:{labels:{color:'#94a3b8'}}},scales:{x:{ticks:{color:'#64748b'}},y:{ticks:{color:'#64748b',callback:v=>money(v)}}}}});
  }

  function setKpi(label, value, suffix = '') {
    const card = [...document.querySelectorAll('.kpi-card')].find(c => c.querySelector('.kpi-label')?.textContent.trim() === label);
    if (!card) return;
    const counter = card.querySelector('.counter');
    const target = counter || card.querySelector('.kpi-value');
    if (counter) {
      value = Math.round(Number(value || 0));
      counter.dataset.target = value;
      counter.dataset.decimals = '0';
      counter.textContent = money(value);
    } else if (target) target.textContent = `${value}${suffix}`;
    if (suffix && counter) {
      let unit = counter.nextElementSibling;
      if (unit) unit.textContent = suffix;
    }
  }

  function updateKpiVisuals(previous) {
    const inverse = new Set(['Cost of Goods Sold','Outstanding Bills','Payables Due','Leave Applications']);
    document.querySelectorAll('.kpi-card').forEach(card => {
      card.querySelectorAll('.kpi-change,.kpi-live-trend').forEach(el => el.remove());
      const oldSpark=card.querySelector('.kpi-sparkline');if(oldSpark)oldSpark.style.display='none';
      const label=card.querySelector('.kpi-label')?.textContent.trim()||'';
      const valueEl=card.querySelector('.counter,.kpi-value');
      const current=Number(valueEl?.dataset.target ?? String(valueEl?.textContent||'').replace(/[^0-9.-]/g,''))||0;
      const hasPrevious=Object.prototype.hasOwnProperty.call(previous||{},label), prior=hasPrevious?Number(previous[label]||0):null;
      let pct=null;if(hasPrevious&&prior!==0)pct=((current-prior)/Math.abs(prior))*100;
      const favourable=pct===null?null:(inverse.has(label)?pct<=0:pct>=0), cls=pct===null?'flat':(favourable?'up':'down');
      const arrow=pct===null?'●':pct>0?'▲':pct<0?'▼':'●', caption=pct===null?'Current live value':`${arrow} ${Math.abs(pct).toFixed(1)}% vs previous period`;
      const points=hasPrevious?[prior,current]:[current,current], lo=Math.min(...points), hi=Math.max(...points), span=Math.max(hi-lo,1);
      const ys=points.map(v=>25-((v-lo)/span)*18), path=`M 2 ${ys[0]} L 98 ${ys[1]}`, area=`${path} L 98 29 L 2 29 Z`;
      const visual=document.createElement('div');visual.className='kpi-live-trend';visual.innerHTML=`<div class="kpi-trend-row"><span>Current</span><span class="kpi-trend-pct ${cls}">${caption}</span></div><svg class="kpi-live-spark" viewBox="0 0 100 31" preserveAspectRatio="none" role="img" aria-label="${hasPrevious?'Previous period to current value':'Current value'}"><path class="area" d="${area}"></path><path class="line" d="${path}"></path><circle cx="2" cy="${ys[0]}" r="1"></circle><circle cx="98" cy="${ys[1]}" r="1"></circle></svg>`;
      card.appendChild(visual);
    });
  }

  function replaceChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return;
    Chart.getChart(canvas)?.destroy();
    new Chart(canvas, config);
  }

  function setFlowValues(d, so, si) {
    const active = byStatus(so, ['To Deliver and Bill','To Deliver','To Bill','On Hold']);
    const values = {
      'Sales Orders': total(so), 'Confirmed': active,
      'Dispatch Ready': d.documents.delivery_notes_month,
      'Invoiced': d.documents.sales_invoices_month,
      'Payment Received': d.documents.payment_entries_month,
      'Sales Order': total(so), 'Work Order': d.production.jobs,
      'Delivery Note': d.documents.delivery_notes_month,
      'Sales Invoice': d.documents.sales_invoices_month,
      'Payment Entry': d.documents.payment_entries_month
    };
    document.querySelectorAll('.pipe-stage').forEach(stage => {
      const label = stage.querySelector('.pipe-label')?.textContent.trim();
      if (label in values) stage.querySelector('.pipe-count').textContent = values[label];
      const sub = stage.querySelector('.pipe-sub');
      if (sub) sub.textContent = '';
    });
    document.querySelectorAll('.doc-node').forEach(node => {
      const label = node.querySelector('.doc-title')?.textContent.trim();
      if (label in values) node.querySelector('.doc-count').textContent = values[label];
      const status = node.querySelector('.doc-status');
      if (status) status.textContent = '';
    });
  }

  function clearSampleAlerts() {
    const title = [...document.querySelectorAll('.section-title')].find(x => x.textContent.trim() === 'Alerts');
    const card = title?.closest('.card');
    if (!card) return;
    card.querySelectorAll('.alert-item').forEach(x => x.remove());
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px;color:var(--text2);text-align:center';
    empty.innerHTML = '<i class="ti ti-database-check" style="font-size:24px;color:var(--green)"></i><div style="margin-top:8px">No ERP alerts for the selected dates</div>';
    card.appendChild(empty);
  }

  function apply(d) {
    const so = d.sales.orders || [], si = d.sales.invoices || [], po = d.purchases.orders || [];
	const companyName=document.querySelector('.logo-text');if(companyName)companyName.textContent=d.company||'ERP';
	document.querySelectorAll('.section-badge').forEach(el=>{if(el.textContent.trim()==='Live Tracking')el.remove();});
    const revenue = total(si, 'amount');
    const activeOrders = byStatus(so, ['To Deliver and Bill','To Deliver','To Bill','On Hold']);
    const efficiency = d.production.jobs ? (d.production.completed / d.production.jobs) * 100 : 0;
    setKpi('Monthly Revenue', revenue, d.currency);
    setKpi('Orders in Pipeline', activeOrders);
    setKpi('Dispatched Today', d.documents.delivery_notes_today, 'loads');
    setKpi('Production Efficiency', efficiency, '%');
    setKpi('Outstanding Bills', d.finance.receivable, d.currency);
    setKpi('Workforce Active', d.hr.present);
    setKpi('Open Sales Orders', activeOrders);
    setKpi('Delivery Notes', d.documents.delivery_notes_month);
    setKpi('Sales Invoices', d.documents.sales_invoices_month);
    setKpi('Payments Received', d.documents.payments_received_month, d.currency);
    setKpi('Purchase Orders', total(po));
    setKpi('Receipts (GRN)', d.documents.purchase_receipts_month);
    setKpi('Purchase Invoices', d.documents.purchase_invoices_month);
    setKpi('Payables Due', d.finance.payable, d.currency);
    setKpi('Total Employees', d.hr.employees);
    setKpi('Present Today', d.hr.present);
    setKpi('Monthly Payroll', d.documents.payroll_month, d.currency);
    setKpi('Leave Applications', d.documents.leave_applications_month);
    setKpi('Net Revenue (MTD)', revenue, d.currency);
    const cogs = Math.max(0, Number(d.finance.cogs || 0));
    setKpi('Cost of Goods Sold', cogs, d.currency);
    const plRoots=(d.profit_loss_hierarchy||[]).filter(r=>Number(r.depth)===0),plIncome=plRoots.filter(r=>r.root_type==='Income').reduce((s,r)=>s-Number(r.balance||0),0),plExpense=plRoots.filter(r=>r.root_type==='Expense').reduce((s,r)=>s+Number(r.balance||0),0);
	const profitLabel=[...document.querySelectorAll('#sec-finance .kpi-label')].find(el=>['Gross Profit','Net Profit'].includes(el.textContent.trim()));if(profitLabel)profitLabel.textContent='Net Profit';
    setKpi('Net Profit', plIncome-plExpense, d.currency);
    setKpi('Cash Position', Number(d.finance.bank_balance || 0), d.currency);
	updateKpiVisuals(d.previous||{});
	const requestedSection = new URLSearchParams(location.search).get('section');
	if (requestedSection && document.getElementById(`sec-${requestedSection}`)) {
	  document.querySelectorAll('.page-section').forEach(el => el.classList.toggle('active', el.id === `sec-${requestedSection}`));
	  document.querySelectorAll('.nav-tab').forEach(el => el.classList.toggle('active', el.textContent.trim().toLowerCase().startsWith(requestedSection)));
	  setTimeout(() => Object.values(Chart.instances || {}).forEach(chart => chart.resize()), 50);
	}

    const live = document.querySelector('.live-badge');
    if (live) live.innerHTML = `<span class="live-dot"></span>${new Date(d.generated_at).toLocaleTimeString()}`;

    const labels = d.sales.months.map(x => x.label);
	setFlowValues(d, so, si);
	clearSampleAlerts();
    replaceChart('revenueChart', {type:'bar', data:{labels, datasets:[{label:`Revenue (${d.currency})`,data:d.sales.months.map(x=>x.revenue),backgroundColor:'#3b82f640',borderColor:'#3b82f6',borderWidth:2,borderRadius:6}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b'}},y:{ticks:{color:'#64748b',callback:v=>money(v)}}}}});
    replaceChart('hrChart', {type:'bar',data:{labels:d.hr.departments.map(x=>x.label),datasets:[{data:d.hr.departments.map(x=>x.value),backgroundColor:'#06b6d440',borderColor:'#06b6d4',borderWidth:2,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b'}},y:{ticks:{color:'#64748b'}}}}});
    replaceChart('orderStatusChart', {type:'doughnut',data:{labels:so.map(x=>x.status),datasets:[{data:so.map(x=>x.count),backgroundColor:['#10b98140','#8b5cf640','#f59e0b40','#06b6d440','#3b82f640','#ef444440'],borderColor:['#10b981','#8b5cf6','#f59e0b','#06b6d4','#3b82f6','#ef4444'],borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'right',labels:{color:'#94a3b8',font:{size:10}}}}}});
	const pm = d.production.months || [];
	replaceChart('productionChart', {type:'line',plugins:[chartValueLabels],data:{labels:pm.map(x=>x.label),datasets:[{label:'Actual Coil Output',data:pm.map(x=>x.output),borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,.08)',fill:true,tension:.35,borderWidth:2,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:24}},plugins:{legend:{labels:{color:'#94a3b8'}}},scales:{x:{ticks:{color:'#64748b'}},y:{ticks:{color:'#64748b',callback:v=>money(v)}}}}});
	renderAllDetails(d);
  }

  function showError(error) {
    const badge = document.querySelector('.live-badge');
    if (badge) { badge.style.color = '#ef4444'; badge.textContent = 'LIVE DATA ERROR'; }
    console.error('Overview live data failed:', error);
  }

  function load() {
	const from=document.getElementById('overview-from')?.value||'',to=document.getElementById('overview-to')?.value||'',qs=new URLSearchParams({from_date:from,to_date:to});
	fetch(`/api/method/${API}?${qs}`, {credentials: 'same-origin', cache: 'no-store'})
	  .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
	  .then(r => apply(r.message))
	  .catch(showError);
  }
  installControls();wireCreateButtons();
  setTimeout(load, 700);
  setInterval(load, 300000);
})();
