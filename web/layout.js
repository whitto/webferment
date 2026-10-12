/* WebFerment 0.5 UI. Controller, PID, profiles and device protocol: BrewPiLess by vitotai. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const state = {connected:false, lastSample:0, constants:null, mode:null, pending:null};
  const names = {b:'Beer constant', f:'Chamber constant', p:'Fermentation profile', o:'Control off'};
  const h = (tag, cls, text) => {const el=document.createElement(tag); if(cls)el.className=cls; if(text)el.textContent=text; return el;};
  const card = (title, note) => {const c=h('section','wf-card'); const top=h('div','wf-card-heading'); top.append(h('h2','',title)); if(note)top.append(h('span','wf-muted',note)); c.append(top);return c;};
  const move = (selector, target) => {const el=$(selector);if(el)target.append(el);return el;};
  const validConstants = () => state.constants && ['C','F'].includes(state.constants.tempFormat) && Number.isFinite(Number(state.constants.tempSetMin)) && Number.isFinite(Number(state.constants.tempSetMax)) && Number(state.constants.tempSetMin)<Number(state.constants.tempSetMax);
  const live = () => state.connected && state.lastSample > 0 && Date.now()-state.lastSample < 15000;
  function notice(message, error=false) {
    const el=$('#wf-toast'); el.textContent=message;el.classList.toggle('is-error',error);el.hidden=false;
    clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,6000);
  }
  function connection() {
    const fresh=live();
    const text=!state.connected?'Disconnected':fresh?'Controller online':state.lastSample?'Readings are stale':'Waiting for readings';
    document.querySelectorAll('.wf-connection').forEach(el=>{el.textContent=text;el.dataset.status=fresh?'online':'offline';});
    document.querySelectorAll('[data-requires-controller]').forEach(el=>el.disabled=!fresh || !validConstants() || !!state.pending);
    if($('#wf-last-update'))$('#wf-last-update').textContent=state.lastSample?`Updated ${Math.floor((Date.now()-state.lastSample)/1000)}s ago`:'No readings received';
    if($('#wf-live-note'))$('#wf-live-note').textContent=fresh?'Live readings from your controller.':state.lastSample?'Last received values · waiting for a fresh reading.':'Waiting for your controller. Values will appear when connected.';
    document.body.classList.toggle('wf-stale',!fresh);
  }
  function sample(c) {
    if(typeof c.sl==='number') {
      state.lastSample=Date.now(); state.mode=c.md;
      document.querySelectorAll('.wf-mode-name').forEach(el=>el.textContent=names[c.md]||'Unknown mode');
      if($('#wf-activity')) {const labels=['Idle','Control off','Door open','Heating','Cooling','Waiting to cool','Waiting to heat','Waiting for peak','Cooling · minimum run','Heating · minimum run','Invalid state'];$('#wf-activity').textContent=labels[c.st]||'Unknown state';$('#wf-activity').dataset.state=c.st;}
      for(const [key,id] of [['bt','lcdBeerTemp'],['ft','lcdFridgeTemp'],['rt','lcdRoomTemp']]) {
        const el=document.getElementById(id);if(el)el.closest('.wf-metric')?.classList.toggle('is-unavailable',typeof c[key]!=='number'||c[key]<-10000);
      }
      if($('#wf-error-value')) $('#wf-error-value').textContent=typeof c.bt==='number' && typeof c.bs==='number' && c.bt>=-10000 && c.bs>=-10000?`${((c.bt-c.bs)/100).toFixed(1)}°${c.tu}`:'—';
      if(state.pending && c.md===state.pending.mode && (c.md==='o'||Math.abs(c[state.pending.mode==='b'?'bs':'fs']/100-state.pending.target)<0.051)) {
        clearTimeout(state.pending.timer);state.pending=null;notice('Controller confirmed the change.');
      }
    }
    if(c.log!==undefined && $('#wf-log-name'))$('#wf-log-name').textContent=c.log||'Not recording';
    if(c.rssi!==undefined && $('#wf-signal'))$('#wf-signal').textContent=`${c.rssi} dBm`;
    connection();
  }
  // Adapt presentation around the existing BrewPiLess API. Do not change its handlers.
  if(window.BWF) {
    const original=BWF.init;
    BWF.init=function(options) {
      const onconnect=options.onconnect, error=options.error;
      const handlers={...options.handlers};const a=handlers.A,c=handlers.C;
      handlers.A=function(data){if(a)a(data);sample(data);};
      if(c)handlers.C=function(data){c(data);state.constants=data;connection();};
      return original.call(this,{...options,handlers,
        onconnect(){state.connected=true;connection();if(onconnect)onconnect();},
        error(code){state.connected=false;state.constants=null;connection();if(error)error(code);}
      });
    };
  }
  function metric(label, value, target, hint, tone) {
    const m=h('article',`wf-metric ${tone||''}`);m.append(h('span','wf-eyebrow',label));
    const v=h('div','wf-metric-value');const oldRow=$(value)?.closest('li');const node=move(value,v);if(label==='Specific gravity')oldRow?.remove();if(node)node.textContent='—';if(label==='Specific gravity')v.append(h('span','platounit','°P'));m.append(v);
    const footer=h('div','wf-metric-footer');footer.append(h('span','',hint));if(target){const node=move(target,footer);if(node)node.textContent='—';}m.append(footer);return m;
  }
  function dashboard(viewport) {
    document.body.classList.add('wf-dashboard');
    const oldSide=$('[side]'), chartRoot=$('[main]');
    const dashboard=h('div','wf-dashboard-content');
    const intro=h('div','wf-intro');intro.innerHTML='<div><span class="wf-eyebrow">Batch monitoring</span><h1>Fermentation overview</h1><p id="wf-live-note">Waiting for your controller.</p></div><a class="wf-button wf-primary" href="/control.htm">Manage fermentation <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 19 19 5M6 5h13v13"/></svg></a>';dashboard.append(intro);
    const metrics=h('div','wf-metrics');
    metrics.append(metric('Beer temperature','#lcdBeerTemp','#lcdBeerSet','Target','wf-accent'),metric('Chamber temperature','#lcdFridgeTemp','#lcdFridgeSet','Chamber target'),metric('Specific gravity','#gravity-sg',null,'Enter a gravity reading'),metric('Room temperature','#lcdRoomTemp',null,'Ambient conditions'));
    dashboard.append(metrics);
    const workspace=h('div','wf-workspace');
    const main=h('div','wf-main-column');workspace.append(main);
    const chart=card('Fermentation history','Beer · chamber · gravity');chart.classList.add('wf-history');
    const toolbar=h('div','wf-chart-toolbar');toolbar.innerHTML='<div class="wf-time-ranges" aria-label="Chart time range"><button type="button" data-range="24">24 hours</button><button type="button" data-range="72">3 days</button><button type="button" data-range="all" aria-pressed="true">All history</button></div><span id="wf-history-status" class="wf-muted">Waiting for recorded data</span>';chart.append(toolbar);
    chartRoot.removeAttribute('main');chartRoot.className='wf-chart-content';chart.append(chartRoot);
    const empty=h('div','wf-chart-empty');empty.id='wf-chart-empty';empty.innerHTML='<span class="wf-empty-icon" aria-hidden="true">⌁</span><strong>No recorded history</strong><p>Recorded temperatures and gravity will appear here.<br>Enable a log to keep the full history.</p><a class="wf-button wf-secondary" href="/logging.htm">Set up logging</a>';chart.append(empty);
    main.append(chart);
    const right=h('div','wf-rail');const control=card('Temperature control','');control.classList.add('wf-control-card');
    const activity=h('div','wf-activity');activity.innerHTML='<span class="wf-indicator"></span><strong id="wf-activity">Waiting for controller</strong><span id="wf-last-update">No readings received</span>';control.append(activity);
    const mode=h('div','wf-control-mode');mode.append(h('span','wf-eyebrow','Current mode'));move('#lcdControlMode',mode);control.append(mode);
    const form=h('form','wf-quick-control');form.id='wf-quick-control';form.innerHTML='<label for="wf-mode">Set control mode</label><select id="wf-mode"><option value="b">Beer constant</option><option value="f">Chamber constant</option><option value="o">Control off</option></select><label for="wf-target" id="wf-target-label">Target temperature <span id="wf-unit">°C</span></label><div class="wf-target-input"><input id="wf-target" type="number" step="0.1" inputmode="decimal" required placeholder="e.g. 20.0"></div><button type="submit" class="wf-button wf-primary" data-requires-controller disabled>Apply to controller</button><p class="wf-muted">Scheduled changes are managed in Profiles.</p>';control.append(form);
    const details=h('dl','wf-controller-details');details.innerHTML='<div><dt>Beer / target difference</dt><dd id="wf-error-value">—</dd></div><div><dt>Control algorithm</dt><dd>BrewPi PID</dd></div><div><dt>Recording</dt><dd id="wf-log-name">Not recording</dd></div><div><dt>WiFi signal</dt><dd id="wf-signal">—</dd></div>';control.append(details);right.append(control);
    const profile=card('Fermentation profile');profile.classList.add('wf-profile-card');const count=h('span','wf-muted');count.id='wf-profile-count';profile.querySelector('.wf-card-heading').append(count);profile.innerHTML+='<div id="wf-profile-summary" class="wf-profile-summary"><p class="wf-muted">Loading saved schedule…</p></div><a class="wf-text-link" href="/control.htm">Edit profile <span aria-hidden="true">→</span></a>';right.append(profile);workspace.append(right);dashboard.append(workspace);
    const instruments=card('Batch insights','Gravity, sensors & auxiliary controls');instruments.classList.add('wf-insights');const grid=h('div','wf-instrument-grid');
    // Keep original panels, calibration dialogs, and DOM IDs for upstream integrations.
    oldSide.querySelectorAll('.data-pane').forEach(panel=>{if(panel.id==='status-pane')return;grid.append(panel);});
    const status=$('#status-pane');const preserve=h('div','wf-preserved');preserve.hidden=true;preserve.append(status);dashboard.append(preserve);
    instruments.append(grid);main.append(instruments);viewport.replaceChildren(dashboard);
    form.addEventListener('submit', event=>{
      event.preventDefault();if(!live()||!validConstants()||state.pending){notice('Wait for fresh controller readings before applying a change.',true);return;}
      const mode=$('#wf-mode').value,target=Number($('#wf-target').value),key=mode==='b'?'beerSet':'fridgeSet';
      if(mode!=='o' && (!$('#wf-target').value.trim() || !Number.isFinite(target) || target<Number(state.constants.tempSetMin)||target>Number(state.constants.tempSetMax))){notice(`Enter a target between ${state.constants.tempSetMin} and ${state.constants.tempSetMax}°${state.constants.tempFormat}.`,true);return;}
      const command=mode==='o'?'j{mode:o}':`j{mode:${mode}, ${key}:${target}}`;
      BWF.send(command);state.pending={mode,key,target,timer:setTimeout(()=>{state.pending=null;notice('No confirmation received. Check the controller before retrying.',true);connection();},10000)};connection();notice('Change sent. Waiting for controller confirmation…');
    });
    $('#wf-mode').addEventListener('change',()=>{const off=$('#wf-mode').value==='o';$('#wf-target').disabled=off;$('#wf-target').required=!off;$('#wf-target-label').firstChild.textContent=off?'No temperature target':'Target temperature ';$('#wf-unit').hidden=off;});
    toolbar.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{
      const graph=window.BChart?.chart?.chart;if(!graph){notice('No recorded history to display yet.');return;}
      const hours=button.dataset.range;const last=graph.getValue(graph.numRows()-1,0);graph.updateOptions({dateWindow:hours==='all'?null:[last-Number(hours)*3600000,last]});
      toolbar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    }));
    fetch('/tschedule').then(response=>{if(!response.ok)throw Error();return response.json();}).then(p=>{
      const el=$('#wf-profile-summary');el.replaceChildren();if(!p.t?.length){el.append(h('p','wf-muted','No saved schedule. Create a profile to guide your next batch.'));return;}
      $('#wf-profile-count').textContent=`${p.t.length} stages`;const list=h('ol','wf-profile-steps');list.tabIndex=0;list.setAttribute('aria-label','Saved profile stages');p.t.forEach(stage=>{const li=h('li','');li.append(h('span','',stage.c==='r'?'Temperature ramp':`${stage.t}°${p.u} hold`),h('small','',`${stage.d} days${stage.c!=='t'&&stage.c!=='r'?' · conditional':''}`));list.append(li);});el.append(list);if(p.t.length>5)el.append(h('p','wf-muted wf-profile-scroll-hint','Scroll to view all stages.'));
    }).catch(()=>$('#wf-profile-summary').replaceChildren(h('p','wf-muted','Schedule unavailable. Open Profiles to view or create one.')));
  }
  function mount() {
    const key=document.body.dataset.page;const header=$('.header');
    if(header){header.querySelector('[navigation]')?.remove();const old=header.querySelector('h1');old.className='wf-device-name';const label=h('div','wf-breadcrumb','WORKSPACE / '+({index:'FERMENTATION',control:'PROFILES',setup:'HARDWARE',config:'SETTINGS',log:'LOGGING',gdc:'HYDROMETERS',gdc_e32:'HYDROMETERS',pressure:'PRESSURE',backup:'BACKUP'}[key]||'FERMENTATION'));header.prepend(label);const badge=h('span','wf-connection','Connecting…');badge.setAttribute('role','status');header.append(badge);}
    const toast=h('div','wf-toast');toast.id='wf-toast';toast.hidden=true;toast.setAttribute('role','status');document.body.append(toast);
    const viewport=$('[viewport]');
    if(key==='index'&&viewport) dashboard(viewport);
    else if(viewport) {
      const titles={control:['Plan your fermentation','Steady temperatures. Deliberate ramps. Your recipe, on schedule.'],setup:['Sensors & relays','Assign your temperature probes and outputs to the right roles.'],config:['Controller settings','Network, device preferences and advanced BrewPi control tuning.'],log:['Recording & logging','Keep your batch history on the controller or send it to your brewing tools.'],gdc:['Hydrometers','Connect gravity readings to your fermentation.'],gdc_e32:['Hydrometers','Connect gravity readings to your fermentation.'],pressure:['Pressure & carbonation','Configure the optional pressure and capping features.'],backup:['Backup & restore','Keep a copy of your controller settings.']};
      const [title,subtitle]=titles[key]||['Controller',''];const intro=h('div','wf-intro');intro.append(h('div',''));intro.firstChild.append(h('span','wf-eyebrow','WEBFERMENT / 0.5'),h('h1','',title),h('p','',subtitle));viewport.prepend(intro);
      if(key==='control') {
        document.body.classList.add('wf-profiles');$('#modekeeper-apply')?.setAttribute('data-requires-controller','');
        const wrapper=$('#profile-s>div');if(wrapper){wrapper.classList.add('wf-profile-layout');const preview=h('section','wf-profile-preview');preview.append(h('h2','','Temperature schedule'));move('#tc_chart',preview);wrapper.prepend(preview);}
        const labels={'profile-m':'Profile','beer-m':'Beer constant','fridge-m':'Chamber constant','off-m':'Off'};Object.entries(labels).forEach(([id,text])=>document.getElementById(id).textContent=text);
        if($('#humidity-control'))$('#humidity-control').style.display='none';
        const table=$('#profile_t');if(table){const wrap=h('div','wf-table-scroll');table.before(wrap);wrap.append(table);}
        const help=h('div','wf-help-note','Stages can finish by time, gravity, stability, or a combination. Save your schedule before activating profile mode.');$('#profile-edit')?.prepend(help);
        const save=$('#savebtn');if(save)save.textContent='Save schedule';
      }
      if(key==='setup')document.body.classList.add('wf-devices');
      if(key==='config')document.body.classList.add('wf-settings');
    }
    // Readout updates keep the original bindings. Improve their missing-data defaults.
    document.querySelectorAll('.wf-metric-value>span').forEach(el=>el.setAttribute('aria-live','polite'));
    ['gravity-sg','gravity-og'].forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',id==='gravity-sg'?'Enter specific gravity':'Enter original gravity');
      el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
    });
    // Moving panels and changing visible instruments can resize charts without a window resize.
    if(window.ResizeObserver && key==='index'){
      let frame;
      const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
        const charts=window.BChart?.chart;[charts?.chart,charts?.pchart,charts?.hchart].forEach(chart=>chart?.resize());
      });});
      ['div_g','div_p','div_h'].forEach(id=>{const el=document.getElementById(id);if(el)observer.observe(el);});
      window.addEventListener('pagehide',()=>{observer.disconnect();cancelAnimationFrame(frame);},{once:true});
    }
    setInterval(()=>{
      connection();
      if(state.constants && $('#wf-unit')){
        $('#wf-unit').textContent=`°${state.constants.tempFormat}`;$('#wf-target').min=state.constants.tempSetMin;$('#wf-target').max=state.constants.tempSetMax;
      }
      if(window.ControlChart?.chart && !ControlChart.wfStyled){ControlChart.chart.updateOptions({colors:['#167e72'],strokeWidth:2,gridLineColor:'#e6ece2',axisLabelFontSize:10});ControlChart.wfStyled=true;}
      const chart=window.BChart?.chart;
      if(chart?.data?.length && $('#wf-chart-empty')){$('#wf-chart-empty').hidden=true;$('#wf-history-status').textContent=`${chart.data.length} recorded points`;if(chart.chart && !chart.wfStyled){chart.chart.updateOptions({colors:['#c5a351','#167e72','#81a4b8','#b6c8d2','#adb89d','#a4b3b0','#947bb6','#b29bc9'],strokeWidth:2,gridLineColor:'#edf0e8',axisLabelFontSize:10});chart.wfStyled=true;}}
    },1000);
    connection();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
