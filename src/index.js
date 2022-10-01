const puppeteer = require("puppeteer-core");
const _cliProgress = require("cli-progress");
const spintax = require("mel-spintax");
const { Client, LocalAuth, MessageMedia, WAState, Buttons, List} = require("whatsapp-web.js");
require("./welcome");
var spinner = require("./step");
var utils = require("./utils");
var qrcode = require("qrcode-terminal");
var path = require("path");
var argv = require("yargs").argv;
var rev = require("./detectRev");
var constants = require("./constants");
var configs = require("../bot");
var fs = require("fs");
const fetch = require("node-fetch");
const { lt } = require("semver");
const mime = require("mime");
//const { WASI } = require("wasi");

//TODO: remove this
// const {write,read}=require('../media/tem')

//console.log(ps);

let appconfig = null;
let startCorn = true;
let processCounter = 0;

//console.log(process.cwd());

async function Main() {
  debugger;
  try {
    var page;
    await downloadAndStartThings();
    console.log("WBOT is ready !! Let those message come.");
  } catch (e) {
    console.error("\nLooks like you got an error. " + e);
    try {
      page.screenshot({ path: path.join(process.cwd(), "error.png") });
    } catch (s) {
      console.error("Can't create shreenshot, X11 not running?. " + s);
    }
    console.warn(e);
    console.error(
      "Don't worry errors are good. They help us improve. A screenshot has already been saved as error.png in current directory. Please mail it on vasani.arpit@gmail.com along with the steps to reproduce it.\n"
    );
    throw e;
  }

  /**
   * If local chrome is not there then this function will download it first. then use it for automation.
   */
  async function downloadAndStartThings() {
    let botjson = utils.externalInjection("bot.json");

    appconfig = await utils.externalInjection("bot.json");

    appconfig = JSON.parse(appconfig);

    spinner.start("Downloading chromium\n");

    const browserFetcher = puppeteer.createBrowserFetcher({
      platform: process.platform,
      path: process.cwd(),
    });

    const progressBar = new _cliProgress.Bar(
      {},
      _cliProgress.Presets.shades_grey
    );

    progressBar.start(100, 0);
    //var revNumber = await rev.getRevNumber();
    const revisionInfo = await browserFetcher.download(
      "982053",
      (download, total) => {
        //console.log(download);
        var percentage = (download * 100) / total;
        progressBar.update(percentage);
      }
    );

    progressBar.update(100);

    spinner.stop("Downloading chromium ... done!");

    //console.log(revisionInfo.executablePath);

    spinner.start("Launching browser\n");

    var pptrArgv = [];

    if (argv.proxyURI) {
      pptrArgv.push("--proxy-server=" + argv.proxyURI);
    }

    const extraArguments = Object.assign({});

    extraArguments.userDataDir = constants.DEFAULT_DATA_DIR;

    const client = new Client({
      puppeteer: {
        executablePath: revisionInfo.executablePath,
        defaultViewport: null,
        headless: appconfig.appconfig.headless,
        devtools: false,
        slowMo: 500,
        args: [...constants.DEFAULT_CHROMIUM_ARGS, ...pptrArgv],
        ...extraArguments,
      },
    });

    if (argv.proxyURI) {
      spinner.info("Using a Proxy Server");
    }

    client.on("qr", async (qr) => {
      //console.log('QR RECEIVED', qr);
      if(processCounter > 3){
        console.log('Multiple time called without response.');
        process.exit(1);
      }
      let body = JSON.stringify({ qr: qr, status: 0 });
      qrcode.generate(qr, { small: true });

      const webhook_qr = appconfig.appconfig.webhook_qr;
      if (!webhook_qr) return;
      await UpdateStatus(webhook_qr, body,"POST");
      processCounter++;
    });

    client.on("ready", async () => {
      spinner.info("WBOT is spinning up!");

      await utils.delay(5000);

      /* Unread Chats */
      let UnreadChats = await getUnreadChat(client);
      if (UnreadChats !== null && UnreadChats.length > 0) {
        for (let msg of UnreadChats) {
          await processWebhook({ msg, client });
        }
      }
      /* Configartion cron */
        await timeout_Cron(client);
    }); // client.on('ready', async () =>

    client.on("authenticated", async () => {
      processCounter = 0;
      // spinner.info('AUTHENTICATED');
      console.log("start update status login whatsapp");
      const webhook_Status_loginBot = appconfig.appconfig.webhook_Status_loginBot;
      if (!webhook_Status_loginBot) return;
      let body = JSON.stringify({ Status: 1 });
      await UpdateStatus(webhook_Status_loginBot, body, "POST");
      startCorn = true;
    });
  
    /* auth failure */
    client.on("auth_failure", async (msg) => {
      console.error("AUTHENTICATION FAILURE", msg);
      const webhook_Status_logoutBot = appconfig.appconfig.webhook_Status_logoutBot;
      if (!webhook_Status_logoutBot) return;
      let body = JSON.stringify({ status: 0 });
      await UpdateStatus(webhook_Status_logoutBot, body, "POST");
      await client.initialize();
    });
    /* auth failure */

    client.on('disconnected', async (reason) => {
      console.log('Client start logged out', reason);
      const webhook_Status_logoutBot = appconfig.appconfig.webhook_Status_logoutBot;
      if (!webhook_Status_logoutBot) return;
      let body = JSON.stringify({ status: 0 });
      await UpdateStatus(webhook_Status_logoutBot, body, "POST");
      startCorn = false;
      await client.initialize();
    });

    client.on('change_state', async state => {
        console.log('CHANGE STATE = ', state );
        // if(state === WAState.CONNECTED){
        //   const webhook_Status_logoutBot = appconfig.appconfig.webhook_Status_logoutBot;
        //   if (!webhook_Status_logoutBot) return;
        //   let body = JSON.stringify({ status: 0 });
        //   await UpdateStatus(webhook_Status_logoutBot, body, "POST");
        //   startCorn = false;
        // }
    });

    client.on("message", async (msg) => {
        let chat = await client.getChatById(msg.from);
        console.log(`Message ${msg.body} received in ${chat.name} chat`);
        //console.log()
        await processWebhook({ msg, client });      
    });

    await client.initialize();

    spinner.stop("Launching browser ... done!");

    // When the settings file is edited multiple calls are sent to function. This will help
    // to prevent from getting corrupted settings data
    let timeout = 5000;

    // Register a filesystem watcher
    fs.watch(constants.BOT_SETTINGS_FILE, (event, filename) => {
      setTimeout(async () => {
        console.log("Settings file has been updated. Reloading the settings");
        configs = JSON.parse(
          fs.readFileSync(path.join(process.cwd(), "bot.json"))
        );
        appconfig = await utils.externalInjection("bot.json");
        appconfig = JSON.parse(appconfig);
      }, timeout);
    });


  }
}

/****
 *
 *Get All Unread Chat
 *
 ***/

async function UpdateStatus(url , body, method = "POST")
{
    // await console.log(url);
    // await console.log(body);
    await fetch(url, {
        method: method,
        body: body,
        headers: {
          "Content-Type": "application/json",
        },
    })
    .then((respo) => {
        //console.log(respo);
        //console.log('post request is success');
        return respo;
    })
    .catch((err) => {
        console.log(err);
        return false;
    });
}
/****
 *
 *Get All Unread Chat
 *
 ***/

async function getUnreadChat(client) {
  let chats = await client.getChats();
  let unreadMessages = [];

  chats = chats.filter((m) => !m.archive)

  for (let chat of chats) {
    if (chat.unreadCount > 0) {
      unreadMessages = await chat.fetchMessages({ limit: chat.unreadCount });
    }
  }

  return unreadMessages;
}

/****
 *
 *process Webhook
 *
 ***/

async function processWebhook({ msg, client }) {
  const webhook = appconfig.appconfig.webhook;

  if (!webhook) return;


  body = {};
  body.user = msg.from;

  //console.log(msg.from);
  /*******************
   * @ hamed alfahad 30-10-2021
   * Update body data array
   * ************************/
  if (
    msg.type === "document" ||
    msg.type === "image" ||
    msg.type === "video" ||
    msg.type === "ptt" ||
    msg.type === "pttx" ||
    msg.type === "audio"
  ) {
    //console.log(msg.type);

    var data_file = {};

    body.type = msg.type;
    data_file = await msg.downloadMedia();

    body.media = data_file.data;
    body.mediatype = msg.type;
    body.mimetype = msg._data.mimetype;
  }
  else if(msg.selectedButtonId !== null && msg.selectedButtonId !== undefined && msg.selectedButtonId !== ''){
    body.type = "button";
    body.text = msg.selectedButtonId ;
    body.ButtonTargetType = msg.selectedButtonId.split('_')[0];
    body.ButtonTargetId = msg.selectedButtonId.split('_')[1];
  }
  else {
    body.type = "message";
    body.text =  msg.body ;
  }

  body.pushname = "";
  body.server = "@c.us";
  /*******************
   * @ hamed alfahad 30-10-2021
   * Update body data array
   * ************************/

  var data_json = JSON.stringify(body);
	console.log(data_json);
  await fetch(webhook, {
    method: "POST",
    body: data_json,
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((resp) => (resp !== null && resp !== undefined && resp !== '')? resp.json() : null)
    .then(function (response) {
      //replying to the user based on response


      if (response !== null && response !== undefined && response !== '' && response.length > 0) {
        response.forEach(async (itemResponse) => {

          var response_type = itemResponse.type;
          
          if(response_type === 'message'){

            await client.sendMessage(msg.from, itemResponse.text); // send message

            if (itemResponse.files && itemResponse.files.length > 0) {

              for (const itemFile of itemResponse.files) {
                var mediaImage = await MessageMedia.fromUrl(itemFile);
                await client.sendMessage(msg.from, mediaImage, { caption: "" });
              }
            }
          }else if(response_type === 'menu'){

            const buttons_reply_url = await new Buttons((itemResponse.content.body !== null && itemResponse.content.body !== undefined && itemResponse.content.body !== '')? itemResponse.content.body : itemResponse.content.title, itemResponse.content.button , itemResponse.content.title, itemResponse.content.footer);
            await client.sendMessage(msg.from, buttons_reply_url);
			console.log(buttons_reply_url);

            //await client.sendMessage(msg.from, itemResponse.content); // send message

          }
          
          // ارشفة المحادثة بعد الرد
          const chat = await msg.getChat();
          await chat.archive();

        });

      } // if (response && response.length > 0)



    })
    .catch(function (error) {
      console.log(error);
    });

  console.log("----------------------------------------");
  //console.log(response);
}

/**************************
 *
 *
 * Cron Send Message API
 *
 * ****************************/
async function send_cron(client) {
  //console.log("fetch");

  const webhook_send_cron = appconfig.appconfig.webhook_cron;
  const webhook_cron_update = appconfig.appconfig.webhook_cron_update;

  fetch(webhook_send_cron, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((resp_api) => (resp_api !== null && resp_api !== undefined && resp_api !== '')? resp_api.json() : null)
    .then(function (response_api) {
 
      if (response_api !== null && response_api !== undefined && response_api !== '' && response_api.length > 0) {
        response_api.forEach(async (itemResponse_api) => {
          // await client.sendSeen(itemResponse_api.send_to_user);
          await client.sendMessage(
            itemResponse_api.send_to_user,
            itemResponse_api.content_message
          );

          if (itemResponse_api.files && itemResponse_api.files.length > 0) {
            itemResponse_api.files.forEach(async (itemFile) => {
              var mediaImage = await MessageMedia.fromUrl(itemFile);
              await client.sendMessage(itemResponse_api.send_to_user, mediaImage, { caption: "" });
            });
          }

          // Update Status Cron
          //console.log(`start update`);

          fetch(webhook_cron_update + itemResponse_api.cron_id, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          })
            .then((resp_api_send) => resp_api_send.json())
            .then(function (response_api_send) {
              console.log(response_api_send);
              console.log("Update Send Cron");
            });
        });
      } // (response_api && response_api.length > 0)
    })
    .catch(function (error) {
      console.log(error);
    });
}

async function timeout_Cron(client) {
  if(startCorn) 
  {
    setTimeout(function () {
      send_cron(client);
      timeout_Cron(client);
    }, 10000);
  }
}


Main();


//
// const buttons_reply_url = await new Buttons('مرحبا بك بعمادة التعليم عن بعد والتعليم الالكتروني'
//     , [
//       {body: 'الاستعلام عن الحجز ', id: 'M3'},
//       {body: "موقع الصالون", id: 'M2'},
//       {body: "الدعم الفني المباشر", id: 'M1'}
//     ],
//     'مرحبا بك ', 'فضلا اختر الخيار المناسب لك');
//
// await client.sendMessage('966556505152@c.us','كود تفعيل الحساب 123');
// console.log(buttons_reply_url);
// client.sendMessage('966556505152@c.us', buttons_reply_url);
