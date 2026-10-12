/* WebFerment 0.5 browser integration tests. Device data and endpoints are mocked. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const constants={tempSetMin:1,tempSetMax:30,tempFormat:'C',Kp:5,Ki:.25,Kd:-1.5};
const reading={sl:30,st:0,md:'b',tu:'C',bt:2010,bs:2000,ft:1980,fs:2000,rt:2350,nn:'WebFerment',log:'Pale ale · batch 04',rssi:-58};
const profile={s:Math.floor(Date.now()/1000)-86400,v:2,u:'C',t:[{c:'t',t:20,d:5},{c:'r',d:1},{c:'a',t:22,d:2,g:1.015},{c:'r',d:1},{c:'v',t:3,d:2,s:24,x:2}]};
// The retained BrewPiLess v7 binary log parser receives a real-format fixture.
function logFixture(){
  const start=Math.floor(Date.now()/1000)-72*3600;
  const header=Buffer.alloc(10);header[0]=255;header[1]=0x67;header.writeUInt16BE(3600,2);header.writeUInt32BE(start,4);header[8]=1;header[9]=0;
  const chunks=[header,Buffer.from([0xf8,0,0x29,0x18])];
  for(let i=0;i<=72;i++){
    const beer=20.1+1.25*Math.exp(-i/14)+Math.sin(i*.55)*.11;
    const chamber=19.8+Math.sin(i*.45)*.55;
    const sg=1.052-.040*(1-Math.exp(-i/20));
    const record=Buffer.alloc(18);record[0]=0xf1;record[1]=i%15<3?4:0;record[2]=0xf0;record[3]=0x7f;
    [2000,Math.round(beer*100),Math.round(chamber*100),2000,2350,0x7fff,Math.round(sg*10000)].forEach((v,n)=>record.writeUInt16BE(v,4+n*2));chunks.push(record);
  }
  return Buffer.concat(chunks);
}
const dashboardWidths=[1440,1280,1024,768,390,320];
// Assert relationships between panels so a short chart cannot leave an empty
// row merely because its neighbouring controller/profile column is taller.
async function checkDashboardLayout(page,width,{history=true}={}){
  await page.setViewportSize({width,height:1000});
  if(history)await page.waitForFunction(()=>{
    const container=document.querySelector('#div_g');
    return window.BChart?.chart?.chart && Math.abs(BChart.chart.chart.width_-container.clientWidth)<=1;
  });
  const layout=await page.evaluate(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const q=selector=>document.querySelector(selector);
    const grid=q('.wf-instrument-grid');
    const visible=[...grid.querySelectorAll('.data-pane')].filter(el=>el.getClientRects().length);
    const input=q('#wf-target'),label=q('#wf-target-label'),unit=q('#wf-unit');
    return {
      history:rect(q('.wf-history')),legend:rect(q('.chart-legend')),insights:rect(q('.wf-insights')),
      footer:rect(q('.footer')),lastPanel:Math.max(...[...document.querySelectorAll('.wf-workspace .wf-card')].map(el=>rect(el).bottom)),
      grid:rect(grid),gridGap:parseFloat(getComputedStyle(grid).columnGap),panels:visible.map(rect),
      chartWidth:q('#div_g').clientWidth,canvasWidths:[...q('#div_g').querySelectorAll('canvas')].map(el=>rect(el).width),
      input:rect(input),inputWrapper:rect(q('.wf-target-input')),label:rect(label),unit:rect(unit),unitInLabel:label.contains(unit),
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      overflowing:[...document.querySelectorAll('body *')].filter(el=>rect(el).right>innerWidth+1).map(el=>({id:el.id,cls:el.className,right:rect(el).right})).slice(0,10)
    };
  });
  const context=`Dashboard at ${width}px (${history?'recorded history':'empty history'})`;
  assert.equal(layout.overflow,false,`${context} overflows: ${JSON.stringify(layout.overflowing)}`);
  const insightsGap=layout.insights.top-layout.history.bottom;
  assert.ok(insightsGap>=0 && insightsGap<=28,`${context}: ${insightsGap}px blank gap before insights`);
  const chartTail=layout.history.bottom-layout.legend.bottom;
  assert.ok(chartTail>=0 && chartTail<=24,`${context}: ${chartTail}px blank tail below legend`);
  const footerGap=layout.footer.top-layout.lastPanel;
  assert.ok(footerGap>=0 && footerGap<=40,`${context}: ${footerGap}px blank gap before footer`);
  assert.equal(layout.panels.length,2,`${context}: expected gravity and system panels; hidden instruments must stay hidden`);
  // Each occupied insight row fills the grid, including layouts where the two
  // panels wrap; an unused third fixed column would fail this measurement.
  const rows=[];
  for(const panel of layout.panels){let row=rows.find(row=>Math.abs(row[0].top-panel.top)<1);if(!row){row=[];rows.push(row);}row.push(panel);}
  for(const row of rows){
    const occupied=row.reduce((sum,panel)=>sum+panel.width,0)+layout.gridGap*(row.length-1);
    assert.ok(Math.abs(occupied-layout.grid.width)<=1,`${context}: insight row uses ${occupied}px of ${layout.grid.width}px`);
  }
  assert.ok(layout.inputWrapper.height-layout.input.height<=1,`${context}: target input has inherited vertical margins`);
  assert.ok(layout.unitInLabel && layout.unit.height>0 && layout.unit.top>=layout.label.top && layout.unit.bottom<=layout.label.bottom+1,`${context}: temperature unit must remain visible in its target label`);
  if(history){
    assert.ok(layout.canvasWidths.length>0,`${context}: history canvas missing`);
    for(const canvasWidth of layout.canvasWidths)assert.ok(Math.abs(canvasWidth-layout.chartWidth)<=1,`${context}: ${canvasWidth}px canvas does not fill ${layout.chartWidth}px chart`);
  }
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const page=await browser.newPage({timezoneId:'Australia/Brisbane'});await page.clock.install();const errors=[];const messages=[];const writes=[];let socket;let serveHistory=true;
  let servedProfile=profile;
  page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message)});
  page.on('dialog',dialog=>dialog.accept());
  await page.route('http://device.test/**',async route=>{
    const url=new URL(route.request().url()),name=url.pathname;
    const reply=(data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(name==='/dygraph.min.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'htmljs/src/js/dygraph-2.2.1/dygraph.min.js'))});
    if(name==='/bwf.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'htmljs/src/js/vendor/bwf.js'))});
    if(name.endsWith('.htm')){
      const key={'index.htm':'index','control.htm':'control','logging.htm':'log','setup.htm':'setup','config.htm':'config','gravity.htm':'gdc_e32','pressure.htm':'pressure','backup.htm':'backup'}[name.slice(1)];
      return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,`web/dist/${key}.html`))});
    }
    if(name==='/chart.php')return route.fulfill({contentType:'application/octet-stream',headers:{LogOffset:'0'},body:serveHistory&&url.searchParams.get('offset')==='0'?logFixture():Buffer.alloc(0)});
    if(name==='/tschedule'){
      if(route.request().method()==='POST'){writes.push(JSON.parse(new URLSearchParams(route.request().postData()).get('data')));return reply({});}
      return reply(servedProfile);
    }
    if(name==='/config')return reply({hostname:'webferment',title:'WebFerment',mac:[1,2,3,4,5,6],fid:123,frsize:4194304,fsize:4194304,fs:589824});
    if(name==='/loglist.php')return reply([]);
    return route.fulfill({status:404,body:'Mock device has no resource at this path'});
  });
  await page.routeWebSocket('ws://device.test/ws',ws=>{
    socket=ws;
    ws.onMessage(message=>{
      messages.push(message);
      if(message==='c'){ws.send('C:'+JSON.stringify(constants));ws.send('A:'+JSON.stringify(reading));}
      if(message==='n')ws.send('N:'+JSON.stringify({b:'f'}));
      if(message.startsWith('d{'))ws.send('d:[]');
      if(message.startsWith('h{'))ws.send('h:[]');
    });
  });
  await page.goto('http://device.test/index.htm');
  await page.waitForFunction(()=>document.querySelector('#lcdBeerTemp')?.textContent.includes('20.1'));
  await page.waitForFunction(()=>window.BChart?.chart?.data.length===73);
  await page.waitForFunction(()=>document.querySelector('#wf-chart-empty').hidden);
  assert.match(await page.locator('#lcdBeerSet').innerText(),/20\.0/);
  assert.match(await page.locator('#lcdFridgeTemp').innerText(),/19\.8/);
  assert.match(await page.locator('#gravity-sg').innerText(),/1\.01/);
  assert.equal(await page.locator('.wf-sidebar [aria-current=page]').innerText(),'Dashboard');
  assert.equal(await page.locator('#wf-profile-summary li').count(),5);
  assert.equal(await page.locator('#wf-quick-control button').isEnabled(),true);
  await page.locator('[data-range="24"]').click();
  assert.equal(await page.evaluate(()=>BChart.chart.chart.xAxisRange()[1]-BChart.chart.chart.xAxisRange()[0]),86400000);
  await page.locator('[data-range="all"]').click();
  // A target must be transmitted using the original controller protocol and confirmed by an echo.
  await page.locator('#wf-target').fill('21.5');await page.locator('#wf-quick-control button').click();
  assert.equal(messages.at(-1),'j{mode:b, beerSet:21.5}');
  assert.equal(await page.locator('#wf-quick-control button').isDisabled(),true);
  socket.send('A:'+JSON.stringify({...reading,bs:2150}));
  await page.waitForFunction(()=>document.querySelector('#wf-toast').textContent.includes('confirmed'));
  assert.equal(await page.locator('#wf-quick-control button').isEnabled(),true);
  await page.locator('#wf-mode').selectOption('f');await page.locator('#wf-target').fill('19');await page.locator('#wf-quick-control button').click();
  assert.equal(messages.at(-1),'j{mode:f, fridgeSet:19}');socket.send('A:'+JSON.stringify({...reading,md:'f',fs:1900}));
  await page.waitForFunction(()=>!document.querySelector('#wf-quick-control button').disabled);
  await page.locator('#wf-mode').selectOption('o');await page.locator('#wf-quick-control button').click();
  assert.equal(messages.at(-1),'j{mode:o}');socket.send('A:'+JSON.stringify({...reading,md:'o'}));
  await page.waitForFunction(()=>!document.querySelector('#wf-quick-control button').disabled);
  assert.equal(await page.locator('#wf-unit').isVisible(),false);
  // Reject an out-of-range target even if submission bypasses native browser validation.
  await page.locator('#wf-mode').selectOption('b');await page.locator('#wf-target').fill('99');
  assert.equal(await page.locator('#wf-unit').isVisible(),true);
  const beforeInvalid=messages.length;
  await page.evaluate(()=>document.querySelector('#wf-quick-control').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(messages.length,beforeInvalid);assert.match(await page.locator('#wf-toast').innerText(),/between 1 and 30/);
  // Snapshot the normal operating state, not a pending user edit.
  socket.send('A:'+JSON.stringify(reading));await page.locator('#wf-mode').selectOption('b');await page.locator('#wf-target').fill('20.0');
  await page.evaluate(()=>document.querySelector('#wf-toast').hidden=true);
  for(const width of dashboardWidths){
    await checkDashboardLayout(page,width);
    assert.ok(await page.locator('#lcdBeerTemp').isVisible());
    if([1440,390].includes(width)){
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:`/tmp/webferment-${width}.png`,fullPage:true});
    }
  }
  // A container-only width change must redraw Dygraph without a window resize.
  await page.setViewportSize({width:1440,height:1000});
  const originalChartWidth=await page.locator('#div_g').evaluate(el=>el.clientWidth);
  await page.locator('.wf-main-column').evaluate(el=>el.style.width='90%');
  await page.waitForFunction(original=>document.querySelector('#div_g').clientWidth<original && Math.abs(BChart.chart.chart.width_-document.querySelector('#div_g').clientWidth)<=1,originalChartWidth);
  await page.locator('.wf-main-column').evaluate(el=>el.style.removeProperty('width'));
  await checkDashboardLayout(page,1440);
  // Switching modes must retain the live unit node for later C/F updates.
  socket.send('C:'+JSON.stringify({...constants,tempFormat:'F'}));
  await page.waitForFunction(()=>document.querySelector('#wf-unit').textContent==='°F');
  socket.send('C:'+JSON.stringify(constants));
  await page.waitForFunction(()=>document.querySelector('#wf-unit').textContent==='°C');
  // Keyboard activation keeps the original gravity-entry dialogs and handlers.
  for(const [id,key,isOriginal] of [['gravity-sg','Enter',false],['gravity-og','Space',true]]){
    assert.equal(await page.locator(`#${id}`).getAttribute('role'),'button');
    assert.equal(await page.locator(`#${id}`).getAttribute('tabindex'),'0');
    await page.locator(`#${id}`).press(key);
    assert.ok(await page.locator('#dlg_addgravity').isVisible());
    assert.equal(await page.evaluate(()=>window.isog),isOriginal);
    await page.locator('#dlg_addgravity').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.locator('#dlg_addgravity').isVisible(),false);
  }
  socket.send('A:'+JSON.stringify({...reading,bt:-32768}));await page.waitForFunction(()=>document.querySelector('.wf-metric').classList.contains('is-unavailable'));
  assert.match(await page.locator('#lcdBeerTemp').innerText(),/--/);
  // Fast-forward browser time to check stale readings without waiting in real time.
  await page.clock.runFor(16000);
  assert.equal(await page.locator('#wf-quick-control button').isDisabled(),true);
  assert.equal(await page.locator('.header .wf-connection').innerText(),'Readings are stale');
  socket.close();await page.waitForFunction(()=>document.querySelector('.header .wf-connection').textContent==='Disconnected');
  assert.equal(await page.locator('#wf-quick-control button').isDisabled(),true);
  await page.clock.resume();
  // Empty history and no saved schedule remain compact at every breakpoint.
  serveHistory=false;servedProfile={...profile,t:[]};
  await page.goto('http://device.test/index.htm');
  await page.waitForFunction(()=>document.querySelector('#wf-profile-summary').textContent.includes('No saved schedule'));
  assert.ok(await page.locator('#wf-chart-empty').isVisible());
  for(const width of dashboardWidths)await checkDashboardLayout(page,width,{history:false});
  // Long schedules scroll inside their card and remain reachable by keyboard.
  serveHistory=true;servedProfile={...profile,t:[...profile.t,...profile.t]};
  await page.goto('http://device.test/index.htm');
  await page.waitForFunction(()=>document.querySelectorAll('#wf-profile-summary li').length===10 && window.BChart?.chart?.data.length===73);
  await page.waitForFunction(()=>document.querySelector('#wf-chart-empty').hidden);
  for(const width of [1440,390]){
    await checkDashboardLayout(page,width);
    const stages=page.locator('.wf-profile-steps');
    const dimensions=await stages.evaluate(el=>({height:el.clientHeight,contents:el.scrollHeight}));
    assert.ok(dimensions.height<=226 && dimensions.contents>dimensions.height,`Long profile should scroll within its card at ${width}px`);
    await stages.focus();await stages.press('End');
    await page.waitForFunction(()=>document.querySelector('.wf-profile-steps').scrollTop>0);
    await stages.press('Home');
    await page.waitForFunction(()=>document.querySelector('.wf-profile-steps').scrollTop===0);
  }
  servedProfile=profile;
  // Profiles retain hold/ramp, gravity, stability and save/activate behaviours.
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://device.test/control.htm');
  await page.waitForFunction(()=>window.profileEditor?.rowList().length===5);
  assert.equal(await page.locator('#profile_t tbody tr').count(),5);
  await page.locator('#savebtn').click();await page.waitForFunction(()=>!profileEditor.dirty);
  assert.equal(writes.length,1);assert.deepEqual(writes[0].t,profile.t);
  await page.locator('#beer-m').click();await page.locator('#beer-t').fill('20.5');await page.locator('#modekeeper-apply').click();
  assert.equal(messages.at(-1),'j{mode:b, beerSet:20.5}');
  await page.locator('#profile-m').click();
  await page.waitForFunction(()=>window.ControlChart?.wfStyled);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/webferment-profiles.png',fullPage:true});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(150);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).slice(0,15));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Profiles overflow at ${width}px: ${JSON.stringify(overflow)}`);
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://device.test/setup.htm');
  await page.waitForFunction(()=>window.board==='f');
  assert.ok(messages.includes('n'));assert.ok(await page.locator('#device-list').isVisible());
  await page.goto('http://device.test/config.htm');
  await page.waitForFunction(()=>window.oridata);
  await page.waitForFunction(()=>window.BWF?.ws?.readyState===1);await page.evaluate(()=>showAdvanced());await page.waitForFunction(()=>window.ccConstants?.Kp===5);
  assert.equal(await page.locator('#Kp').inputValue(),'5');assert.equal(await page.locator('#Ki').inputValue(),'0.25');assert.equal(await page.locator('#Kd').inputValue(),'-1.5');
  assert.ok(await page.locator('#advanced').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS: 0.5 compact dashboard at six widths, empty/long profiles, keyboard gravity entry, container chart resizing, binary log history, chart ranges, confirmed beer/chamber/off commands, sensor fault, stale/disconnected guards, responsive profiles, schedule save, device discovery and retained PID tuning UI.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
