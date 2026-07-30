(function(){
  const root=root_element.querySelector('#stock-production-dashboard'); if(!root)return;
  const $=s=>root.querySelector(s), fmt=n=>Math.round(Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:0});
  let rows=[],barChart=null;
  function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function defaults(){const now=new Date(),from=new Date(now.getFullYear(),now.getMonth(),1);$('#spd-from').value=iso(from);$('#spd-to').value=iso(now)}
  function optionize(el,values,current){el.innerHTML='<option value="">All</option>'+values.map(v=>`<option value="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(v)}</option>`).join('');el.value=current||''}
  function groupKey(date,period){const d=new Date(date+'T00:00:00');if(period==='daily')return String(d.getDate());if(period==='weekly'){const x=new Date(d);x.setDate(d.getDate()-((d.getDay()+6)%7));return 'Week '+x.getDate()}if(period==='quarterly')return `Q${Math.floor(d.getMonth()/3)+1}`;if(period==='yearly')return String(d.getFullYear());return d.toLocaleString(undefined,{month:'short'})}
  function render(){
    const items=[...new Set(rows.map(r=>r.item_code))].sort();
    const selected=$('#spd-from').value||$('#spd-to').value;
    const base=selected?new Date(selected+'T00:00:00'):new Date();
    const year=base.getFullYear(),month=base.getMonth(),daysInMonth=new Date(year,month+1,0).getDate(),dates=[];
    for(let day=1;day<=daysInMonth;day++)dates.push(year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'));
    $('#spd-matrix-title').textContent='Finished-Goods Production Matrix — '+base.toLocaleString(undefined,{month:'long',year:'numeric'});
    const cell={},itemTotals={},dateTotals={}; rows.forEach(r=>{const k=r.posting_date+'\0'+r.item_code,q=Number(r.qty||0);cell[k]=(cell[k]||0)+q;itemTotals[r.item_code]=(itemTotals[r.item_code]||0)+q;dateTotals[r.posting_date]=(dateTotals[r.posting_date]||0)+q});
    const itemGroup={};rows.forEach(r=>itemGroup[r.item_code]=r.item_group||'Other');
    const total=Object.values(itemTotals).reduce((a,b)=>a+b,0), table=$('#spd-matrix');
    if(!rows.length){table.innerHTML='<tbody><tr><td class="spd-empty">No finished-good production found for these filters.</td></tr></tbody>';$('#spd-summary').textContent='0 records';}
    else{const groups=[...new Set(items.map(i=>itemGroup[i]))].sort();const body=groups.map(g=>`<tr class="spd-group"><td colspan="${dates.length+2}">${frappe.utils.escape_html(g)}</td></tr>`+items.filter(i=>itemGroup[i]===g).map(i=>`<tr><td title="${frappe.utils.escape_html(i)}">${frappe.utils.escape_html(i)}</td>${dates.map(d=>`<td>${cell[d+'\0'+i]?fmt(cell[d+'\0'+i]):'—'}</td>`).join('')}<td><b>${fmt(itemTotals[i])}</b></td></tr>`).join('')).join('');table.innerHTML=`<thead><tr><th>Finished Good</th>${dates.map((d,i)=>`<th title="${frappe.datetime.str_to_user(d)}">${i+1}</th>`).join('')}<th>Total</th></tr></thead><tbody>${body}<tr class="spd-total"><td>Daily Total</td>${dates.map(d=>`<td>${dateTotals[d]?fmt(dateTotals[d]):'—'}</td>`).join('')}<td>${fmt(total)}</td></tr></tbody>`;$('#spd-summary').textContent=`${groups.length} item groups · ${items.length} finished goods · ${fmt(total)} total qty`}
    const period=$('#spd-period').value, grouped={};rows.forEach(r=>{const k=groupKey(r.posting_date,period);grouped[k]=(grouped[k]||0)+Number(r.qty||0)});
    if(period==='daily'){const complete={};for(let d=1;d<=daysInMonth;d++)complete[String(d)]=grouped[String(d)]||0;Object.keys(grouped).forEach(k=>delete grouped[k]);Object.assign(grouped,complete)}
    if(period==='monthly'){const complete={};['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach(m=>complete[m]=grouped[m]||0);Object.keys(grouped).forEach(k=>delete grouped[k]);Object.assign(grouped,complete)}
    if(period==='quarterly'){const complete={};['Q1','Q2','Q3','Q4'].forEach(q=>complete[q]=grouped[q]||0);Object.keys(grouped).forEach(k=>delete grouped[k]);Object.assign(grouped,complete)}
    if(period==='yearly'){const complete={},nowYear=new Date().getFullYear();for(let y=nowYear-4;y<=nowYear;y++)complete[String(y)]=grouped[String(y)]||0;Object.keys(grouped).forEach(k=>delete grouped[k]);Object.assign(grouped,complete)}
    if(barChart)barChart.destroy();
    const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#475569',boxWidth:10}},tooltip:{backgroundColor:'#0f172a',callbacks:{label:c=>' '+fmt(c.raw)}}},scales:{x:{ticks:{color:'#64748b'},grid:{color:'rgba(148,163,184,.16)'}},y:{beginAtZero:true,ticks:{color:'#64748b',precision:0,callback:v=>fmt(v)},grid:{color:'rgba(148,163,184,.16)'}}}};
    const valueLabels={id:'spdValueLabels',afterDatasetsDraw(chart){const ctx=chart.ctx;ctx.save();ctx.fillStyle='#334155';ctx.font='600 10px Inter, sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';chart.getDatasetMeta(0).data.forEach((bar,i)=>{const value=chart.data.datasets[0].data[i];if(Number(value))ctx.fillText(fmt(value),bar.x,bar.y-4)});ctx.restore()}};
    barChart=new Chart($('#spd-bar'),{type:'bar',data:{labels:Object.keys(grouped),datasets:[{label:'Finished Qty',data:Object.values(grouped),backgroundColor:'rgba(59,130,246,.7)',borderColor:'#60a5fa',borderWidth:1,borderRadius:5}]},options:common,plugins:[valueLabels]});
  }
  function load(){
    $('#spd-loading').style.display='block';$('#spd-error').style.display='none';const type=$('#spd-type').value,group=$('#spd-group').value;
    frappe.call({method:'daily_production_api',args:{from_date:$('#spd-from').value,to_date:$('#spd-to').value,stock_entry_type:type,item_group:group},callback:r=>{const d=r.message||{};rows=d.production_rows||[];optionize($('#spd-type'),d.stock_entry_types||[],type);optionize($('#spd-group'),d.item_groups||[],group);render();$('#spd-loading').style.display='none'},error:e=>{$('#spd-loading').style.display='none';$('#spd-error').style.display='block';$('#spd-error').textContent=(e&&e.message)||'Could not load production data.'}})
  }
  defaults();$('#spd-refresh').addEventListener('click',load);['#spd-from','#spd-to','#spd-type','#spd-group'].forEach(s=>$(s).addEventListener('change',load));$('#spd-period').addEventListener('change',function(){const now=new Date(),value=this.value;let from;if(value==='monthly'||value==='quarterly')from=new Date(now.getFullYear(),0,1);else if(value==='yearly')from=new Date(now.getFullYear()-4,0,1);else from=new Date(now.getFullYear(),now.getMonth(),1);$('#spd-from').value=iso(from);$('#spd-to').value=iso(now);load()});
  if(typeof Chart==='undefined'){frappe.require('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',load)}else load();
})();
