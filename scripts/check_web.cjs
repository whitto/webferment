/* Browser smoke test against generated firmware pages, with mocked device data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'/usr/bin/chromium', args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('http://device.test/**', async route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/dygraph.min.js') return route.fulfill({contentType:'text/javascript', body:fs.readFileSync(path.join(root,'htmljs/src/js/dygraph-2.2.1/dygraph.min.js'))});
      if (name === '/bwf.js') return route.fulfill({contentType:'text/javascript', body:fs.readFileSync(path.join(root,'htmljs/src/js/vendor/bwf.js'))});
      if (name.endsWith('.htm')) {
        const key={ 'index.htm':'index','control.htm':'control','logging.htm':'log','setup.htm':'setup','config.htm':'config','gravity.htm':'gdc_e32','pressure.htm':'pressure','backup.htm':'backup'}[name.slice(1)];
        return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,`web/dist/${key}.html`))});
      }
      return route.fulfill({status:404,body:'No device attached'});
    });
    await page.routeWebSocket('ws://device.test/ws', ws => {
      ws.onMessage(msg => {
        if(msg==='c') ws.send('A:'+JSON.stringify({sl:0,st:0,md:'b',tu:'C',bt:2010,bs:2000,ft:1980,fs:2000,rt:2350,nn:'WebFerment',log:''}));
      });
    });
    await page.goto('http://device.test/index.htm');
    await page.waitForFunction(()=>document.querySelector('#lcdBeerTemp').textContent.includes('20.1'));
    assert.match(await page.locator('#lcdBeerSet').innerText(), /20\.0/);
    assert.match(await page.locator('#lcdFridgeTemp').innerText(), /19\.8/);
    assert.equal(await page.locator('.wf-sidebar [aria-current=page]').innerText(),'Dashboard');
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.locator('.wf-sidebar').isVisible());
      assert.ok(await page.locator('#lcdBeerTemp').isVisible());
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      assert.equal(overflow,false,`Horizontal overflow at ${width}px`);
      await page.screenshot({path:`/tmp/webferment-${width}.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: dashboard receives BrewPiLess WebSocket data; beer/chamber targets render; desktop and mobile layouts fit; no browser script errors.');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
