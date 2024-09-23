const puppeteer = require('puppeteer-extra');
const totp = require("totp-generator");
const Tesseract = require('tesseract.js');
const {getOptionPrices} = require('./websocket.js')
const axios = require('axios');
const { spawn } = require('child_process');
const Jimp = require('jimp');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

//const global = require("./connect")


/* 
- double click will set stop loss. c + dblclick will set stop loss always for CE level, p + stoploss will do for PE level
- Number key + click will place orders at market for that many lots
- Number key + double click will exit orders at market for that many lots
- Press Sapce to open modify input box (having price & freeze limits, buy/sell toggle ) prefilled with market price. 
Space again to hide and exit from modify mode
- M + click 
- e + click will exit order at market
- l + click will place sell order at limit price (present dialog box to enter diff, 0 diff means market)
- x + click to exit order at limit (present dialog to enter diff, 0 diff means market)
- m + click to to modify order (enter diff, 0 diff means market)
*/

const indexMap = {
	 260105: "BANKNIFTY",
   256265: "NIFTY",
   257801: "FINNIFTY",
   288009: "MIDCPNIFTY",
   265: "SENSEX",
   274441: "BANKEX"
}

const DEBUG_PORT = 9222;
const BROWSER_URL = `http://localhost:${DEBUG_PORT}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_DATA_DIR = '/tmp/chrome_temp';
const devHost = "http://localhost:3000";
const prodHost = "https://zerodha-algo.onrender.com";
const host = prodHost;

async function run() {
 
  //run browser in debug mode if not running
  puppeteer.use(StealthPlugin());
  const running = await isBrowserRunning(BROWSER_URL);
  if (!running) {
    console.log("Browser not running. Launching Browser")
    await launchBrowser();
  }
 
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222', // URL of the remote debugging interface
    headless: false,
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });
 
  const page = await browser.newPage(); // Open a new page
  await page.setRequestInterception(true);

  page.on('request', request => {
  const headers = request.headers();
  if (headers['Content-Security-Policy']) {
    delete headers['Content-Security-Policy'];  // Remove CSP header
  }
  request.continue({ headers });
});

  let logoutScreen = false;
  page.on('framenavigated', async frame => {
    
    if (frame != page.mainFrame()) return;
    const url = frame.url();
    const parts = url.split('/');
    
    if(url.includes("loggedout") && !logoutScreen) {
      logoutScreen = true;
      loginZerodha(page);
    }
  });
  await page.setViewport({ width: 1500, height: 900 });
  await page.goto(`https://kite.zerodha.com/chart/web/ciq/INDICES/NIFTY%20500/268041`, {waitUntil: "domcontentloaded"});
  const iframeElementHandle = await page.waitForSelector('iframe'); // Assuming there's only one iframe
  const iframe = await iframeElementHandle.contentFrame();
  let indexInst, extractedNumber, strike, indexTick, cepe, slResponse, indexName;
 
  await page.exposeFunction('setStoploss', async (dataURL, ceKeyPressed, peKeyPressed) => {
  
  
    const tesConfig = {
      oem: 3,
      psm: 7, 
      tessedit_char_whitelist: '0123456789.'
    }
   
   
    const base64Data = dataURL.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    let image = await Jimp.read(buffer)
   
    image = image.resize(2 * image.bitmap.width, 2 * image.bitmap.height);
    let p = await image.getBase64Async(Jimp.MIME_PNG);
    
    const { data: { text } }= await Tesseract.recognize(p, "eng")
    console.log(">>>> text " + text)
    
    const number = text.match(/[-+]?\d*\.?\d+/);
    if(!number || !number[0] || Number(number[0]) < 10000) return;
    let extractedNumber = Number(number[0]);
    
    extractedNumber = trimToDigits(extractedNumber, 5)
    const formData = new URLSearchParams();
    //if(!indexTick) return;
    if(indexTick && ceKeyPressed) {
      formData.append('exitLevelCE', extractedNumber);
    } else if(indexTick && peKeyPressed) {
      formData.append('exitLevelPE', extractedNumber);
    } else if(indexTick && extractedNumber > indexTick.last_price) {
      formData.append('exitLevelCE', extractedNumber);
    } else {
      formData.append('exitLevelPE', extractedNumber);
    }
    formData.append('indexName', indexName);
    //console.log()
 
    await axios.post(`${host}/globalValues`, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded'}
    });
    let response = await axios.get(`${host}/status`);
    slResponse = response.data
   
    await iframe.evaluate((r, indexName) => { 
      const stoplossLineCE = document.querySelector('#stoplossLineCE');
      const stoplossLinePE = document.querySelector('#stoplossLinePE');
      stoplossLineCE.innerText = "SL CE = ";
      stoplossLinePE.innerText = "SL PE = ";
      stoplossLineCE.innerText += (r) ? r["Exit Level CE"][indexName] : "Error";
      stoplossLinePE.innerText += (r) ? r["Exit Level PE"][indexName] : "Error";
    },  response.data, indexName)
    
   
  });
  await page.exposeFunction('placeOrder', async (lots) => {

    console.log(">> place order lots = " + lots)
    const formData = new URLSearchParams();
    formData.append('strike', strike);
    formData.append('instrument', indexMap[indexInst]);
    formData.append('cepe', cepe);
    formData.append('sellQtyPercent', lots)
    formData.append('allTicks', JSON.stringify(getOptionPrices()))
    await axios.post(`${host}/sell`, formData, {
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}
    });
   
  });
  
  await page.exposeFunction('exitOrder', async (lots) => {
  
    console.log(">> exit order lots = " + lots)
    const formData = new URLSearchParams();
    formData.append('strike', strike);
    formData.append('instrument', indexMap[indexInst]);
    formData.append('cepe', cepe);
    if(lots) { //no lots if exiting full qty
      formData.append('exitQtyPercent', lots)
    }
   
    await axios.post(`${host}/exitPositions`, formData, {
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}
    });
   
  });
  await page.exposeFunction('handleMousemove', async (a, ceKeyPressed, peKeyPressed) => {
    const { data: { text } }= await Tesseract.recognize(a, 'eng')
    //if number of digits < 5 before dots, just return because all indices are above 10000
    if(parseInt(text) < 10000) return;
    extractedNumber = Number(text);
    
    extractedNumber = trimToDigits(extractedNumber, 5)
    let divideBy = 100;
    if(indexInst == 288009) { //midcap nifty
      divideBy = 25;
    } else if(indexInst == 256265 || indexInst == 257801) { //nifty and fin nifty
      divideBy = 50;
    }
    //get nearest number in 50's or 100's
    strike = Math.round(extractedNumber/divideBy) * divideBy;
    let optionPrices = getOptionPrices();
    if(!optionPrices) return;
    cepe = "PE";
    let optionprice;
    if(indexInst && extractedNumber) {
      let indexTickTemp = optionPrices.filter(p => p.instrument_token == indexInst)[0];
      if(indexTickTemp) {
        indexTick = indexTickTemp;
      }
     
      if(indexTick && extractedNumber > indexTick.last_price) {
        cepe = "CE"
      } 
      if(ceKeyPressed) {
        cepe = "CE"
      }
      if(peKeyPressed) {
        cepe = "PE"
      }
      
      optionprice = optionPrices.filter(p => p.name == indexMap[indexInst] && p.strike == strike && p.tradingsymbol.endsWith(cepe));
      if(optionprice) {
        optionprice = optionprice[0];
      }
    }
   
    //based on spot fetch strike premiums and show on tool tip
    await iframe.evaluate((value, i, optionprice) => { 
      const tooltip = document.querySelector('#algo-tooltip');
      tooltip.textContent = optionprice ? (optionprice.strike + optionprice.tradingsymbol.substring(optionprice.tradingsymbol.length - 2) + " = " + optionprice.last_price) : 0;
    },  extractedNumber, indexInst, optionprice)

   
  });
 
  
 
  await iframe.waitForSelector('.chartContainer');
  await iframe.waitForSelector('.stx-panel-chart');
  
  await iframe.evaluate(() => {
   
    console.log("iframe loaded")
    let spaceKeyPressed=false;
    let exitKeyPressed=false;
    let keyPressed = false;
    let keyPressedValue;
    let ceKeyPressed=false;
    let peKeyPressed = false;
    let clickTimeout;  
    const chartContainer = document.querySelector('.chartContainer');
    const chartPanel = document.querySelector('.stx-panel-chart');
    const tooltip = document.createElement('div');
    tooltip.id = 'algo-tooltip'
    tooltip.style.position = 'absolute';
    tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    tooltip.style.color = 'white';
    tooltip.style.padding = '5px';
    tooltip.style.borderRadius = '5px';
    tooltip.style.pointerEvents = 'none'; // Ensure the tooltip does not interfere with mouse events
    tooltip.style.display = 'none'; // Initially hide the tooltip
    chartContainer.appendChild(tooltip);
    //create line for stoploss
    const stoplossLineCE = Object.assign(document.createElement('div'), {
      id: 'stoplossLineCE',
 
    });
    const stoplossLinePE = Object.assign(document.createElement('div'), {
      id: 'stoplossLinePE',

     
    });
    const stxShow = chartContainer.querySelector('cq-chart-title')
    stxShow.appendChild(stoplossLineCE)
    stxShow.appendChild(stoplossLinePE)
   

    chartPanel.addEventListener('dblclick',  e => {
      if (clickTimeout) { //handle logic to not fire single click events on double click
        clearTimeout(clickTimeout);
        clickTimeout = null;
      }
      
      if(keyPressed && !ceKeyPressed && !peKeyPressed) {
        if(Number(keyPressedValue) >=1 && Number(keyPressedValue) <=9) {
          exitOrder(Number(keyPressedValue))
        } else if(exitKeyPressed) {
          exitOrder()
        }
       

      } else {
        const canvas = chartContainer.querySelectorAll('canvas')[3];
        const dataURL = canvas.toDataURL();
        setStoploss(dataURL, ceKeyPressed, peKeyPressed);
      }

    });


    function addEventListeners() {

      document.addEventListener('keydown', e => {
        keyPressed = true
        keyPressedValue = e.key;
        if (e.key === ' ') {
            spaceKeyPressed = true;
           
        } else if (e.key === 'e' || e.key === 'E') {
          exitKeyPressed = true;
           
        } else if(e.key === 'c' || e.key === 'C') {
          ceKeyPressed = true;
        } else if(e.key === 'p' || e.key === 'P') {
          peKeyPressed = true;
        }
      });


      document.addEventListener('keyup', e => {
        keyPressed = false;
        keyPressedValue = "";
        if (e.key === ' ') {
            spaceKeyPressed = false;
          
        } else  if (e.key === 'e' || e.key === 'E') {
          exitKeyPressed = false;
          
        } else if(e.key === 'c' || e.key === 'C') {
            ceKeyPressed = false;
        }else if(e.key === 'p' || e.key === 'P') {
            peKeyPressed = false;
        }
      });

      document.addEventListener('click', e => {
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
          return;
        }
        //this is to prevent click event being fired when double click happens
        clickTimeout = setTimeout(() => {
          if(Number(keyPressedValue) >=1 && Number(keyPressedValue) <=9) {
            placeOrder(Number(keyPressedValue))
          }
          if (exitKeyPressed) {
            console.log('Mouse clicked while exit key was pressed!');
          }
          clickTimeout = null;
        }, 200); // Adjust timeout as needed

      });
    }

    addEventListeners();

    let timeout;
    chartPanel.addEventListener('mousemove', (event) => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const canvas = chartContainer.querySelectorAll('canvas')[3];
        const dataURL = canvas.toDataURL();
        handleMousemove(dataURL, ceKeyPressed, peKeyPressed);
        tooltip.style.left = event.clientX + 10 + 'px'; 
        tooltip.style.top = event.clientY - 50 + 'px';
        tooltip.style.display = 'block';
      }, 50);
     
    });
    chartPanel.addEventListener('mouseout', () => {
      const tooltip = chartContainer.querySelector('#algo-tooltip');
      console.log("executing display none " + tooltip)
      tooltip.style.display = 'none';
    });

  })

  page.on('framenavigated', async frame => {
    
    if (frame != page.mainFrame()) return;
    const url = frame.url();
    const parts = url.split('/');
    indexInst = parts[parts.length - 1];
    indexName = indexMap[indexInst]
    let response = await axios.get(`${host}/status`);
    slResponse = response.data
    //show respective index's stop loss levels
    await iframe.evaluate((r, indexName) => { 
      const stoplossLineCE = document.querySelector('#stoplossLineCE');
      const stoplossLinePE = document.querySelector('#stoplossLinePE');
      stoplossLineCE.innerText = "SL CE = ";
      stoplossLinePE.innerText = "SL PE = ";
      stoplossLineCE.innerText += (r) ? r["Exit Level CE"][indexName] : "Error";
      stoplossLinePE.innerText += (r) ? r["Exit Level PE"][indexName] : "Error";
    },  slResponse, indexName)
    

  });

  // await page.waitForNavigation();
  //await browser.close();
}

run();




async function loginZerodha(page) {
    const token = totp("6XOVLZ3UHR6ZREHBUEGQLWYAWTVLPYWG");
    await page.goto(`https://kite.zerodha.com`, {waitUntil: "domcontentloaded"});
    await page.waitForTimeout(1000);
    await page.type('#userid', 'YC2151');
    await page.type('#password', 'aerial@258G');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.type('input', token);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tweleve button', { visible: true });
    await page.click('.tweleve button');
    await page.goto(`https://kite.zerodha.com/chart/web/ciq/INDICES/NIFTY%20500/268041`, {waitUntil: "domcontentloaded"});


}

async function launchBrowser() {
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
  ]);

  return new Promise((resolve, reject) => {
    chromeProcess.on('error', reject);
    // Give the browser some time to start
    setTimeout(resolve, 2000); // Adjust this delay if necessary
  });
}

async function isBrowserRunning(browserURL) {
  try {
    const response = await axios.get(browserURL);
    return response.status === 200;
  } catch {
    return false;
  }
}


const trimToDigits = (number, digits) => {
  let str = number.toString().replace('.', ''); 
  if (str.length <= digits) return number;      
  return Number(str.slice(0, digits));
};



