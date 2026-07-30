(function(){
  const root=root_element.querySelector('#customer-aging-dashboard');if(!root)return;
  const $=s=>root.querySelector(s),fmt=n=>Math.round(Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:0});
  function esc(v){return frappe.utils.escape_html(String(v||''))}
  function amount(v){return Number(v||0)?fmt(v):'<span class="cad-zero">—</span>'}
  function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function monthStart(value){const d=value?new Date(value):new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01'}
  function userCompany(){return (frappe.defaults&&frappe.defaults.get_user_default&&frappe.defaults.get_user_default('company'))||(frappe.boot&&frappe.boot.sysdefaults&&frappe.boot.sysdefaults.company)||''}
  function setCompanies(values,current){const el=$('#cad-company'),selected=current||userCompany();el.innerHTML='<option value="">All Companies</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');el.value=selected||''}
  function setGroups(values,current){const el=$('#cad-customer-group');el.innerHTML='<option value="">All Customer Groups</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');el.value=current||''}
  function ledgerUrl(customer){const to=$('#cad-as-on-date').value||today(),params=new URLSearchParams({from_date:monthStart(to),to_date:to,party_type:'Customer',party:customer});const company=$('#cad-company').value;if(company)params.set('company',company);return '/desk/custom-html-block/Ledger%20Report?'+params.toString()}
  function render(rows){
    const table=$('#cad-table');
    if(!rows.length){table.innerHTML='<tbody><tr><td class="cad-empty">No outstanding customer balances found.</td></tr></tbody>';$('#cad-summary').textContent='0 customers';return}
    const totals={balance:0,age_1_15:0,age_16_30:0,age_31_60:0,age_61_90:0,age_91_above:0};
    rows.forEach(r=>Object.keys(totals).forEach(k=>totals[k]+=Number(r[k]||0)));
    const groups=[...new Set(rows.map(r=>r.customer_group||'Ungrouped'))].sort();
    const body=groups.map(g=>'<tr class="cad-group"><td colspan="7">'+esc(g)+'</td></tr>'+rows.filter(r=>(r.customer_group||'Ungrouped')===g).map(r=>'<tr><td title="'+esc(r.customer)+'"><a class="cad-ledger-link" target="_blank" rel="noopener" href="'+esc(ledgerUrl(r.customer))+'">'+esc(r.customer_name||r.customer)+'</a></td><td>'+amount(r.balance)+'</td><td>'+amount(r.age_1_15)+'</td><td>'+amount(r.age_16_30)+'</td><td>'+amount(r.age_31_60)+'</td><td>'+amount(r.age_61_90)+'</td><td>'+amount(r.age_91_above)+'</td></tr>').join('')).join('');
    table.innerHTML='<thead><tr><th>Customer</th><th>Balance</th><th>1–15</th><th>16–30</th><th>31–60</th><th>61–90</th><th>91 Above</th></tr></thead><tbody>'+body+'<tr class="cad-total"><td>Total</td><td>'+fmt(totals.balance)+'</td><td>'+fmt(totals.age_1_15)+'</td><td>'+fmt(totals.age_16_30)+'</td><td>'+fmt(totals.age_31_60)+'</td><td>'+fmt(totals.age_61_90)+'</td><td>'+fmt(totals.age_91_above)+'</td></tr></tbody>';
    $('#cad-summary').textContent=groups.length+' groups · '+rows.length+' customers · '+fmt(totals.balance)+' balance';
  }
  function load(){
    $('#cad-loading').style.display='block';$('#cad-error').style.display='none';
    const group=$('#cad-customer-group').value,company=$('#cad-company').value;frappe.call({method:'customer_aging_api',args:{company:company,as_on_date:$('#cad-as-on-date').value,balance_type:$('#cad-balance-type').value,customer_group:group},callback:r=>{const d=r.message||{};setCompanies(d.companies||[],company);setGroups(d.customer_groups||[],group);render(d.rows||[]);$('#cad-loading').style.display='none'},error:e=>{$('#cad-loading').style.display='none';$('#cad-error').style.display='block';$('#cad-error').textContent=(e&&e.message)||'Could not load customer aging.'}})
  }
  $('#cad-as-on-date').value=today();$('#cad-company').value=userCompany();$('#cad-refresh').addEventListener('click',load);$('#cad-company').addEventListener('change',load);$('#cad-as-on-date').addEventListener('change',load);$('#cad-balance-type').addEventListener('change',load);$('#cad-customer-group').addEventListener('change',load);load();
})();
