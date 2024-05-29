var KiteConnect = require("kiteconnect").KiteConnect;
var KiteTicker = require("kiteconnect").KiteTicker;
const puppeteer = require('puppeteer');
const totp = require("totp-generator");
const fs = require("fs");
const token = totp("6XOVLZ3UHR6ZREHBUEGQLWYAWTVLPYWG");

const express = require('express')
var bodyParser = require('body-parser')
const cors = require('cors');
const util = require('util');
const { format } = require("path");
const WebSocket = require('ws');
const e = require("express");
const path = require('path');
const { fn } = require("moment");
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
const { Mutex } = require('async-mutex');
const functionMutex = new Mutex();
const moment = require('moment-timezone');


const wss = new WebSocket.Server({ noServer: true });
const startTime = moment('9:15 AM', 'h:mm A');
const endTime = moment('3:30 PM', 'h:mm A');

const app = express()
const port = 3000
var jsonParser = bodyParser.json()
var urlencodedParser = bodyParser.urlencoded({ extended: false });
var ticker;


app.use(cors({
    origin: '*'
}));  
let instList;
let instListBFO;
let todayExpiryList;
let firstInst, secondInst;

app.use(express.static(path.join(__dirname, 'public')));

var api_key = "m3tm90xcurfqs6ed", secret = "neitcljdwghnhw9orky6bhmx9mqc6rko";
let api_key2 = "h57lwjsqf83r2v4k", secret2 = "cm6ciqf9zry69lfyxznwgp8smqnfdrxq";

//https://kite.zerodha.com/connect/login?v=3&api_key=m3tm90xcurfqs6ed
//https://kite.zerodha.com/connect/login?v=3&api_key=h57lwjsqf83r2v4k

var options = {
	"api_key": api_key,
	"debug": false
};

var options2 = {
	"api_key": api_key2,
	"debug": false
};

const map = {
	"BANKNIFTY" : 260105,
	"NIFTY": 256265,
	"FINNIFTY": 257801,
	"MIDCPNIFTY": 288009,
	"SENSEX": 265,
	"BANKEX": 274441
}

const map1 = {
	260105: "BANKNIFTY",
	256265: "NIFTY",
	257801: "FINNIFTY" ,
	288009: "MIDCPNIFTY",
	265: "SENSEX",
	274441: "BANKEX"
}

const ltpMap = {
	"BANKNIFTY": "NSE:NIFTY BANK",
	"NIFTY": "NSE:NIFTY 50",
	"FINNIFTY": "NSE:NIFTY FIN SERVICE" ,
	"MIDCPNIFTY": "NSE:NIFTY MID SELECT",
	"SENSEX": "BSE:SENSEX",
	"BANKEX": "BSE:BANKEX"
}

let  kc = new KiteConnect(options);
let kc2 = new KiteConnect(options2);
kc.setSessionExpiryHook(sessionHook);

let maxPlatformLoss = 800000; 
let curPlatformLoss = maxPlatformLoss;
let trailSL = .15 * maxPlatformLoss; // for every X profit trail the platfrom loss limit
// 4 stop losses assuming 2 for pe ce and 2 for 2 instruments being traded in one day only
let stoplossLevels = {};

let currentTicks;
let pnlObject = {};
let peakProfit = 0;
let pnlLogic = false;
let exitLevelCE = 0, exitLevelPE=0;

function initializeTicker() {
	console.log("Initializing Ticker")
	let at = fs.readFileSync("token");
	ticker = new KiteTicker({
		api_key: "m3tm90xcurfqs6ed",
		access_token: at
	});	
	ticker.connect();
	ticker.on('ticks', onTicks);
	ticker.on('connect', subscribe);
	ticker.on('disconnect', onDisconnect);
	ticker.on('error', onError);
	ticker.on('close', onClose);
	//ticker.on('order_update', onTrade);
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        console.log(`Received: ${message}`);

        // Broadcast the received message to all connected clients
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

function sendEventToClients(eventData) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(eventData));
        }
    });
}




app.server = app.listen(port, '0.0.0.0',async () => {
	console.log("Getting Token 1")
	await getToken(false, "");
	console.log("Now Getting Token 2")
	await getToken(true, "");
	
	console.log("Getting All Instruments in NFO")
	instList = await kc.getInstruments("NFO");
	instListBFO = await kc.getInstruments("BFO");
	filterInstruments();
	peakProfit = 0;
	curPlatformLoss = maxPlatformLoss;
	if(!ticker) initializeTicker();
	console.log(`app listening on port ${port}`)
	
	
	
	
})

app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

async function getToken(secondToken = false, requestToken) {
	
    let fileName = "token";
	let finalKc = kc;
	let finalSecret = secret;
	let finalApiKey = api_key;
	if(secondToken) {
		fileName = "token2";
		finalKc = kc2;
		finalSecret = secret2;
		finalApiKey = api_key2
	}
	let at = fs.readFileSync(fileName);
	finalKc.setAccessToken(at);
    try {
		
		await finalKc.getProfile()

	} catch {
		let request_token;
		try {

  	  console.log("getting new token")
	
	if(requestToken) {
		request_token = requestToken
	} else {
		const browser = await puppeteer.launch();
		const page = await browser.newPage();
		await page.goto(`https://kite.zerodha.com/connect/login?v=3&api_key=${finalApiKey}`, {waitUntil: "domcontentloaded"});
		await page.waitForTimeout(1000);
		await page.type('#userid', 'YC2151');
		await page.type('#password', 'aerial@258G');
		await page.click('button[type="submit"]');
		await page.waitForTimeout(1000);
		await page.type('input', token);
		await page.click('button[type="submit"]');
		await page.waitForNavigation();
		request_token = new URL(page.url()).searchParams.get('request_token');
		await browser.close();
	}
	
	console.log("Got request token !!")
	await finalKc.generateSession(request_token, finalSecret)
	.then(function(response) {
		console.log("Got access token !!");
		let at = response.access_token;
		finalKc.setAccessToken(at);
		fs.writeFileSync(fileName, at) 
		
	})

	} catch (e) {
			console.log(e)
	}

  }
  
}

function getContext() {
	return kc;
}

let i=1;
let kkk = 0;
let prevSubscribeItems = [];
let count = 0;

async function onTicks(ticks) {
	console.log("On Ticks")
	
	try {
		currentTicks = ticks;
		let pos= await kc.getPositions();
		let sellPos = []
		pos["net"].forEach(p => { 
	
			if(p.quantity != 0 && getUnderlying(p.tradingsymbol)) {
				sellPos.push(p.instrument_token)
				//also push the underlying instrument for level exit logic
				sellPos.push(map[getUnderlying(p.tradingsymbol)])
			}
	
		})
		if(sellPos.length == 0) {
			sellPos = [map["BANKNIFTY"]] //default subscribe bank nifty
		}
		
		
		ticker.unsubscribe(subscribeItems)
		ticker.subscribe(sellPos);
		subscribeItems = sellPos;
		if(ticks[0]["instrument_token"] == map["BANKNIFTY"]) {
			console.log("No open short positions.")
			return;
		}
		
		
		//console.log("Received Tick Length " + ticks.length)
		//console.log(ticks)
		//check if the underlying hasnt crossed stoploss, if yes then exit at market price. Auto determine pe/ce & instrument
	
		/*ticks.forEach(async t => {
			
			if(!stoplossLevels[map1[t.instrument_token]] || !stoplossLevels[map1[t.instrument_token]]["stoploss"]) return
			
			if((stoplossLevels[map1[t.instrument_token]]["cepe"] == "CE" && t.last_price > stoplossLevels[map1[t.instrument_token]]["stoploss"])
			|| ( stoplossLevels[map1[t.instrument_token]]["cepe"] == "PE" && t.last_price < stoplossLevels[map1[t.instrument_token]]["stoploss"])
			) {
				console.log("stop loss breached")
				
				//await exitAtMarket(stoplossLevels[map1[t.instrument_token]]["tradingsymbol"]);
			}
		})*/
		//if(!moment().tz("Asia/Kolkata").isBetween(startTime, endTime)) {
		//	console.log("Outside Of Market Timings")
		//	return;
		//}
		
		
		await pnlExitLogic(ticks)
	} catch(e) {
		console.log("Error in on Ticks");
		console.log(e);
	}
	
	

	
	
}



async function fn1(finalKc) {
	try {
		let k = await finalKc.getQuote(["NSE:NIFTY 50"]);
		console.log(k)
	} catch(e) {
		console.log(e);
		
		
	}
	
}

let slOrderIds = []; //fill this global variable
let autoModifyInProcess = false;
let totalSLQty = {}; //fill this global variable
let cancelOrdersInProgress = [];

async function initGlobal()  {
	let orders= await kc.getOrders();
	
	orders.forEach(p => { 
		if(p.order_type == 'SL' && p.status == 'TRIGGER PENDING') {
			slOrderIds.push(p.order_id);
			if(!totalSLQty[p.tradingsymbol]) {
				totalSLQty[p.tradingsymbol] = p.quantity
			} else {
				totalSLQty[p.tradingsymbol] = totalSLQty[p.tradingsymbol] + p.quantity
			}
		}

	})
}

async function fn2(i) {
	const release = await functionMutex.acquire();
	console.log(i)
	await new Promise((resolve) => setTimeout(resolve, 1000));
	release();
}
async function onTrade(order) {
	
	try {
		
		/*
		1) Create SLs automatically on creating sell positions. Cancel SLs automatically on exiting positions
		2) Buy Hedges automatically. Wont sell them automatically though
		3) Exit Sell Positions when cancelling any SL trigger

		*/
		console.log(order)
		let slModified = false

		if(order.order_type == 'SL' && order.status == 'CANCELLED') {
			//on cancelling SL, exit all sell order at market price
			/*let freezeLimit =  getFreezeLimit(getStrike(order.tradingsymbol)["strike"], order.tradingsymbol);
			let numFreezes = parseInt(sellQty / freezeLimit);
			let remQty = sellQty % freezeLimit;
			
			for (let i = 1; i<=numFreezes; i++) {
				let finalKc = kc;
				if(i > 15) {
					finalKc = kc2
				}
				exitAtMarketPrice(order.tradingsymbol, freezeLimit, finalKc) 
			}
			if(remQty > 0) {
				exitAtMarketPrice(tradingsymbol, remQty, kc)
			}*/

		}
	
		if(order.order_type == 'SL' && order.status == 'TRIGGER PENDING') {
			if(!slOrderIds.includes(order.order_id)) {
				slOrderIds.push(order.order_id); //store all sl order ids
			} else {
				slModified = true;
			}
			
			
		}
		if(order.order_type == 'SL' && order.status == 'TRIGGER PENDING' && !autoModifyInProcess && slModified) { 
			//if SL is modified, modify all other stop losse orders. This should happen only when modifying stop loss manually
			let orders = await kc.getOrders();
			orders.forEach(async o =>  {
				if(o.order_type !='SL' || order.tradingsymbol != o.tradingsymbol || order.order_id == o.order_id) return;
				if(o.order_type =='SL' && o.status == 'TRIGGER PENDING') {
					autoModifyInProcess = true
					if(o.trigger_price != order.trigger_price || o.price != order.price) {
						await kc.modifyOrder("regular", o.order_id, {"trigger_price": order.trigger_price,"price": order.price})
					}
				}
			});

			setTimeout(function() {
				autoModifyInProcess = false; //after you have auto modified all SL orders reset tbe variable
			}, 1000); 
		}


		
		if(!((order.status == 'CANCELLED' && order.pending_quantity > 0) || order.status == 'COMPLETE') || order.order_type == 'SL') {
			console.log("No action to perform")
			return; //we do nothing for partially filled orders / SL  Orders
		}
		
		if(order.transaction_type == 'SELL') {
			//check if sell order is not from the hedge position
			let hedgeOrder = true;
			let pos= await kc.getPositions();
			pos["net"].forEach(p => { 
		
				if(p.quantity < 0 && p.tradingsymbol == order.tradingsymbol) {
						hedgeOrder = false;
				}

			})
			if(hedgeOrder) {
				console.log("Found Hedge Buy Order. Doing Nothing")
				return;
			}
			let orderQty = order.quantity
			if(order.status == 'CANCELLED' && order.pending_quantity > 0 && order.filled_quantity > 0) {
				orderQty = order.filled_quantity
			}

			buyAutoHedges(order.tradingsymbol, orderQty, order.price);

			let stoploss = getSLValue(order.tradingsymbol);
			let triggerPrice = Math.round(order.average_price) + stoploss
			
			if(!totalSLQty[order.tradingsymbol]) {
				totalSLQty[order.tradingsymbol] = 0;
			}
			totalSLQty[order.tradingsymbol] = totalSLQty[order.tradingsymbol] + orderQty;
			
			try {
				await stoplossOrderPlace(triggerPrice, order.tradingsymbol, orderQty, kc)
			} catch(e) {
				console.log("Error !");
				console.log(e)
			}
           
			
			
			

		} else if(order.transaction_type == 'BUY')  {

			
			if(slOrderIds.includes(order.order_id)) return; //do nothing if the buy order is the one which is placed due to SL triggered

			//check if it's not from hedge position. If not from hedge then we need to remove SL orders as well
			let hedgeOrder = true;
			let pos= await kc.getPositions();
			let totalSellPos = 0;
			pos["net"].forEach(p => { 
		
				if(p.quantity <= 0 && p.tradingsymbol == order.tradingsymbol) {
					hedgeOrder = false;
				}
				if(p.quantity < 0 && p.tradingsymbol == order.tradingsymbol) {
					totalSellPos = p.quantity ;
				}
	
			})
			if(hedgeOrder) {
				console.log("Found Hedge Buy Order. Doing Nothing")
				return;
			}

			//if position is exited, cancel all stoploss trigger with the quanity exited . cancel in FIFO manner
			/*let orders = await kc.getOrders();
			//check if total SL triggers are greater than total sell positions then only we have to cancek SL triggers.
			//this will prervent the trigger cancel when triger is fired and limit order is placed because trigger automatically cancels in that case

			orders.forEach(o => {
				if(order.tradingsymbol != o.tradingsymbol) return;
				if(o.order_type =='SL' && o.status == 'TRIGGER PENDING') {
					totalSLQty += o.quantity;
				}
			});*/
			
			if(totalSLQty[order.tradingsymbol] <=  totalSellPos * -1)  {
				console.log("Trigger Quantity is less than Sell Qty")
				return;
			}

			await cancelTrigger(order);
			

		}
	} catch(e) {
		console.log(e)
	}

}

async function buyAutoHedges(sellTradingSymbol, quantity, sellPrice) {

	console.log("Buying Auto hedges")

	let pos= await kc.getPositions();
	let cepe = sellTradingSymbol.substring(sellTradingSymbol.length - 2);
	let hedgeQty = 0;
	let sellQty = 0;
	let hedgeTradingSymbol;
	let lastPrice;
	let strike = getStrike(sellTradingSymbol)["strike"];
	let minStrikeDiff = 1000000;

	//check if hedges already present. Then just buy that hedge. If multiple hedges choose the closer strike hedge
	pos["net"].forEach(p => { 
		
		let cepe1 = p.tradingsymbol.substring(p.tradingsymbol.length - 2)
		if(cepe != cepe1 || p.quantity <=0) return;

		let strike1 = getStrike(p.tradingsymbol)["strike"];

		let minStrikeDiff1 = Math.abs(strike1 - strike);
		if(p.tradingsymbol.substring(0,5) == sellTradingSymbol.substring(0,5) && minStrikeDiff1 < minStrikeDiff) {
			hedgeQty = hedgeQty + p.quantity
			hedgeTradingSymbol = p.tradingsymbol;
			lastPrice = p.last_price;
			minStrikeDiff = minStrikeDiff1;
		}
		if(p.tradingsymbol == sellTradingSymbol && p.quantity < 0) {
			sellQty = p.quantity * -1
		}  

	})

	if(hedgeQty >= sellQty) {
		console.log("Hedges already present " + hedgeQty)
		return;
	}

	if(hedgeTradingSymbol) {
		autoHedgeBuyOrder(hedgeTradingSymbol, quantity, lastPrice);
		return;
	}
	let inst = instList.filter(i => {
			
		if(i.tradingsymbol == sellTradingSymbol) {
			return i;
		}
	})[0]
	let finalInstList = instList;

	if(!inst || !inst["instrument_token"]) {
		inst = instListBFO.filter(i => {
			
			if(i.tradingsymbol == sellTradingSymbol) {
				return i;
			}
		})[0]
		finalInstList = instListBFO;
	}
	
	if(!inst || !inst["instrument_token"]) {
		console.log("Symbol not found in instrument list ");
		return;
	}

	let sellStrike = getStrike(sellTradingSymbol)["strike"];
	
	let cepeFactor = 1;
	if(cepe == 'PE') {
		cepeFactor = -1;
	}

	//get at least +900, -900 further strikes to compare
	let hedgeInst = [];
	for (let k = 1; k <= 18; k++) {
		let strike = sellStrike + cepeFactor * k * 50;
		finalInstList.filter(i => {
			if(!i.tradingsymbol) return;
			let cepe1 = i.tradingsymbol.substring(i.tradingsymbol.length - 2);
			if(cepe1 != cepe) return;
			if(i.tradingsymbol.substring(0,5) == sellTradingSymbol.substring(0,5) && Number(i.strike) == strike && moment(inst.expiry).format("YYYY-MM-DD") == moment(i.expiry).format("YYYY-MM-DD")) {
				let exchange = "NFO"
				if(sellTradingSymbol.startsWith("SENSEX") || sellTradingSymbol.startsWith("BANKEX")) {
					exchange = "BFO"
				}
				hedgeInst.push(exchange + ":" + i.tradingsymbol)
			}
		})
	
	}

	let ltp = await kc.getLTP(hedgeInst);
	let json = [];
	for (const key in ltp) {
		if (ltp.hasOwnProperty(key)) {
			let tradingsymbol = key.substring(4);
			let strike = getStrike(tradingsymbol)["strike"];
			json.push({"strike":strike, "last_price": ltp[key].last_price, "tradingsymbol": tradingsymbol})
	
		}
	}
	
	if(cepe == 'CE') {
		json.sort((a, b) => a.strike - b.strike); //sort in ascending for CE strikes
	} else {
		json.sort((b, a) => a.strike - b.strike); //sort in descending for PE strikes
	}
	
	
	
	for (let i = 0; i < json.length - 1; i++) {

		if(sellPrice < 7 && json[i]["last_price"] < 1.5) {
			hedgeTradingSymbol = json[i]["tradingsymbol"];
			lastPrice =  json[i]["last_price"];
			
		} else if(sellPrice < 10 && json[i]["last_price"] < 2) {
			hedgeTradingSymbol = json[i]["tradingsymbol"];
			lastPrice =  json[i]["last_price"];

		} else if(Math.abs(json[i]["last_price"] - json[i + 1]["last_price"]) < getStrikePriceDiff(sellTradingSymbol)) {
			hedgeTradingSymbol = json[i]["tradingsymbol"];
			lastPrice =  json[i]["last_price"];
			break;
		}
	}

	if(!hedgeTradingSymbol) {
		return;
	}
	autoHedgeBuyOrder(hedgeTradingSymbol, quantity, lastPrice)
	
	
}

async function autoHedgeBuyOrder(tradingsymbol, quantity, lastPrice) {
	const release = await functionMutex.acquire();
	try {
		let payload = {
			"exchange": "NFO",
			"tradingsymbol": tradingsymbol,
			"transaction_type": "BUY",
			"quantity": quantity,
			"product": "NRML",
			"order_type": "MARKET",
			"validity": "DAY",
	
		}
		if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
			payload["exchange"] = "BFO";
		}
		if(tradingsymbol.startsWith("BANKEX")) {
			payload["order_type"] = "LIMIT"
			payload["price"] = lastPrice + 0.5; // since bankex does not allow market order
		}
		
		await kc.placeOrder("regular", payload)
		
		
	} catch(e) {
		console.log("Error in buy auto hedges")
		console.log(e);

	} finally {
		release();
	}
	

}



async function pnlExitLogic(ticks, forceExit = false) {

	let p =  await getPnl(ticks);

	let pnl = p["pnl"] ? Number(p["pnl"]) : 0;
	let maxLossSymbol = p["maxLossSymbol"]
	let symbol1 = p["symbol1"]
	let symbol2 = p["symbol2"]
	let symbol3 = p["symbol3"]
	let maxLossQty = p["maxLossQty"]
	let symbolQty1 = p["symbolQty1"]
	let symbolQty2 = p["symbolQty2"]
	let symbolQty3 = p["symbolQty3"]
	let maxLossPrice = p["maxLossPrice"]
	let symbolPrice1 = p["symbolPrice1"]
	let symbolPrice2 = p["symbolPrice2"]
	let symbolPrice3 = p["symbolPrice3"]
	
	let onlyCEorPE = p["onlyCEorPE"]
	
	if(pnl > peakProfit) {
		peakProfit = pnl;
	}
	if(peakProfit > 0) {
		let steps = parseInt(peakProfit / trailSL);
		curPlatformLoss = maxPlatformLoss - (steps * trailSL)
	} else {
		curPlatformLoss = maxPlatformLoss;
	}
	

	console.log("pnl = " + pnl + " Current Platform Loss Limit " + curPlatformLoss)
	pnlObject = p;
	console.log(p)

	try {
		//exit position if patform loss is exceeded. First exit the position which has max loss value
		let pnlExit = (pnl * -1) >= maxPlatformLoss;
		let exitLevelLogicCEPE;
		let levelLogic = false;
		let applicableLevel;
		
		if(exitLevelCE > 0 || exitLevelPE > 0) {

			let r = exitLevelLogic(ticks);
			levelLogic = r["result"];
			exitLevelLogicCEPE = r["cepe"]; //outputs which level has brokern CE or PE
			applicableLevel = r["applicableLevel"];
			
		}		

		if(levelLogic || pnlExit) {

			
			console.log("PNL Exit Logic " + exit)
			console.log("Level Exit Logic " + levelLogic + " Applicable Level = " + applicableLevel + " " + exitLevelLogicCEPE)

			for (let i = 1; i <=4; i++) {
				//exit positions at market price
				//exit the max loss symbol first
				let tradingsymbol, sellQty, sellPrice;
				if(i == 1) {
					tradingsymbol = maxLossSymbol
					sellQty = maxLossQty;
					sellPrice = maxLossPrice;
				}
				if(i == 2) {
					tradingsymbol = symbol1;
					sellQty = symbolQty1
					sellPrice = symbolPrice1;
				}
				if(i == 3) {
					tradingsymbol = symbol2;
					sellQty = symbolQty2
					sellPrice = symbolPrice2;
				}
				if(i==4) {
					tradingsymbol = symbol3;
					sellQty = symbolQty3
					sellPrice = symbolPrice3;
				}
				if(!tradingsymbol) return;
				//if exit level logic then see whether CE should be exited or PE

				let cepe = tradingsymbol.substring(tradingsymbol.length - 2)
				

				if(!getUnderlying(tradingsymbol)) return; //anything else apart from nifty, bank nifty, fin etc
				//for Level logic, if we have CE and PE both, exit both because once the loss level breaks, opposite side will be in highest profit
				if(levelLogic && onlyCEorPE && exitLevelLogicCEPE && cepe != exitLevelLogicCEPE) return;
				exitLevelCE = 0; // reset to 0 once exit is happening
				exitLevelPE = 0;
				
				let freezeLimit =  getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);
				let numFreezes = parseInt(sellQty / freezeLimit);
				let remQty = sellQty % freezeLimit;
				
				for (let j = 1; j<=numFreezes; j++) {  
					let finalKc = kc;
					if(j > 15) {
						finalKc = kc2
					}
					exitAtMarketPrice(tradingsymbol, freezeLimit, sellPrice, finalKc) 
				}
				if(remQty > 0) {
					exitAtMarketPrice(tradingsymbol, remQty, sellPrice, kc)
				}

				//if somehow some positions not exited due to zerodha error, check again after few sec and try exiiting again by setting exit levels again
				checkForOpenPositions(exitLevelLogicCEPE);

				await new Promise(resolve => setTimeout(resolve, 1000)); //next loop after 500 ms

			}
	
		}

	}catch(e) {
		console.log(e);
	}
}

function checkForOpenPositions(exitLevelLogicCEPE) {
	const intervalId = setInterval(async () => {
		console.log("Checking in setInterval if there are any open positions left")
		let pos= await kc.getPositions(); 
		let openPositions = false;
		let ts, qty;
		pos["net"].forEach(el => {
			if(el.quantity < 0 && exitLevelLogicCEPE == el.tradingsymbol.substring(el.tradingsymbol.length - 2)) {
				openPositions = true;
				ts = el.tradingsymbol;
				qty = el.quantity;
				if(exitLevelLogicCEPE == "CE") {
					exitLevelCE = 1;
				} else if(exitLevelLogicCEPE == "PE"){
					exitLevelPE = 10000000
				}
			}
		})
		if(!openPositions) {
			if(exitLevelCE == 1) exitLevelCE = 0; //this should not happen but just in case
			if(exitLevelPE == 10000000) exitLevelPE = 0;
			console.log("There are no open positions left so clearing interval")
			clearInterval(intervalId);
		} else {
			console.log("Open positions found for " + tradingsymbol + " qty " + qty);
		}
		}, 2000);
}


function exitLevelLogic(ticks) {
	let result=false;
	let cepe = "";
	let applicableLevel;
	ticks.forEach(t => {
		
		if(exitLevelPE > 0 && t.last_price < exitLevelPE &&  allTokens.includes(Number(t.instrument_token))) {
			result=true
			cepe = 'PE';
			applicableLevel = exitLevelPE;
			return
			
		}

		if(exitLevelCE > 0 && t.last_price > exitLevelCE &&  allTokens.includes(Number(t.instrument_token))) {
			result=true
			cepe = 'CE';
			applicableLevel = exitLevelCE;
			return
			
		}
		
	})
	
	return {"cepe":cepe, "result": result };
}

async function getPnl(ticks) {
	let pnl = 0;
	let pos= await kc.getPositions();
	let symbolMap = {}
	//we wil store maximum 4 distinct option selling trading symbols. could be 2 CE & 2 PE
	let maxLossSymbol; //store the maximum loss  trading symbol, We will exit that first and then the remaining symbols
	let maxLoss = 100000000;
	let symbol1, symbol2, symbol3, symbol4;
	let maxLossQty = 0, symbolQty1 = 0, symbolQty2 = 0, symbolQty3 = 0, symbolQty4=0;
	let maxLossPrice = 0, symbolPrice1 = 0, symbolPrice2 = 0, symbolPrice3 = 0, symbolPrice4=0;
	let ce = false, pe=false;
	pos["net"].forEach(p => { 
		
		if(!getUnderlying(p.tradingsymbol)) return
		if(p.quantity == 0) {
			pnl = pnl + (p.sell_value - p.buy_value)
		} else {
			let ticker = getTicker(ticks, p.instrument_token)
			
			
			let last_price = ticker ? ticker.last_price : p.last_price; //use last ticker price, else use from get positions
			let symbolPnl = (p.sell_value - p.buy_value) + (p.quantity * last_price * p.multiplier) 
			pnl = pnl + symbolPnl
			
			if(p.quantity < 0) {
				let cepe = p.tradingsymbol.substring(p.tradingsymbol.length - 2)
				if(cepe=='CE') {
					ce = true
				}
				if(cepe=='PE') {
					pe=true;
				}
				symbolMap[p.instrument_token] = p.tradingsymbol;
				if(symbolPnl < maxLoss) {
					maxLoss = symbolPnl;
					maxLossSymbol = p.tradingsymbol;
					maxLossQty = p.quantity * -1;
					maxLossPrice = last_price;
				}
				if(!symbol1) {
					symbol1 = p.tradingsymbol;
					symbolQty1 = p.quantity * -1
					symbolPrice1 = last_price
				} else if(!symbol2) {
					symbol2 = p.tradingsymbol;
					symbolQty2 = p.quantity * -1
					symbolPrice2 = last_price
				} else if(!symbol3) {
					symbol3 = p.tradingsymbol;
					symbolQty3 = p.quantity * -1
					symbolPrice3 = last_price
				} else if(!symbol4) {
					symbol4 = p.tradingsymbol;
					symbolQty4 = p.quantity * -1
					symbolPrice4 = last_price
				}
				
			}

		}
		
	})
	if(symbol1 == maxLossSymbol) {
		symbol1 = symbol2;
		symbol2 = symbol3;
		symbol3 = symbol4;
		symbolQty1 = symbolQty2;
		symbolQty2 = symbolQty3;
		symbolQty3 = symbolQty4;
		symbolPrice1 = symbolPrice2;
		symbolPrice2 = symbolPrice3;
		symbolPrice3 = symbolPrice4;
	} else if(symbol2 = maxLossSymbol) {
		symbol2 = symbol3;
		symbol3 = symbol4;
		symbolQty2 = symbolQty3;
		symbolQty3 = symbolQty4
		symbolPrice2 = symbolPrice3;
		symbolPrice3 = symbolPrice4;
	} else if(symbol3 = maxLossSymbol) {
		symbol3 = symbol4;
		symbolQty3 = symbolQty4;
		symbolPrice3 = symbolPrice4;
	}

	let onlyCEorPE = false;
	if(ce && pe) {
		onlyCEorPE = false;
	} else if (ce || pe) {
		onlyCEorPE = true;
	}
	return {"pnl" : pnl, "maxLossSymbol": maxLossSymbol, "symbol1": symbol1, "symbol2": symbol2, "symbol3": symbol3, 
	"maxLossQty": maxLossQty, "symbolQty1": symbolQty1, "symbolQty2": symbolQty2, "symbolQty3": symbolQty3, "symbolMap": symbolMap, "onlyCEorPE": onlyCEorPE,
	"maxLossPrice": maxLossPrice, "symbolPrice1": symbolPrice1, "symbolPrice2": symbolPrice2, "symbolPrice3": symbolPrice3 
	};
}

function getTicker(ticks, instrument_token) {

	let tick;
	ticks.forEach(t => {
		if( t.instrument_token == instrument_token) {
			tick = t;
		}
		
	})
	return tick;
}


async function exitAtMarketPrice( tradingsymbol, qty, price, finalKc, ignoreCatch=0) {
	
	console.log("Exiting " + tradingsymbol + " Qty " + qty)
	let exchange = "NFO";
	if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
		exchange = "BFO"
	}
	try {
		await finalKc.placeOrder("regular", {
			"exchange": exchange,
			"tradingsymbol": tradingsymbol,
			"transaction_type": "BUY",
			"quantity": qty,
			"product": "NRML",
			"order_type": "MARKET",
			"validity": "DAY",

		})
		console.log("Exited " + tradingsymbol + " Qty " + qty)
	} catch(e) {
		//sensex, bankex can get market out of range error, try with limit order +10
		console.log("Error in Exiting " + tradingsymbol + " Qty " + qty)
		console.log(e)
		
		if(e.message && e.message.includes("range")) {
			console.log("Found range error. Now exiting at limit price " + (price+10))
			try {
				await finalKc.placeOrder("regular", {
					"exchange": exchange,
					"tradingsymbol": tradingsymbol,
					"transaction_type": "BUY",
					"quantity": qty,
					"product": "NRML",
					"order_type": "LIMIT",
					"price": price + 10,
					"validity": "DAY",
		
				})
			} catch (e) {
				console.log("Error in exiting at limit price as well")
				console.log(e)
			}
			
			
		}
		
		
		if(ignoreCatch <= 3) { // if exception due to rate limit, try once again after 500 ms. Do this only 3 times
			//console.log("Trial Number " + ignoreCatch)
			//await new Promise(resolve => setTimeout(resolve, 500));
			//exitAtMarketPrice(tradingsymbol, qty, finalKc, ignoreCatch + 1)
		}
		
	}
	
}


async function cancelTrigger(currentOrder) {

	const release = await functionMutex.acquire();
	try {
		console.log("Cancelling trigger for corresponding to exit order id " + currentOrder.order_id)
		let orders = await kc.getOrders();
		orders.sort((a, b) => Number(a.order_id) - Number(b.order_id));
				
		let  orderIds = [];
		let rem = currentOrder.quantity;
		if(currentOrder.order_type != 'SL' && currentOrder.status == 'CANCELLED' && currentOrder.pending_quantity > 0 && currentOrder.filled_quantity > 0) {
			rem = currentOrder.filled_quantity
		}
		let lastOrderId;
		let qtyToCancel = 0;

		orders.forEach(async o => {
			if(currentOrder.tradingsymbol != o.tradingsymbol) return;
			if(o.order_type =='SL' && o.status == 'TRIGGER PENDING' && rem > 0) {
				let orderId = o.order_id;
				qtyToCancel += o.quantity;
				rem = rem - o.quantity;
				

				if(rem < 0) {
					lastOrderId = o.order_id // last quantity remaining. This will need qty modification in the SL trigger order, rather than cancelling
					qtyToCancel = qtyToCancel + (rem + o.quantity);
				} else {
					orderIds.push(orderId); //orderIds to cancel
				}
			}
		});
		
		totalSLQty[currentOrder.tradingsymbol] = totalSLQty[currentOrder.tradingsymbol] - qtyToCancel; //adjust SL quantity first since concurrency problems can be there
		
		console.log("order ids " + orderIds + " last Order Id " + lastOrderId + " rem  =" + rem)
		for(let i = 0; i< orderIds.length; i++) {
			console.log("Cancelling Trigger order id  " + orderIds[i]);
			await cancelOrder(orderIds[i], kc)

		}
		//modify the last order
		if(rem < 0) {
			console.log("Modifying Trigger order id  " + lastOrderId);
			autoModifyInProcess = true; //mofidy order will call OnTrade, we want to tell we are modifying this automatically 
			await kc.modifyOrder("regular", lastOrderId, {quantity: rem * -1})
			//cancelOrdersInProgress = cancelOrdersInProgress.filter(item => item != lastOrderId); //remove the order id from last after modify is done, so it's ready to be modified again
			
			setTimeout(function() {
				autoModifyInProcess = false; 
			}, 1000); 
		}
	} catch(e) {

	} finally {
		release();
	}
	
}

async function cancelOrder(orderId, finalKc, attempts = 1) {
	try {
		await finalKc.cancelOrder("regular", orderId)
	} catch(e) {
		if(e.error_type == 'NetworkException' /*&& attempts <= 6*/) {
			//await new Promise(resolve => setTimeout(resolve, 200));
			//await cancelOrder("regular", orderId, finalKc, attempts + 1)
			try {
				await kc2.cancelOrder("regular", orderId)
			} catch(e) {
				console.log("Failed in 2nd attempt as well for cancel SL trigger")
				console.log(e)
			}
			
			
		}
	}
}


function arraysEqual(arr1, arr2) {
	if (arr1.length !== arr2.length) {
		return false;
	  }
	
	const sortedArr1 = arr1.slice().sort();
	const sortedArr2 = arr2.slice().sort();
	return sortedArr1.every((element, index) => element === sortedArr2[index]);
}

let subscribeItems = [260105] //banknifty
let allTokens = [260105, 256265, 257801, 265, 288009, 274441];
async function subscribe() {
	//var items = [260105, 256265, 257801, 265, 288009, 274441]; 
   
	//uncomment to subscribe
	ticker.subscribe(subscribeItems);
	ticker.setMode(ticker.modeFull, subscribeItems);
}



function onDisconnect(error) {
	console.log("Closed connection on disconnect", error);
}

function onError(error) {
	console.log("Closed connection on error", error);
}

function onClose(reason) {
	console.log("Closed connection on close", reason);
}

app.get('/token', async (req, res) => {
	
	//get Token if not present
	console.log("Getting Token 1")
	await getToken(false, ""); // second param is request token
	console.log("Now Getting Token 2")
	await getToken(true, "");
	if(!ticker) initializeTicker();
	
	peakProfit = 0;
	curPlatformLoss = maxPlatformLoss;
	res.send("Success!")
});

app.get('/status', async (req, res) => {
	
	res.send({
		"Exit Level CE": exitLevelCE,
		"Exit Level PE": exitLevelPE,
		"Pnl Logic": pnlLogic,
		"PeakProfit": peakProfit,
		"maxPLatformLoss": maxPlatformLoss,
		"CurrentPlatformStopLoss": curPlatformLoss,
		"pnl": pnlObject
	})
});

app.get('/logic', async (req, res) => {
	
	pnlLogic = !pnlLogic;
	res.send("PNL Logic = " + pnlLogic)
	
});

app.post('/globalValues', urlencodedParser, async (req, res) => {
	
	if(req.body.peakProfit) {
		peakProfit = req.body.peakProfit;
		
	}
	if(req.body.maxPlatformLoss) {
		maxPlatformLoss = req.body.maxPlatformLoss;
	}

	if(req.body.exitLevelCE) {
		exitLevelCE = req.body.exitLevelCE;

	} 
	if(req.body.exitLevelPE) {
		exitLevelPE = req.body.exitLevelPE;
	}

	res.send("Success!")
	
	
});

app.post('/sellHedges', urlencodedParser, async (req, res) => {
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	let response = await sellHedges(tradingsymbol)
	res.send(response)
})

app.post('/buyHedges', urlencodedParser, async (req, res) => {
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	let response = await buyHedges(tradingsymbol);
	res.send(response)
})

app.post('/exitPositions', urlencodedParser, async (req, res) => {
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	let response = await exitPositions(tradingsymbol, req.body.exitPrice, req.body.exitQtyPercent)
	res.send(response)
})




app.post('/sell', urlencodedParser, async (req, res) => {
	
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	let response = await sellPositions(tradingsymbol, req.body.sellQtyPercent, req.body.sellPrice, req.body.withoutHedgesFirst);
	res.send(response);
})

app.post('/addSL', urlencodedParser, async (req, res) => {

	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	
	let response = await addSL(Number(req.body.triggerPrice), tradingsymbol);
	res.send(response);
})

app.post('/modifySL', urlencodedParser, async (req, res) => {

	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	
	let response = await modifySL(tradingsymbol, Number(req.body.triggerPrice));
	res.send(response);
})

app.post('/exitAtMarket', urlencodedParser, async (req, res) => {
	
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	let response = await exitAtMarket(tradingsymbol);
	res.send(response);
})

app.post('/exitAllAtMarket', urlencodedParser, async (req, res) => {
	
	let response = await pnlExitLogic(currentTicks, true);
	res.send(response)
})


app.get('/existingPositions', urlencodedParser, async (req, res) => {
	
	let response = await existingPositions();
	res.send(response);
})

app.post('/modifyExitPrice', urlencodedParser, async (req, res) => {
	
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	let response = await modifyExitPrice(tradingsymbol, req.body.price);
	res.send(response);
})

app.post('/modifySellPrice', urlencodedParser, async (req, res) => {
	let tradingsymbol = calculateTradingSymbol(req.body.strike, req.body.instrument, req.body.cepe)
	
	let response = await modifySellPrice(tradingsymbol, req.body.price);
	res.send(response);
})

app.get('/strikePrices', urlencodedParser, async (req, res) => {
	
	
	let ltp = await kc.getLTP(ltpMap[req.query.instrument]);
	console.log(ltp)
	console.log(ltpMap[req.query.instrument])
	if(!ltp[ltpMap[req.query.instrument]]) return "Could not get Prices"
	let spotPrice = ltp[ltpMap[req.query.instrument]]["last_price"];
	let prices = [];
	if(req.query.instrument == "MIDCPNIFTY") {
		if(req.query.cepe == 'CE') {

			let temp = parseInt(spotPrice/25) + 1;
			for(let i = 0; i<5; i++)  {
				prices.push((temp + i) * 25)
			}
		} else {
			let temp = parseInt(spotPrice/25)
			for(let i = 0; i < 5; i++)  {
				prices.push((temp - i) * 25)
			}

		}

	} else if(req.query.instrument == "NIFTY" || req.query.instrument == "FINNIFTY") {
		if(req.query.cepe == 'CE') {

			let temp = parseInt(spotPrice/50) + 1;
			for(let i = 0; i<5; i++)  {
				prices.push((temp + i) * 50)
			}
		} else {
			let temp = parseInt(spotPrice/50)
			for(let i = 0; i < 5; i++)  {
				prices.push((temp - i) * 50)
			}

		}


	} else {
		if(req.query.cepe == 'CE') {

			let temp = parseInt(spotPrice/100) + 1;
			for(let i = 0; i<6; i++)  {
				prices.push((temp + i) * 100)
			}
		} else {
			let temp = parseInt(spotPrice/100)
			for(let i = 0; i < 6; i++)  {
				prices.push((temp - i) * 100)
			}

		}
	}
	res.send(prices);
})

app.post('/updateStoploss', urlencodedParser, async (req, res) => {
	
	//update stoploss map (automatically determine instrument & ce/pe). Check which SL is near to the instrument
	let sl = req.body.stoploss
	
	let positions = await kc.getPositions();
	let sellQty = 0;
	let firstCE = false;
	let firstPE = false;
	let firstSpotPriceCE = 0;
	let firstUnderlyingCE;
	let firstUnderlyingPE;
	
		
	await positions["net"].forEach(async el => {
		
		if(el.quantity >=0) return;
		let cepe = el.tradingsymbol.substring(el.tradingsymbol.length - 2);
		
		let underlying = getUnderlying(el.tradingsymbol);
		if(!stoplossLevels[underlying]) {
			stoplossLevels[underlying] = {};
		}
		
		let ltp = await kc.getLTP(ltpMap[underlying]);
		if(!ltp[ltpMap[underlying]]) return;
		let spotPrice = ltp[ltpMap[underlying]]["last_price"]
		if(el.quantity < 0 && cepe == 'CE' && sl > spotPrice && !firstCE)  {
			
			stoplossLevels[underlying]["stoploss"] = sl;
			stoplossLevels[underlying]["tradingsymbol"] = el.tradingsymbol;
			stoplossLevels[underlying]["cepe"] = "CE"
			firstUnderlyingCE = underlying;
			firstSpotPriceCE = spotPrice;
			firstCE = true
			
			
		} else if (el.quantity < 0 && cepe == 'CE' && sl > spotPrice && firstCE) {
			
			if(Math.abs(sl - spotPrice) < Math.abs(sl - firstSpotPriceCE)) { // if this instrument is nearer to SL that means SL was intended for this instrument
				
				stoplossLevels[underlying]["stoploss"] = sl;
				stoplossLevels[underlying]["tradingsymbol"] = el.tradingsymbol;
				stoplossLevels[underlying]["cepe"] = "CE"
				stoplossLevels[firstUnderlyingCE] = {};
			}
		} else if(el.quantity < 0 && cepe == 'PE' && sl < spotPrice && !firstPE)  {
			
			
			stoplossLevels[underlying]["stoploss"] = sl;
			stoplossLevels[underlying]["tradingsymbol"] = el.tradingsymbol;
			stoplossLevels[underlying]["cepe"] = "PE"
			firstUnderlyingPE = underlying;
			firstSpotPricePE = spotPrice;
			firstPE = true
			
			
		} else if (el.quantity < 0 && cepe == 'PE' && sl < spotPrice && firstPE) {
			if(Math.abs(sl - spotPrice) < Math.abs(sl - firstSpotPricePE)) { // if this instrument is nearer to SL that means SL was intended for this instrument
				
				stoplossLevels[underlying]["stoploss"] = sl;
				stoplossLevels[underlying]["tradingsymbol"] = el.tradingsymbol;
				stoplossLevels[underlying]["cepe"] = "PE"
				stoplossLevels[firstUnderlyingPE] = {};
			}
		}
		
	})
	
	res.send("Done");
})

async function existingPositions() {

	let positions = await kc.getPositions();
	
	let a = [];
	positions["net"].forEach(el => {
		
			a.push({"tradingsymbol": el.tradingsymbol})
		
		
	})
	return a;

}

async function modifyExitPrice(tradingsymbol, newPrice) {
	let orders = await kc.getOrders();
	tradingsymbol = await getSingleSellPos() || tradingsymbol;
	if(!tradingsymbol) {
		return "Enter trading symbol"
	}
		
		orders.forEach(async o => {
			if(o.order_type =='LIMIT' && o.status == 'OPEN' && o.tradingsymbol == tradingsymbol && o.transaction_type=='BUY') {
				await kc.modifyOrder(o.variety, o.order_id, {price: newPrice })
			}

		})
}

async function modifySellPrice(tradingsymbol, newPrice) {
	tradingsymbol = await getSingleSellPos() || tradingsymbol;
	if(!tradingsymbol) {
		return "Enter Trading Symbol";
	}
	let orders = await kc.getOrders();
		
	orders.forEach(async o => {
		if(o.order_type =='LIMIT' && o.status == 'OPEN' && o.tradingsymbol == tradingsymbol && o.transaction_type=='SELL') {
			await kc.modifyOrder(o.variety, o.order_id, {price: newPrice })
		}

	})
}

async function addSL(triggerPrice, tradingsymbol) {
	try {
		tradingsymbol = await getSingleSellPos() || tradingsymbol;
		if(!tradingsymbol) return "Enter trading symbol first"
		
		let positions = await kc.getPositions();
		let sellQty = 0;
		let payload;
		
		positions["net"].forEach(el => {
			
			if(el.quantity < 0 && el.tradingsymbol == tradingsymbol) {
				sellQty = el.quantity * -1;
				
			}
			
		})
		let freezeLimit =  getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);
		if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX") ) {
			let numFreezes = parseInt(sellQty / freezeLimit);
			let remQty = sellQty % freezeLimit;
			for(let i = 1; i<=numFreezes; i++) {
				payload = {
					"exchange": "BFO",
					"tradingsymbol": tradingsymbol,
					"transaction_type": "BUY",
					"quantity": freezeLimit,
					"product": "NRML",
					"order_type": "SL",
					"validity": "DAY",
					"trigger_price": Number(triggerPrice),
					"price": Number(triggerPrice) + getSLBuffer(tradingsymbol)
			
				}
				await kc.placeOrder("regular", payload)
			}
			payload = {
				"exchange": "BFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "BUY",
				"quantity": remQty,
				"product": "NRML",
				"order_type": "SL",
				"validity": "DAY",
				"trigger_price": Number(triggerPrice),
				"price": Number(triggerPrice) + getSLBuffer(tradingsymbol)
		
			}
			await kc.placeOrder("regular", payload)
			return;
		}
		

		let numIceberg = parseInt(sellQty / (10 * freezeLimit));
		let remIceberg = sellQty % (10 * freezeLimit);
		console.log(">>> " + remIceberg)

		for(let i = 1; i <= numIceberg; i++) {
			payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "BUY",
				"quantity": 10 * freezeLimit,
				"product": "NRML",
				"order_type": "SL",
				"validity": "DAY",
				"trigger_price": Number(triggerPrice),
				"price": Number(triggerPrice) + getSLBuffer(tradingsymbol),
				"iceberg_legs": 10,
				"iceberg_quantity": freezeLimit
	
			}
			await kc.placeOrder("iceberg", payload)
		}


		if(remIceberg > 0) {
			let iceberg_legs;
			if(remIceberg %  freezeLimit == 0) {
				iceberg_legs = parseInt(remIceberg /freezeLimit)
			} else {
				iceberg_legs = parseInt(remIceberg /freezeLimit) + 1;
			}
			let iceberg_quantity = remIceberg / iceberg_legs;
			if(iceberg_quantity != parseInt(iceberg_quantity)) {
				//find nearest lot 
				let temp  = parseInt(iceberg_quantity / getLotSize(tradingsymbol)) + 1
				iceberg_quantity = temp * getLotSize(tradingsymbol);

			}
			payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "BUY",
				"quantity": remIceberg,
				"product": "NRML",
				"order_type": "SL",
				"validity": "DAY",
				"trigger_price": Number(triggerPrice),
				"price": Number(triggerPrice) + getSLBuffer(tradingsymbol),
				"iceberg_legs": iceberg_legs,
				"iceberg_quantity": iceberg_quantity
	
			}
			await kc.placeOrder("iceberg", payload)
		}
		

		
	} catch(e) {
		console.log(e)
	}
}

async function modifySL(tradingsymbol, triggerPrice) {
	try {
		triggerPrice = Number(triggerPrice)
		console.log("Modify Trigger " + triggerPrice)
		let orders = await kc.getOrders();
		let multiple = false;
		let ts;
		
		orders.forEach(o => {
			if(o.order_type =='SL' && o.status == 'TRIGGER PENDING') {
				if(!ts) {
					ts = o.tradingsymbol
				} else if (o.tradingsymbol != ts) {
					multiple = true;
				}
			}

		})
		if(multiple && !tradingsymbol) {
			return "Enter trading symbol first"
		}
		tradingsymbol = tradingsymbol || ts;
		orders.forEach(async o => {
			if(o.order_type =='SL' && o.status == 'TRIGGER PENDING' && o.tradingsymbol == tradingsymbol) {
				try {
					await kc.modifyOrder(o.variety, o.order_id, {trigger_price: triggerPrice, price: triggerPrice + getSLBuffer(o.tradingsymbol) })
				} catch(e) {
					console.log(e)
				}
				
			}
		
		
		})

	} catch(e) {
		console.log(e)
	}
}

async function exitAtMarket(tradingsymbol) {
	
	try {

		tradingsymbol = await getSingleSellPos() || tradingsymbol;
		if(!tradingsymbol) return "Enter trading symbol first"
		
	
		let positions = await kc.getPositions();
		let sellQty = 0;
		
		positions["net"].forEach(el => {
			
			if(el.tradingsymbol == tradingsymbol && el.quantity < 0) {
				sellQty = el.quantity * -1;
				
			}
			
		})
		let freezeLimit =  getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);

		let numFreezes = parseInt(sellQty / freezeLimit);
		let payload;
		
		let remQty = sellQty % freezeLimit;
		
		for(let i = 1; i<=numFreezes; i++) {
			payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "BUY",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			await kc.placeOrder("regular", payload)
		}
		payload = {
			"exchange": "NFO",
			"tradingsymbol": tradingsymbol,
			"transaction_type": "BUY",
			"quantity": remQty,
			"product": "NRML",
			"order_type": "MARKET",
			"validity": "DAY"

		}
		if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
			payload["exchange"] = "BFO";
		}
		await kc.placeOrder("regular", payload)

	} catch (e) {
		console.log(e);
	}

	
}

function getHedgesStrikeDiff(tradingsymbol) {
	if(tradingsymbol.startsWith("BANKNIFTY")) {
		return 500;
	} else if(tradingsymbol.startsWith("NIFTY")) {
		return 150
	} else if(tradingsymbol.startsWith("MIDCP")) {
		return 100
	} else if(tradingsymbol.startsWith("FINNIFTY")) {
		return 150;
	} else if(tradingsymbol.startsWith("SENSEX")) {
		return 500
	} else if(tradingsymbol.startsWith("BANKEX")) {
		return 600;
	}
}

function getStrikePriceDiff(tradingsymbol) {
	if(tradingsymbol.startsWith("BANKNIFTY")) {
		return 0.5;
	} else if(tradingsymbol.startsWith("NIFTY")) {
		return 0.4
	} else if(tradingsymbol.startsWith("MIDCP")) {
		return 0.3
	} else if(tradingsymbol.startsWith("FINNIFTY")) {
		return 0.4;
	} else if(tradingsymbol.startsWith("SENSEX")) {
		return 0.5
	} else if(tradingsymbol.startsWith("BANKEX")) {
		return 0.5;
	}
}

async function getSingleSellPos() {
	let num = 0;
	let positions = await kc.getPositions();
	let tradingsymbol;
	
	positions["net"].forEach(el => {
		
		if(el.quantity < 0) {
			num ++;
			tradingsymbol = el.tradingsymbol;
		}
		
	})
	if(num == 1) {
		return tradingsymbol;
	} else return "";
}



async function getSingleHedgePos() {
	let num = 0;
	let positions = await kc.getPositions();
	let tradingsymbol;
	
	positions["net"].forEach(el => {
		
		if(el.quantity > 0) {
			num ++;
			tradingsymbol = el.tradingsymbol;
		}
		
	})
	if(num == 1) {
		return tradingsymbol;
	} else return "";
}





function getStrike(tradingsymbol) {
	let l = tradingsymbol.length;
	if(tradingsymbol.startsWith("BANKNIFTY")) {
		return {"prefix": tradingsymbol.substring(0, l-7), 
			"strike": Number(tradingsymbol.substring(l-7, l-2)) 
		}
	} else if(tradingsymbol.startsWith("NIFTY")) {
		return {"prefix": tradingsymbol.substring(0, l-7), 
			"strike": Number(tradingsymbol.substring(l-7, l-2)) 
		}
		
	} else if(tradingsymbol.startsWith("MIDCP")) {
		//check if midcap has reached 10k, i.e 7th digit from last is 1
		if(tradingsymbol.substring(l-7, l-6) == 1)  {
			return {"prefix": tradingsymbol.substring(0, l-6), 
			"strike": Number(tradingsymbol.substring(l-7, l-2)) 
			}
		}
		return {"prefix": tradingsymbol.substring(0, l-6), 
			"strike": Number(tradingsymbol.substring(l-6, l-2)) 
		}
		
	} else if(tradingsymbol.startsWith("FINNIFTY")) {
		return {"prefix": tradingsymbol.substring(0, l-7), 
			"strike": Number(tradingsymbol.substring(l-7, l-2)) 
		}
	} else if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
		return {"prefix": tradingsymbol.substring(0, l-7), 
			"strike": Number(tradingsymbol.substring(l-7, l-2)) 
		}
	}
}

function getUnderlying(tradingsymbol) {

	if(tradingsymbol.startsWith("BANKNIFTY")) {
		return "BANKNIFTY"
	} else if(tradingsymbol.startsWith("NIFTY")) {
		return "NIFTY";
		
	} else if(tradingsymbol.startsWith("MIDCP")) {
		return "MIDCPNIFTY"
		
	} else if(tradingsymbol.startsWith("FINNIFTY")) {
		return "FINNIFTY"
	} else if(tradingsymbol.startsWith("SENSEX")) {
		return "SENSEX"
	}
	else if(tradingsymbol.startsWith("BANKEX")) {
		return "BANKEX"
	} else return ""

}


function getFreezeLimit(price, tradingsymbol) {
	if(tradingsymbol.startsWith("BANKEX")) return 900;
	if(tradingsymbol.startsWith("SENSEX")) return 1000;
	if(tradingsymbol.startsWith("NIFTY")) return 1800;
	if(tradingsymbol.startsWith("FINNIFTY")) return 1800;
	if(tradingsymbol.startsWith("MIDCPNIFTY")) return 4200;
	if(tradingsymbol.startsWith("BANKNIFTY")) return 900;
	/*if(price > 5750 && price <=8625) return 5500;
	if(price >8625 && price <=11500 ) return 4200;
	if(price > 11500 && price <=17250) return 2800;
	if(price >17250 && price <=27500 ) return 1800;
	if(price > 27500 && price <= 40000) return 1200;
	if(price > 40000 && price <=55000) return 900;
	if(price > 60000) return 1000; // for sensex*/
	
}

function getMaxStrikeRange(tradingsymbol) {

	if(tradingsymbol.startsWith("BANKNIFTY")) {
		return 1000;
	} else if(tradingsymbol.startsWith("NIFTY")) {
		return 500
		
	} else if(tradingsymbol.startsWith("MIDCP")) {
		return 250
		
	} else if(tradingsymbol.startsWith("FINNIFTY")) {
		return 500
	} else if(tradingsymbol.startsWith("SENSEX")) {
		return 1000;
	}

}

function getLotSize(tradingsymbol) {
	if(tradingsymbol.startsWith("BANKNIFTY")) {
		return 15;
	} else if(tradingsymbol.startsWith("NIFTY")) {
		return 50;
		
	} else if(tradingsymbol.startsWith("MIDCP")) {
		return 75;
		
	} else if(tradingsymbol.startsWith("FINNIFTY")) {
		return 40;
	} else if(tradingsymbol.startsWith("SENSEX")) {
		return 10;
	} else if(tradingsymbol.startsWith("BANKEX")) {
		return 15;
	}
}

function getSLValue(symbol) {
	let stoploss = 10; //for nify and finnifty
			
	if(symbol.startsWith("MIDCP")) {
		stoploss = 7
	}
	if(symbol.startsWith("BANKNIFTY")) {
		stoploss = 20;
	}
	if(symbol.startsWith("BANKEX")) {
		stoploss = 25;
		
	}
	if(symbol.startsWith("SENSEX")) {
		stoploss = 30;
		
	}
	return stoploss;
}

function getSLBuffer(symbol) {
	
	let buffer = 2; //midcap & nifty
			
	
	if(symbol.startsWith("BANKNIFTY")) {
		buffer = 3;
	}
	if(symbol.startsWith("SENSEX") || symbol.startsWith("BANKEX")) {
		buffer = 4;
		
	}
	if(symbol.startsWith("FINNIFTY")) {
		buffer = 2;
		
	}
	return buffer;
}

async function stoplossOrderPlace(price, tradingsymbol, qty, finalKc, attempts = 1)  {
	const release = await functionMutex.acquire();
	try {

		console.log("placing SL order")
		let exchange = "NFO";
		if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
			exchange = "BFO";
		}
		let payload = {
			"exchange": exchange,
			"tradingsymbol": tradingsymbol,
			"transaction_type": "BUY",
			"quantity": qty,
			"product": "NRML",
			"order_type": "SL",
			"trigger_price": price,
			"price": price + getSLBuffer(tradingsymbol),
			"validity": "DAY",
			
			
			
		}
		console.log(payload)
		try {
			await finalKc.placeOrder("regular", payload)
		} catch(e) {
			console.log(e);
			//too many requests error, try with different kc, rotate alternatively
			if(e.error_type == 'NetworkException' /*&& attempts <=6*/) {
				//await new Promise(resolve => setTimeout(resolve, 200));
				//await stoplossOrderPlace(price, tradingsymbol, qty, finalKc, attempts + 1)
				try {
					await kc2.placeOrder("regular", payload)

				} catch(e) {
					console.log("Failed in Second attemp of stoplossOrderPlace ")
					console.log(e);
				}
				
			}

		}
		
	} catch(e) {

	} finally {
		release();
	}
	
	
}

function isExpiry(tradingsymbol) {
	let inst = instList.filter(i => {
			
		if(i.tradingsymbol == tradingsymbol) {
			return i;
		}
	})[0]

	let instBFO = instListBFO.filter(i => {
			
		if(i.tradingsymbol == tradingsymbol) {
			return i;
		}
	})[0]

	if(inst && moment(inst.expiry).date() == moment().date()) return true
	else if(instBFO && moment(instBFO.expiry).date() == moment().date()) return true

	return false;

}

function getTodayExpiryInst() {
	let list = instList.filter(i => {
	
		if(i.name != "NIFTY" && i.name != "BANKNIFTY" && i.name != "MIDCPNIFTY" && i.name != "FINNIFTY") return;
		
		if(moment(i.expiry).format("DD-MM-yyyy") == moment().format("DD-MM-yyyy") 
		/*&& i.tradingsymbol.startsWith("NIFTY")*/) { //if one day has two expiry just add this check eg NIFTY, BANKNIFTY, FINNIFTY, SENSEX
	
			if(!firstInst) {
				firstInst = i;
			}
			if(!secondInst && i.name != firstInst.name) {
				secondInst = i;
			}
			return i;
			
		}
	});

	
	if(list.length > 0 && list[0]["instrument_token"]) {
		return list;
	}
	let listBFO = instListBFO.filter(i => {
	
		if(i.name != 'SENSEX' && i.name != 'BANKEX') return;
		if(moment(i.expiry).format("DD-MM-yyyy") == moment().format("DD-MM-yyyy")) {
			if(!firstInst) {
				firstInst = i;
			}
			return i;
		}
	});

	if(listBFO.length > 0 && listBFO[0]["instrument_token"]) {
		return listBFO;
	}
	console.log("No expiry found today")

	
}

function calculateTradingSymbol(strike, inst, cepe) {
	let list = instList.filter(i => {
	
		if(i.name != "NIFTY" && i.name != "BANKNIFTY" && i.name != "MIDCPNIFTY" && i.name != "FINNIFTY") return;
	
		if(i.name == inst && i.strike == strike && i.instrument_type == cepe) return i;

	});

	
	if(list.length > 0 && list[0]["tradingsymbol"]) {
		return list[0].tradingsymbol;
	}
	let listBFO = instListBFO.filter(i => {
	
		if(i.name != 'SENSEX' && i.name != 'BANKEX') return;
		if(i.name == inst && i.strike == strike && i.instrument_type == cepe) return i;
			
	});

	if(listBFO.length > 0 && listBFO[0]["tradingsymbol"]) {
		return listBFO[0]["tradingsymbol"];
	}
	console.log("No expiry found today")
	
}


function getUnderlyingFromInst(instrument_token) {

	
	let list = instList.filter(i => { 
		if(i.instrument_token == instrument_token) {
			return i;
		}
	})

	if(list.length > 0 && list[0]["tradingsymbol"]) {
		return map[getUnderlying(list[0]["tradingsymbol"])];
	}
	
	

	list = instListBFO.filter(i => {
		if(i.instrument_token == instrument_token) {
			return i;
		}
	})

	if(list.length > 0 && list[0]["tradingsymbol"]) {
		return map[getUnderlying(list[0]["tradingsymbol"])];
	}

	
}

function getHedgeTradingsymbol(tradingsymbol) {
	let isCE = true;
	let cepe = tradingsymbol.substring(tradingsymbol.length - 2)
	if(cepe == 'PE') {
		isCE = false;
	}
	let hedgeStrike;
	if(isCE) {
		hedgeStrike = getStrike(tradingsymbol)["strike"] + getHedgesStrikeDiff(tradingsymbol);
	} else {
		hedgeStrike = getStrike(tradingsymbol)["strike"] - getHedgesStrikeDiff(tradingsymbol);
	}
	let hedgeTradingsymbol = getStrike(tradingsymbol)["prefix"] + hedgeStrike + cepe;
	return hedgeTradingsymbol;
}


async function sellPositions(tradingsymbol, numLegs, price, withoutHedgesFirst) {

	
	 //numLegs = no of freezes you want to purchase (eg for nifty id leg =2, means qty = 1800 * 2)
	try {
	
	if(!tradingsymbol)	{
		return "No trading symbol found"
	}
	if(!numLegs) {
		//numLegs = 32; //if no of baskets not given meaning use all capital
		return "Enter num of legs"
	}
	


	let positions = await kc.getPositions();
	let sellQty1 = 0, buyQty = 0;
	let cepe = tradingsymbol.substring(tradingsymbol.length - 2);
	let hedgeTradingsymbol1;
	let freezeLimit =  getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);
	
	//sum all the -ve positions
	positions["net"].forEach(el => {
		let cepe1 = el.tradingsymbol.substring(el.tradingsymbol.length - 2);
		if(el.quantity < 0 && el.tradingsymbol == tradingsymbol) {
			sellQty1 = el.quantity * -1;
		}
		if(el.quantity > 0 && cepe1 == cepe) {
			buyQty = el.quantity
			hedgeTradingsymbol1 = el.tradingsymbol;
		}
	})

	if((sellQty1 + numLegs * freezeLimit) <= buyQty) {
		//sell remaining positions directly, hedges are not required since they are already there

		for(let i = 1; i<= numLegs; i++) {
			payload = {
			   "exchange": "NFO",
			   "tradingsymbol": tradingsymbol,
			   "transaction_type": "SELL",
			   "quantity": freezeLimit,
			   "product": "NRML",
			   "order_type": "MARKET",
			   "validity": "DAY"
	   
		   }
		   if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
			   payload["exchange"] = "BFO";
		   }
		   if(price > 0) {
				payload["price"] = price;
				payload["order_type"] = "LIMIT"
			}
		   await kc.placeOrder("regular", payload)
	   }
	   return "Done";

	}

	let hedgeTradingsymbol = hedgeTradingsymbol1 || getHedgeTradingsymbol(tradingsymbol);
	
	let sellQty = 0; //allowable sell qty based on available margin
	let numLegs1 = numLegs;

	//try 5 times
	let availableMargin = await getAvailableMargin()
	for(let i = 0; i<=4; i++) {
		sellQty = freezeLimit * (numLegs - i);
		numLegs1 = numLegs - i;
		if(isExpiry(tradingsymbol)) {
			//if there is expiry you can by hedge first , hence check how many qty can be taken by using basket margins
	
			let bm = await basketMargins(tradingsymbol, hedgeTradingsymbol, freezeLimit * (numLegs - i));
			let marginUsed = bm["final"]["total"];
			if(availableMargin - marginUsed > 300000) {
				break;
			}
		} else if((numLegs - i) > 0){
			//if no expiry then you cannot purchase hedges first, hence try only with sell positions
			let om = await getRemainingMargin(tradingsymbol, freezeLimit * (numLegs - i));
			if(om > 300000) {
				break;
			}
			
		}
		

	}

	/*let totalQty = 0;
	let availableMargin = await getAvailableMargin()
	let start  = 12;
	if(availableMargin > 10000000 && availableMargin < 15000000) {
		start = 15;
	} else if (availableMargin >= 15000000 && availableMargin < 20000000) {
		start = 20;
	} else if (availableMargin >= 20000000 && availableMargin < 25000000) {
		start = 25;
	} else if (availableMargin >= 25000000 && availableMargin < 30000000) {
		start = 30;
	} else if (availableMargin >= 30000000) {
		start = 35;
	}

	//check straight away if asked quantity falls within the limit

	for (let i = start; i >=1; i-- ) {
		let bm = await basketMargins(tradingsymbol, hedgeTradingsymbol, freezeLimit * i);
		let marginUsed = bm["final"]["total"];
		if(availableMargin - marginUsed <= 300000) {
			break;
		}
		totalQty =  freezeLimit * i;
	}

	if(totalQty < sellQty) {
		sellQty = totalQty;
	}*/
	
	if(sellQty <= 0) {
		console.log("No margin available to sell")
		return "No margin available to sell";
	}
	
	await placeOrder(withoutHedgesFirst, tradingsymbol, hedgeTradingsymbol, sellQty, price, freezeLimit, numLegs1);
	
	} catch(e) {
		console.log(e);
	}
}

async function placeOrder(withoutHedgesFirst, tradingsymbol, hedgeTradingsymbol, totalQty, price, freezeLimit, numLegs) {

	let numFreezes = numLegs;
	
	
	let payload;
	
	
	if(isExpiry(tradingsymbol) && !withoutHedgesFirst) {
		//place hedge orders at market price first and place sell limit order (buy only remaining hedges if needed)
		
		let cepe = tradingsymbol.substring(tradingsymbol.length - 2);
		let positions = await kc.getPositions();
		let buyQty = 0;
		let sellQty = 0;
		
		positions["net"].forEach(el => {
			let cepe1 = el.tradingsymbol.substring(el.tradingsymbol.length - 2);
			if(cepe1 == cepe && el.tradingsymbol != tradingsymbol && el.quantity > 0) {
				buyQty = el.quantity;
				
			}
			if(el.tradingsymbol == tradingsymbol && el.quantity < 0) {
				sellQty = el.quantity * -1;
			}
			
		})

		let totalBuyQty = totalQty + (sellQty - buyQty);
		let numFreezesBuy=0;
		

		if(totalBuyQty > 0) {
			numFreezesBuy = parseInt(totalBuyQty / freezeLimit);

		}
 		
		for(let i = 1; i<= numFreezesBuy; i++) {
			 payload = {
				"exchange": "NFO",
				"tradingsymbol": hedgeTradingsymbol,
				"transaction_type": "BUY",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			await kc.placeOrder("regular", payload)
		}

		//now start with sell Positions

		for(let i = 1; i<= numFreezes; i++) {
			payload =  {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "SELL",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
				
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			if(price > 0) {
				payload["price"] = price;
				payload["order_type"] = "LIMIT"
			}
			await kc.placeOrder("regular", payload)
			
		}	


	} else {


		//if non expiry day then you cannot buy hedges first, so sell till the margin permits (until you get margin shortfall exception)
		for(let i = 1; i<= numFreezes; i++) {

			payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "SELL",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
				
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			if(price > 0) {
				payload["price"] = price;
				payload["order_type"] = "LIMIT"
			}
			try {
				await kc.placeOrder("regular", payload)
			} catch (e) {

			}
			

		}

	}
}



async function exitPositions(tradingsymbol, price, numLegs) {
	
	try {
		
		if(!numLegs) numLegs = 100; //take a very big quantity so that we can exit all
		tradingsymbol = await getSingleSellPos() || tradingsymbol;
		if(!tradingsymbol) return "Enter trading symbol first"
		let positions = await kc.getPositions();
		let freezeLimit =  getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);
		
		positions["net"].forEach(el => {
			
			if(el.tradingsymbol == tradingsymbol && el.quantity < 0) {
				sellQty = el.quantity * -1;
				
			}
			
		})
		
		let numFreezes = numLegs;
		
		for(let i = 1; i<= numFreezes; i++) {
			let payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "BUY",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			if(price > 0) {
				payload["price"] = price;
				payload["order_type"] = "LIMIT"
			}
			
			await kc.placeOrder("regular", payload)
		}
		
	} catch(e) {

	}

}



async function buyHedges(tradingsymbol) {
	
	try {
		//check how much sell quantity confirmed, order same buy quantity (if all sell quantity in pending then no buy order will execute)
		//tradingsymbol = await getSingleSellPos() || tradingsymbol;
		if(!tradingsymbol) {
			return "Enter trading symbol"
		}
		let positions = await kc.getPositions();
		let sellQty = 0, buyQty = 0;
		let cepe = tradingsymbol.substring(tradingsymbol.length - 2);
		positions["net"].forEach(el => {
			let cepe1 = el.tradingsymbol.substring(tradingsymbol.length - 2);
			if(cepe1 == cepe && el.quantity < 0) {
				sellQty = el.quantity * -1;
			}
			if(el.quantity > 0 && el.tradingsymbol == tradingsymbol) {
				buyQty = el.quantity
			}
			
		})

		
		let totalQty = (sellQty - buyQty);
		
		if(totalQty <= 0) {
			return "Hedges already present";
		}

		let numFreezes = parseInt(totalQty / getFreezeLimit(getStrike(tradingsymbol)["strike"]), tradingsymbol);
		let remQty = totalQty % getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);
		let payload;
		
		
		for(let i = 1; i<= numFreezes; i++) {
			payload = {
				"exchange": "NFO",
				"tradingsymbol": hedgeTradingsymbol,
				"transaction_type": "BUY",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY",
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			await kc.placeOrder("regular", payload)
		}

		if(remQty > 0) {
			payload = {
				"exchange": "NFO",
				"tradingsymbol": hedgeTradingsymbol,
				"transaction_type": "BUY",
				"quantity": remQty,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY",
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			await kc.placeOrder("regular", payload)
		}
	} catch(e) {

	}
}

async function getRemainingMargin(finalContract,tryQty) {
	let requiredMargin = await orderMargins(finalContract, tryQty)
	requiredMargin = requiredMargin[0].total
	let availableMargin =await kc.getMargins("equity");
	
	availableMargin =  availableMargin["net"];
	return availableMargin - requiredMargin;
	
}

async function getAvailableMargin() {
	
	let availableMargin =await kc.getMargins("equity");
	availableMargin =  availableMargin["net"];
	return availableMargin;
	
}

async function getTotalMargin() {
	let availableMargin =await kc.getMargins("equity");
	availableMargin =  availableMargin["available"]["cash"] + availableMargin["available"]["collateral"];
	return availableMargin;
}

async function limitOrderPlace(variety, price, tradingsymbol, qty, txnType) {
	
	return await kc.placeOrder(variety, {
			"exchange": "NFO",
			"tradingsymbol": tradingsymbol,
			"transaction_type": txnType || "SELL",
			"quantity": qty,
			"product": "NRML",
			"order_type": "LIMIT",
			"price": price,
			"validity": "DAY",
			"gtt_params": [[0,-9],[0,200]] //target of -9%, stop loss of 200%

		})
}

async function placeGTT(tradingsymbol, last_price, stoploss, target, qty) {
	return await kc.placeGTT({
		trigger_type: kc.GTT_TYPE_OCO,
		tradingsymbol: tradingsymbol,
		exchange: "NFO",
		trigger_values: [target, stoploss], //[target, stoploss]
		last_price: last_price,
		orders: [{
			transaction_type: kc.TRANSACTION_TYPE_BUY,
			quantity: qty,
			order_type: kc.ORDER_TYPE_LIMIT,
			price: target + .05 //target price
		}, {
			transaction_type: kc.TRANSACTION_TYPE_BUY,
			quantity: qty,
			order_type: kc.ORDER_TYPE_LIMIT,
			price: stoploss + .05 //stoploss
		}]
	})
}

function getContractDate() {

	if(moment().day() > 4) {
		
		return moment().add(1, 'weeks').weekday(4).format("YYMD");
	}
	return moment().weekday(4).format("YYMD");
}

async function orderMargins(tradingsymbol, qty) {
	exchange="NFO";
	if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) exchange="BFO"
	return await kc.orderMargins([
	{
        "exchange": exchange,
        "tradingsymbol": tradingsymbol,
        "transaction_type": "SELL",
        "variety": "regular",
        "product": "NRML",
        "order_type": "MARKET",
        "quantity": qty
    }], "compact");
}

async function cancelAllPending() {
	let orders = await kc.getOrders();
	orders.forEach(async order => {
		if(order.status == 'OPEN') {
			await kc.cancelOrder("regular", order.order_id)
		}
	})
	await cancelAllGTT();
	return "Done!"
}

async function sellHedges(tradingsymbol) {
	try {
		tradingsymbol = await getSingleHedgePos() || tradingsymbol;
		if(!tradingsymbol) return "Enter trading symbol first"
		
	
		let positions = await kc.getPositions();
		//since you are exiting all hedges make sure there is no of sell is <= no of buys
		let cepe = tradingsymbol.substring(tradingsymbol.length - 2);
		let strike = getStrike(tradingsymbol)["strike"]
		let sellQty = 0;
		let buyQty = 0;
		let buyQtyOtherHedge = 0;

		positions["net"].forEach(el => {
			let cepe1 = el.tradingsymbol.substring(el.tradingsymbol.length - 2);
			let strike1 = getStrike(el.tradingsymbol)["strike"];
			if(cepe1 == cepe && el.quantity < 0) {
				sellQty = el.quantity * -1;
				
			}
			if(el.tradingsymbol == tradingsymbol && el.quantity > 0) {
				buyQty = el.quantity;
			}

			
			if(el.quantity > 0 && cepe1 == cepe && ((cepe == 'CE' && strike1 < strike) || (cepe=='PE' && strike1 > strike))) {
				buyQtyOtherHedge = el.quantity
			}
			
		})

		
		
		
		if((buyQtyOtherHedge < sellQty && buyQty <= sellQty)) {
			console.log("Cannot exit hedges as sell positions >= hedges")
			return "Cannot exit hedges as sell positions >= hedges"
		}
		
		let freezeLimit =  getFreezeLimit(getStrike(tradingsymbol)["strike"], tradingsymbol);
		let netQty = (buyQtyOtherHedge >= sellQty) ? buyQty : (buyQty - sellQty);
		if(netQty < 0) {
			return "Sell Quantities are more than hedge. Cannot sell"
		}
		let numFreezes = parseInt(netQty / freezeLimit);
		let payload;
		
		let remQty = netQty % freezeLimit;
		
		for(let i = 1; i<=numFreezes; i++) {
			payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "SELL",
				"quantity": freezeLimit,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
		
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			await kc.placeOrder("regular", payload)
		}
		if(remQty > 0) {
			payload = {
				"exchange": "NFO",
				"tradingsymbol": tradingsymbol,
				"transaction_type": "SELL",
				"quantity": remQty,
				"product": "NRML",
				"order_type": "MARKET",
				"validity": "DAY"
	
			}
			if(tradingsymbol.startsWith("SENSEX") || tradingsymbol.startsWith("BANKEX")) {
				payload["exchange"] = "BFO";
			}
			await kc.placeOrder("regular", payload)
		}
		

	} catch (e) {
		console.log(e);
	}
	
	
}

async function buyHedgesEqualtoSell() {
	
	let positions = await kc.getPositions();
	
	let sellQty = 0, buyQty = 0;
	
	let selltradingsymbol;
	let qtyFreeze = 1800;
	
	positions["net"].forEach(el => {
		if(!el.tradingsymbol.includes("NIFTY")) return;
		if(el.tradingsymbol.includes("BANKNIFTY")) qtyFreeze=900;
		if(el.quantity < 0) {
			sellQty = sellQty + el.quantity * -1; 
			selltradingsymbol = el.tradingsymbol;
		}
		if(el.quantity > 0) {
			buyQty = buyQty + el.quantity
			
		}
	})
	if(sellQty == 0)
	return "No short positions found to hedge";
	if(sellQty <= buyQty)
	return "All Hedges already present"

	let sellStrike = Number(selltradingsymbol.substring(selltradingsymbol.length - 7, selltradingsymbol.length - 2))
	
	let cepe = selltradingsymbol.substring(selltradingsymbol.length - 2);
	let strikeChange = 400;
	let prefix = "NIFTY";
	if(qtyFreeze == 900) { //bank nifty 
		strikeChange = 600 ;
		prefix = "BANKNIFTY";
	}
	if(cepe == 'PE') {
		strikeChange = -400
		if(qtyFreeze == 900) strikeChange = -600
	}
	let buyContract = prefix + getContractDate() + (sellStrike + strikeChange) + cepe;
	let buyStrikePremium = await kc.getQuote(["NFO:" + buyContract]);
	buyStrikePremium = Number(buyStrikePremium["NFO:" + buyContract].last_price);
	
	let remQty = sellQty - buyQty;
	while(remQty > 0) {
		let qty=0;
		if(remQty > qtyFreeze) {
			qty = qtyFreeze
			remQty = remQty - qtyFreeze
		} else {
			qty = remQty;
			remQty = 0;
		}
		try {
			await limitOrderPlace("regular", buyStrikePremium + .05, buyContract, qty, "BUY")
		} catch(res) {
			console.log(res)
			return "Got error"
			
		}
		
	}
	return "Placed order for hedges Qty = " + (sellQty - buyQty)
	
}

async function exitAtLoss() {
	let positions = await kc.getPositions();
	let buytradingsymbol, selltradingsymbol, sellQty=0, buyQty=0;
	let qtyFreeze=1800;
	positions["net"].forEach(el => {
		if(!el.tradingsymbol.includes("NIFTY")) return;
		if(el.tradingsymbol.includes("BANKNIFTY")) qtyFreeze=900;
		if(el.quantity < 0) {
			sellQty = sellQty + el.quantity * -1; 
			selltradingsymbol = el.tradingsymbol
		}
		if(el.quantity > 0) {
			buyQty = buyQty + el.quantity
			buytradingsymbol = el.tradingsymbol
		}
	})
	
	if(selltradingsymbol) {
		let qty=0;
		while(sellQty > 0) {
			if(sellQty <= qtyFreeze) {
				qty = sellQty;
			} else {
				qty = qtyFreeze;
			}
			try {
				await regularOrderPlace("regular", selltradingsymbol ,qty, "BUY")
			} catch(e) {
				return "Error"
			}
			
			sellQty = sellQty - qty;
		}
	}
	if(buytradingsymbol) {

		let qty=0;
		while(buyQty > 0) {
			if(buyQty <= qtyFreeze) {
				qty = buyQty;
			} else {
				qty = qtyFreeze;
			}
			try {
				await regularOrderPlace("regular", buytradingsymbol ,qty, "SELL")
			} catch(e) {
				return "Error!"
			}
			
			buyQty = buyQty - qty;
		}
	}
	
	await cancelAllGTT();
	return "Exited";
}

async function cancelAllGTT() {
	let orders = await kc.getGTTs();
	orders.forEach(order => {
		if(order.status == 'active') {
			kc.deleteGTT(order.id).then();
		}
		
	})
}

/*async function modifyOrders() {
	let pos = await kc.getOrders();
		
	pos["net"].forEach(p => {
			if(order.tradingsymbol == p.tradingsymbol && p.quantity < 0) {
				placeGTT = true;
				return;
			}
		
	})
	kc.modifyOrder(variety, order_id, {
		quantity: 2
	}).
}*/

async function processBankNiftyAlgo(premium, cepe, premiumLimit) {
    premium = Number(premium)
	premiumLimit = Number(premiumLimit)
	let niftySpot = await kc.getQuote(["NSE:NIFTY BANK"]);
	let niftyPrice = parseInt(niftySpot["NSE:NIFTY BANK"].last_price);
	let factor = parseInt(niftyPrice/100);
	
	let increment1 = 200, increment2 = 300, increment3 = 400, increment4=500, increment5=600, increment6=700,
	increment7=800, increment8=900, increment9=1000;
	if(cepe == 'PE') {
		increment1 *=  -1, increment2 *=  -1, increment3 *=  -1, increment4 *=  -1, increment5 *=  -1, increment6 *=  -1,
		increment7 *=  -1, increment8 *=  -1;
	}
	
	let strike1 = (factor * 100) + increment1 + cepe
	let strike2 = (factor * 100) + increment2 + cepe
	let strike3 = (factor * 100) + increment3 + cepe
	let strike4 = (factor * 100) + increment4 + cepe
	let strike5 = (factor * 100) + increment5 + cepe
	let strike6 = (factor * 100) + increment6 + cepe
	let strike7 = (factor * 100) + increment7 + cepe
	let strike8 = (factor * 100) + increment8 + cepe
	
	
	let contract1 = "NFO:" + "BANKNIFTY" + getContractDate() + strike1
	let contract2 = "NFO:" + "BANKNIFTY" + getContractDate() + strike2
	let contract3 = "NFO:" + "BANKNIFTY" + getContractDate() + strike3
	let contract4 = "NFO:" + "BANKNIFTY" + getContractDate() + strike4
	let contract5 = "NFO:" + "BANKNIFTY" + getContractDate() + strike5
	let contract6 = "NFO:" + "BANKNIFTY" + getContractDate() + strike6
	let contract7 = "NFO:" + "BANKNIFTY" + getContractDate() + strike7
	let contract8 = "NFO:" + "BANKNIFTY" + getContractDate() + strike8
	

	let contractStrikeMapping = [];
	contractStrikeMapping[contract1] = strike1;
	contractStrikeMapping[contract2] = strike2;
	contractStrikeMapping[contract3] = strike3;
	contractStrikeMapping[contract4] = strike4;
	contractStrikeMapping[contract5] = strike5;
	contractStrikeMapping[contract6] = strike6;
	contractStrikeMapping[contract7] = strike7;
	contractStrikeMapping[contract8] = strike8;
	
	

	
	let quote = await kc.getQuote([contract1,contract2,contract3,contract4,contract5,contract6,
		contract7,contract8 ]);
	let finalContract;	
	let finalContractPremium;
	let finalStrike;
	Object.keys(quote).forEach(function(key) {
		if(quote[key].last_price <= premium && quote[key].last_price >= premium -1) {
			finalContract = key;
			finalContractPremium = Number(quote[key].last_price);
			finalStrike = contractStrikeMapping[finalContract];
			return;
		}
	})
	if(!finalContract) {
		return "Strike with this Premium not found";
	} 
	finalContract = finalContract.replace("NFO:","")
	let limitPrice = finalContractPremium + premiumLimit;
	let tryQty = 900;
	let totalQty = 0;
	let initialRemainingMargin = await getAvailableMargin();
	let stoploss = limitPrice * 4;
	let target = limitPrice - 1;
	let buyQty = 0;
	//we are not buying automatic hedges instead we are providing button
	/*if(initialRemainingMargin < 400000) {
		//if no balance this means we need to buy hedges
		buyQty = await buyHedges(finalStrike, cepe);
		if(buyQty == 0) {
			return "No more margin remaining"
		}

	}*/

	if(initialRemainingMargin <= 250000) 
	return "Margin not sufficient. Try buying hedges";

	while(tryQty >= 50 && initialRemainingMargin > 250000) {
		
		remainingMargin = await getRemainingMargin(finalContract,tryQty)
		
		if(remainingMargin > 250000) { //have at least 2.5L remaining
		   //place sell order 
		   try {
			await limitOrderPlace("regular", limitPrice ,finalContract, tryQty)
		   } catch(e) {
			console.log(e)
			 return "Error!"
		   }
			
			//await placeGTT(finalContract, finalContractPremium, stoploss,target,tryQty ) //will place gtt only when order is executed using websocket 
			totalQty = totalQty + tryQty;
		}  else {
			//try with smaller quantity
			tryQty = tryQty - 50
		}
		
	}
	
	return "Premium Found " + finalContract + " Sold Qty = " + totalQty
 	
}


function sessionHook() {
	console.log("User loggedout");
}


function filterInstruments() {
	instList = instList.filter(i => checkIfIndex(i.name))
	instListBFO = instListBFO.filter(i => checkIfIndex(i.name))
	
	const minDateNifty = instList.reduce((min, item) => (item.name=="NIFTY" && item.expiry < min) ? item.expiry : min, new Date("9999-12-31"));
	const minDateBankNifty = instList.reduce((min, item) => (item.name=="BANKNIFTY" && item.expiry < min) ? item.expiry : min, new Date("9999-12-31"));
	const minDateFinNifty = instList.reduce((min, item) => (item.name=="FINNIFTY" && item.expiry < min) ? item.expiry : min, new Date("9999-12-31"));
	const minDateMidcpNifty = instList.reduce((min, item) => (item.name=="MIDCPNIFTY" && item.expiry < min) ? item.expiry : min, new Date("9999-12-31"));
	const minDateSensex = instListBFO.reduce((min, item) => (item.name=="SENSEX" && item.expiry < min) ? item.expiry : min, new Date("9999-12-31"));
	const minDateBankex = instListBFO.reduce((min, item) => (item.name=="BANKEX" && item.expiry < min) ? item.expiry : min, new Date("9999-12-31"));

	instList = instList.filter(i => {
		if(i.name=="NIFTY" && i.expiry.getTime() == minDateNifty.getTime() || i.name=="BANKNIFTY" && i.expiry.getTime() == minDateBankNifty.getTime() ||
		i.name=="FINNIFTY" && i.expiry.getTime() == minDateFinNifty.getTime() || i.name=="MIDCPNIFTY" && i.expiry.getTime() == minDateMidcpNifty.getTime()) {
			return true;
		}
		
	})
	

	instListBFO = instListBFO.filter(i => {
		if(i.name=="SENSEX" && i.expiry.getTime() == minDateSensex.getTime() || i.name=="BANKEX" && i.expiry.getTime() == minDateBankex.getTime() ) {
		
			return true;
		}
		
	})
}

function checkIfIndex(name) {
	if(!name) return false;
	if(name == "BANKNIFTY" || name == "NIFTY" || name == "FINNIFTY"
		|| name == "MIDCPNIFTY" || name == "SENSEX" || name == "BANKEX") {

		return true;
	} else {
		return false;
	}
	
}

function getProfile() {
	kc.getProfile()
		.then(function(response) {
			console.log(response)
		}).catch(function(err) {
			console.log(err);
		});
}

function getMargins(segment) {
	kc.getMargins(segment)
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getPositions() {
	kc.getPositions()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getHoldings() {
	kc.getHoldings()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err.response);
		});
}

function getOrders() {
	kc.getOrders()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getOrderHistory() {
	kc.getOrders()
		.then(function(response) {
			if (response.length === 0) {
				console.log("No orders.")
				return
			}

			kc.getOrderHistory(response[0].order_id)
				.then(function(response) {
					console.log(response);
				}).catch(function(err) {
					console.log(err);
				});
		}).catch(function(err) {
			console.log(err);
		});
}

function getTrades() {
	kc.getTrades()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getOrderTrades() {
	kc.getOrders()
		.then(function(response) {
			var completedOrdersID;
			for (var order of response) {
				if (order.status === kc.STATUS_COMPLETE) {
					completedOrdersID = order.order_id;
					break;
				}
			}

			if (!completedOrdersID) {
				console.log("No completed orders.")
				return
			}

			kc.getOrderTrades(completedOrdersID)
				.then(function(response) {
					console.log(response);
				}).catch(function(err) {
					console.log(err);
				});
		}).catch(function(err) {
			console.log(err);
		});
}

function getInstruments(exchange) {
	kc.getInstruments(exchange).then(function(response) {
		console.log(response);
	}).catch(function(err) {
		console.log(err);
	})
}

function getQuote(instruments) {
	kc.getQuote(instruments).then(function(response) {
		console.log(response);
	}).catch(function(err) {
		console.log(err);
	})
}

function getOHLC(instruments) {
	kc.getOHLC(instruments).then(function(response) {
		console.log(response);
	}).catch(function(err) {
		console.log(err);
	})
}

function getLTP(instruments) {
	kc.getLTP(instruments).then(function(response) {
		console.log(response);
	}).catch(function(err) {
		console.log(err);
	})
}

function getHistoricalData(instrument_token, interval, from_date, to_date, continuous) {
	kc.getHistoricalData(instrument_token, interval, from_date, to_date, continuous)
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getMFInstruments() {
	kc.getMFInstruments()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getMFOrders() {
	kc.getMFOrders()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getMFSIPS() {
	kc.getMFSIPS()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function invalidateAccessToken(access_token) {
	kc.invalidateAccessToken(access_token)
		.then(function(response) {
			console.log(response);
			testOrders();
		}).catch(function(err) {
			console.log(err.response);
		});
}

function regularOrderPlace(variety, tradingsymbol, qty, txnType) {
	kc.placeOrder(variety, {
			"exchange": "NFO",
			"tradingsymbol": tradingsymbol,
			"transaction_type": txnType,
			"quantity": qty,
			"product": "NRML",
			"order_type": "MARKET"
		}).then(function(resp) {
			console.log(resp);
		}).catch(function(err) {
			console.log(err);
		});
}




function icebergTTLOrderPlace(variety) {
	kc.placeOrder(variety, {
        "exchange": "NSE",
        "tradingsymbol": "SBIN",
        "transaction_type": "BUY",
        "quantity": 1000,
        "product": "CNC",
        "order_type": "LIMIT",
        "validity":"TTL",
        "price":432, 
        "validity_ttl":10,
        "iceberg_legs":5, 
        "iceberg_quantity":200 
    }).then(function(resp) {
        console.log(resp);
    }).catch(function(err) {
        console.log(err);
    });
}

function modifyOrder(variety) {
	var tradingsymbol = "RELIANCE";
	var exchange = "NSE";
	var instrument = exchange + ":" + tradingsymbol;

	function modify(variety, order_id) {
		kc.modifyOrder(variety, order_id, {
			quantity: 2
		}).then(function(resp) {
			console.log(resp);
		}).catch(function(err) {
			console.log(err);
		});
	}

	kc.getLTP([instrument])
		.then(function(resp) {
			kc.placeOrder(variety, {
				"exchange": exchange,
				"tradingsymbol": tradingsymbol,
				"transaction_type": "BUY",
				"quantity": 1,
				"product": "MIS",
				"order_type": "LIMIT",
				"price": resp[instrument].last_price - 5
			}).then(function(resp) {
				modify(variety, resp.order_id);
			}).catch(function(err) {
				console.log("Order place error", err);
			});
		}).catch(function(err) {
			console.log(err);
		});
}


function getGTT(trigger_id) {
	if (trigger_id) {
		kc.getGTTs().then(function (resp) {
			console.log(resp)
		}).catch(function (error) {
			console.log(error)
		})
	} else {
		kc.getGTT(trigger_id).then(function (resp) {
			console.log(resp)
		}).catch(function (error) {
			console.log(error)
		})
	}
}



function modifyGTT(trigger_id) {
	kc.modifyGTT(trigger_id, {
		trigger_type: kc.GTT_TYPE_OCO,
		tradingsymbol: "SBIN",
		exchange: "NSE",
		trigger_values: [301, 401],
		last_price: 318,
		orders: [{
			transaction_type: kc.TRANSACTION_TYPE_SELL,
			quantity: 1,
			product: kc.PRODUCT_CNC,
			order_type: kc.ORDER_TYPE_LIMIT,
			price: 300
		}, {
			transaction_type: kc.TRANSACTION_TYPE_SELL,
			quantity: 1,
			product: kc.PRODUCT_CNC,
			order_type: kc.ORDER_TYPE_LIMIT,
			price: 400
		}]
	}).then(function (resp) {
		console.log(resp)
	}).catch(function (error) {
		console.log(error)
	})
}

function deleteGTT(trigger_id) {
	kc.deleteGTT(trigger_id).then(function (resp) {
		console.log(resp)
	}).catch(function (error) {
		console.log(error)
	})
}

function convertPosition() {
	kc.convertPosition({
        exchange:"MCX",
        tradingsymbol:"GOLDPETAL21JUNFUT",
        transaction_type:"BUY",
        position_type:"day",
        quantity:4,
        old_product:"MIS",
        new_product:"NRML"
    }).then(function (resp) {
		console.log(resp)
	}).catch(function (error) {
		console.log(error)
	})
}

/*function orderMargins() {
	kc.orderMargins([{
        "exchange": "NFO",
        "tradingsymbol": "NIFTY21JUN15400PE",
        "transaction_type": "BUY",
        "variety": "regular",
        "product": "MIS",
        "order_type": "MARKET",
        "quantity": 75
    },
	{
        "exchange": "NFO",
        "tradingsymbol": "NIFTY21JUN14450PE",
        "transaction_type": "SELL",
        "variety": "regular",
        "product": "MIS",
        "order_type": "MARKET",
        "quantity": 150
    }], "compact").then(function(resp) {
			console.log(resp);
		}).catch(function(err) {
            console.log(err); });
}*/

async function basketMargins(tradingsymbolSell, tradingsymbolBuy, qty) {
	exchange="NFO";
	if(tradingsymbolSell.startsWith("SENSEX") || tradingsymbolSell.startsWith("BANKEX")) exchange="BFO"
	return await kc.orderBasketMargins([{
		"exchange": exchange,
		"tradingsymbol": tradingsymbolBuy,
		"transaction_type": "BUY",
		"variety": "regular",
		"product": "NRML",
		"order_type": "MARKET",
		"quantity": qty
	},
	{
		"exchange": exchange,
		"tradingsymbol": tradingsymbolSell,
		"transaction_type": "SELL",
		"variety": "regular",
		"product": "NRML",
		"order_type": "MARKET",
		"quantity": qty
	}], true, "compact");
}



module.exports = {getContext}