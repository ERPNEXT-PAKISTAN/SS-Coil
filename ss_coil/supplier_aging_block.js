(function(){
  const root=root_element.querySelector('#supplier-aging-dashboard');if(!root)return;
  const $=s=>root.querySelector(s),fmt=n=>Math.round(Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:0});
  function esc(v){return frappe.utils.escape_html(String(v||''))}
  function amount(v){return Number(v||0)?fmt(v):'<span class="sad-zero">—</span>'}
  function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function monthStart(value){const d=value?new Date(value):new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01'}
  function userCompany(){return (frappe.defaults&&frappe.defaults.get_user_default&&frappe.defaults.get_user_default('company'))||(frappe.boot&&frappe.boot.sysdefaults&&frappe.boot.sysdefaults.company)||''}
  function setCompanies(values,current){const el=$('#sad-company'),selected=current||userCompany();el.innerHTML='<option value="">All Companies</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');el.value=selected||''}
  function setGroups(values,current){const el=$('#sad-supplier-group');el.innerHTML='<option value="">All Supplier Groups</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');el.value=current||''}
  function ledgerUrl(supplier){const to=$('#sad-as-on-date').value||today(),params=new URLSearchParams({from_date:monthStart(to),to_date:to,party_type:'Supplier',party:supplier});const company=$('#sad-company').value;if(company)params.set('company',company);return '/desk/custom-html-block/Ledger%20Report?'+params.toString()}
  function render(rows){
    const table=$('#sad-table');if(!rows.length){table.innerHTML='<tbody><tr><td class="sad-empty">No outstanding supplier balances found.</td></tr></tbody>';$('#sad-summary').textContent='0 suppliers';return}
    const totals={balance:0,age_1_15:0,age_16_30:0,age_31_60:0,age_61_90:0,age_91_above:0};rows.forEach(r=>Object.keys(totals).forEach(k=>totals[k]+=Number(r[k]||0)));
    const groups=[...new Set(rows.map(r=>r.supplier_group||'Ungrouped'))].sort();
    const body=groups.map(g=>'<tr class="sad-group"><td colspan="7">'+esc(g)+'</td></tr>'+rows.filter(r=>(r.supplier_group||'Ungrouped')===g).map(r=>'<tr><td title="'+esc(r.supplier)+'"><a class="sad-ledger-link" target="_blank" rel="noopener" href="'+esc(ledgerUrl(r.supplier))+'">'+esc(r.supplier_name||r.supplier)+'</a></td><td>'+amount(r.balance)+'</td><td>'+amount(r.age_1_15)+'</td><td>'+amount(r.age_16_30)+'</td><td>'+amount(r.age_31_60)+'</td><td>'+amount(r.age_61_90)+'</td><td>'+amount(r.age_91_above)+'</td></tr>').join('')).join('');
    table.innerHTML='<thead><tr><th>Supplier</th><th>Balance</th><th>1–15</th><th>16–30</th><th>31–60</th><th>61–90</th><th>91 Above</th></tr></thead><tbody>'+body+'<tr class="sad-total"><td>Total</td><td>'+fmt(totals.balance)+'</td><td>'+fmt(totals.age_1_15)+'</td><td>'+fmt(totals.age_16_30)+'</td><td>'+fmt(totals.age_31_60)+'</td><td>'+fmt(totals.age_61_90)+'</td><td>'+fmt(totals.age_91_above)+'</td></tr></tbody>';$('#sad-summary').textContent=groups.length+' groups · '+rows.length+' suppliers · '+fmt(totals.balance)+' balance';
  }
  function load(){
    $('#sad-loading').style.display='block';$('#sad-error').style.display='none';const group=$('#sad-supplier-group').value,company=$('#sad-company').value;
    frappe.call({method:'supplier_aging_api',args:{company:company,as_on_date:$('#sad-as-on-date').value,balance_type:$('#sad-balance-type').value,supplier_group:group},callback:r=>{const d=r.message||{};setCompanies(d.companies||[],company);setGroups(d.supplier_groups||[],group);render(d.rows||[]);$('#sad-loading').style.display='none'},error:e=>{$('#sad-loading').style.display='none';$('#sad-error').style.display='block';$('#sad-error').textContent=(e&&e.message)||'Could not load supplier aging.'}})
  }
  $('#sad-as-on-date').value=today();$('#sad-company').value=userCompany();$('#sad-refresh').addEventListener('click',load);$('#sad-company').addEventListener('change',load);$('#sad-as-on-date').addEventListener('change',load);$('#sad-balance-type').addEventListener('change',load);$('#sad-supplier-group').addEventListener('change',load);load();
})();
