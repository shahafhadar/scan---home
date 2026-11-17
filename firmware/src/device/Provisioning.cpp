#include "device/Provisioning.h"

#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

#include "device/DeviceIdentity.h"
#include "hmi/Feedback.h"
#include "platform/Log.h"
#include "platform/config.h"

namespace {

Preferences wifiPrefs;
DNSServer dns;
WebServer server(80);

bool running = false;
bool submitted = false;
uint32_t submittedAt = 0;
String pendingSsid;
String pendingPassword;
String claimTokenValue;

Provisioning::Progress progress = Provisioning::Progress::WaitingForInput;
String progressDetail;

String htmlEscape(const String &input) {
  String out;
  out.reserve(input.length());
  for (size_t i = 0; i < input.length(); i++) {
    const char c = input[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else if (c == '\'') out += "&#39;";
    else out += c;
  }
  return out;
}

const char *kStyle =
    "<style>"
    "*{box-sizing:border-box}"
    "body{font-family:-apple-system,system-ui,sans-serif;background:#0f1220;color:#f3f4f6;"
    "margin:0;padding:24px;direction:rtl;line-height:1.6}"
    "main{max-width:420px;margin:4vh auto}"
    "h1{font-size:23px;margin:0 0 6px}"
    ".sub{color:#9ca3af;font-size:14px;margin-bottom:22px}"
    "label{display:block;margin:16px 0 6px;font-size:14px;color:#9ca3af}"
    "select,input{width:100%;padding:13px;border-radius:10px;border:1px solid #2b3040;"
    "background:#171b2c;color:#f3f4f6;font-size:16px}"
    "button,.btn{display:block;width:100%;margin-top:20px;padding:15px;border:0;border-radius:10px;"
    "background:#2f4bd6;color:#fff;font-size:16px;font-weight:600;text-align:center;"
    "text-decoration:none;cursor:pointer}"
    ".hint{color:#9ca3af;font-size:13px;margin-top:14px}"
    ".code{font-size:38px;letter-spacing:8px;text-align:center;background:#171b2c;"
    "border:2px solid #2f4bd6;border-radius:14px;padding:20px 10px;margin:16px 0;"
    "font-family:ui-monospace,Menlo,monospace;font-weight:700}"
    "ol.steps{list-style:none;padding:0;margin:22px 0}"
    "ol.steps li{display:flex;gap:12px;align-items:center;padding:11px 0;"
    "border-bottom:1px solid #1e2233;color:#6b7280;font-size:15px}"
    "ol.steps li .dot{width:22px;height:22px;border-radius:50%;border:2px solid #2b3040;"
    "flex:0 0 auto;display:grid;place-items:center;font-size:12px}"
    "ol.steps li.done{color:#f3f4f6}"
    "ol.steps li.done .dot{background:#16a34a;border-color:#16a34a}"
    "ol.steps li.active{color:#f3f4f6}"
    "ol.steps li.active .dot{border-color:#2f4bd6;border-top-color:transparent;"
    "animation:spin 0.9s linear infinite}"
    "ol.steps li.failed{color:#fca5a5}"
    "ol.steps li.failed .dot{background:#dc2626;border-color:#dc2626}"
    "@keyframes spin{to{transform:rotate(360deg)}}"
    ".err{background:#3b1220;border:1px solid #7f1d1d;border-radius:10px;padding:13px;"
    "color:#fca5a5;font-size:14px;margin-top:16px}"
    ".ok{background:#0f2a18;border:1px solid #166534;border-radius:10px;padding:13px;"
    "color:#86efac;font-size:14px;margin-top:16px}"
    ".warn{background:#2b2410;border:1px solid #854d0e;border-radius:10px;padding:13px;"
    "color:#fde68a;font-size:14px;margin:16px 0}"
    ".btn.copy{background:#16a34a}"
    ".btn.locked{background:#20263b;color:#6b7280;pointer-events:none}"
    ".code.pick{user-select:all;-webkit-user-select:all}"
    "</style>";

String pageHead(const char *title) {
  String page = "<!doctype html><html lang='he' dir='rtl'><head><meta charset='utf-8'>";
  page += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>";
  page += title;
  page += "</title>";
  page += kStyle;
  page += "</head><body><main>";
  return page;
}

String networkOptions() {
  const int found = WiFi.scanNetworks();
  if (found <= 0) return "<option value=''>לא נמצאו רשתות — רענן את העמוד</option>";

  String options;
  for (int i = 0; i < found; i++) {
    // The radio is 2.4GHz only. Offering a 5GHz network we cannot join just
    // produces a failure the user has no way to understand.
    if (WiFi.channel(i) > 14) continue;
    const String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;
    options += "<option value='" + htmlEscape(ssid) + "'>" + htmlEscape(ssid) + "</option>";
  }
  if (options.length() == 0) {
    options = "<option value=''>נמצאו רק רשתות 5GHz — המכשיר תומך ב-2.4GHz</option>";
  }
  return options;
}

void handleRoot() {
  // Anyone landing here after setup has already started should see progress,
  // not the form again.
  if (submitted) {
    server.sendHeader("Location", "/progress");
    server.send(302, "text/plain", "");
    return;
  }

  String page = pageHead("הגדרת ScanCart");
  page += "<h1>מחברים את הסורק</h1>";
  page += "<div class='sub'>שלב אחד, ואז הכל אוטומטי.</div>";
  page += "<form method='POST' action='/save'>";
  page += "<label>קוד מהאפליקציה</label>";
  page += "<input name='claim' type='text' inputmode='latin' autocapitalize='characters' "
          "autocomplete='off' placeholder='ABC123' maxlength='8' "
          "style='text-align:center;letter-spacing:5px;font-size:22px'>";
  page += "<p class='hint'>פתח את האפליקציה ← מכשירים ← <b>הוסף מכשיר</b>, והקלד כאן את הקוד "
          "שמופיע שם. כך הסורק משתייך לחשבון שלך מיד, בלי שלבים נוספים.</p>";
  page += "<label>רשת ה-WiFi הביתית</label>";
  page += "<select name='ssid'>" + networkOptions() + "</select>";
  page += "<label>סיסמת הרשת</label>";
  page += "<input name='password' type='password' autocomplete='off'>";
  page += "<button type='submit'>התחבר</button></form>";
  page += "<p class='hint'>המכשיר תומך ברשתות 2.4GHz בלבד. אם הרשת שלך לא ברשימה, "
          "היא כנראה משדרת ב-5GHz בלבד.</p>";
  // Shown before submitting, not only after. The phone leaves this network the
  // moment the device joins the home one, and some phones close the setup
  // window by themselves -- so the code has to have been on screen already.
  page += "<p class='hint' style='margin-top:22px'>קוד החיבור שלך, תצטרך אותו בעוד רגע:</p>";
  page += "<div class='code' style='font-size:26px;letter-spacing:6px;padding:14px'>";
  page += htmlEscape(DeviceIdentity::pairingCode()) + "</div>";
  page += "<p class='hint'>מספר סידורי: " + htmlEscape(DeviceIdentity::serial()) + "</p>";
  page += "</main></body></html>";
  server.send(200, "text/html; charset=utf-8", page);
}

void handleProgress();

void handleSave() {
  const String ssid = server.arg("ssid");
  if (ssid.length() == 0) {
    server.sendHeader("Location", "/");
    server.send(302, "text/plain", "");
    return;
  }

  pendingSsid = ssid;
  pendingPassword = server.arg("password");

  claimTokenValue = server.arg("claim");
  claimTokenValue.trim();
  claimTokenValue.toUpperCase();
  submittedAt = millis();
  submitted = true;
  progress = Provisioning::Progress::Connecting;
  progressDetail = "";

  // Render the result of the POST directly rather than redirecting to it. A
  // redirect needs the network to survive one more request, and this network
  // is about to move channels underneath the phone.
  handleProgress();
}

/**
 * The hand-off page.
 *
 * This is where setup stops on purpose. The phone is about to leave this
 * network -- joining the home network moves the access point to another
 * channel, and phones drop a network with no internet on their own -- so the
 * six characters have to make it off this screen before that happens.
 *
 * Which means the page cannot just display them. It has to get them copied,
 * and it has to refuse to move on until they are. The link to the app stays
 * locked until the code is on the clipboard; a user who taps straight through
 * arrives at the app with nothing to type.
 *
 * navigator.clipboard does not exist here -- this is plain http, so the page
 * is not a secure context. The old execCommand path is the only one available.
 */
void handleProgress() {
  const String code = DeviceIdentity::pairingCode();
  const bool selfClaiming = claimTokenValue.length() > 0;

  String page = pageHead("כמעט סיימנו");
  page += "<h1 id='head'>הפרטים נשמרו</h1>";
  page += "<div class='sub' id='sub'>המכשיר מתחבר עכשיו לרשת הביתית.</div>";

  if (selfClaiming) {
    // Nothing to carry back. The code already travelled the other way, so this
    // page can be closed at any moment without costing the user anything.
    page += "<div class='ok'>הקוד מהאפליקציה התקבל. הסורק ישתייך לחשבון שלך "
            "אוטומטית ברגע שיתחבר — אפשר לסגור את החלון הזה בכל שלב.</div>";
  } else {
    page += "<div class='warn'>לא הזנת קוד מהאפליקציה, אז השיוך יצטרך את הקוד הזה. "
            "העתק אותו עכשיו — העמוד ייסגר מעצמו כשהטלפון יחזור לרשת הביתית.</div>";
    page += "<div class='code pick' id='code'>" + htmlEscape(code) + "</div>";
    page += "<button class='btn copy' id='copy' type='button'>העתק את הקוד</button>";
    page += "<div id='copied'></div>";
    page += "<a class='btn locked' id='app' href='" + String(SCANCART_HOST) + "/?code=" +
            htmlEscape(code) + "'>העתק קודם את הקוד</a>";
  }

  page += "<ol class='steps'>";
  page += "<li id='s1'><span class='dot'></span><span>מתחבר לרשת הביתית</span></li>";
  page += "<li id='s2'><span class='dot'></span><span>מסנכרן שעון</span></li>";
  page += "<li id='s3'><span class='dot'></span><span>מתחבר לשרת</span></li>";
  page += "<li id='s4'><span class='dot'></span><span>משייך לחשבון שלך</span></li>";
  page += "</ol>";
  page += "<div id='panel'></div>";

  page += "</main><script>";
  page += R"JS(
var ORDER = {WaitingForInput:0, Connecting:1, WifiFailed:1, SyncingTime:2,
             Registering:3, ServerFailed:3, WaitingToPair:4, Paired:5};
var lost = 0, copied = false;

function unlock(){
  copied = true;
  if (!document.getElementById('app')) return;
  document.getElementById('copied').innerHTML =
    "<div class='ok'>הקוד הועתק. עכשיו חזור לרשת ה-WiFi הביתית שלך, ואז לחץ למטה.</div>";
  var app = document.getElementById('app');
  app.className = 'btn';
  app.textContent = 'המשך לאפליקציה';
}

var copyButton = document.getElementById('copy');
if (copyButton) copyButton.addEventListener('click', function(){
  var text = document.getElementById('code').textContent.trim();
  var el = document.createElement('input');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  var ok = false;
  try {
    el.select();
    el.setSelectionRange(0, 99999);   // iOS ignores select() on its own
    ok = document.execCommand('copy');
  } catch (e) { ok = false; }
  document.body.removeChild(el);

  if (ok) {
    unlock();
  } else {
    // Copying can be refused outright. Never trap the user behind it -- show
    // the code for manual selection and open the gate anyway.
    document.getElementById('copied').innerHTML =
      "<div class='warn'>הדפדפן לא איפשר העתקה אוטומטית. סמן את הקוד למעלה והעתק ידנית, " +
      "או פשוט רשום אותו.</div>";
    unlock();
  }
});

function paint(s){
  lost = 0;
  var at = ORDER[s.progress] || 0;
  var bad = (s.progress === 'WifiFailed') ? 1 : (s.progress === 'ServerFailed' ? 3 : 0);
  for (var i = 1; i <= 4; i++) {
    var li = document.getElementById('s' + i);
    li.className = bad === i ? 'failed' : (at > i ? 'done' : (at === i ? 'active' : ''));
    if (li.className === 'done') li.querySelector('.dot').textContent = '✓';
  }
  // The server may have issued a different code, if another device had this
  // one. Only relevant on the fallback page, which is the only one showing it.
  var codeEl = document.getElementById('code');
  if (codeEl && s.code && s.code !== codeEl.textContent.trim()) {
    codeEl.textContent = s.code;
    var app = document.getElementById('app');
    if (app) app.href = app.href.replace(/code=[^&]*/, 'code=' + s.code);
  }
  var panel = document.getElementById('panel');
  if (s.progress === 'WifiFailed') {
    panel.innerHTML = "<div class='err'>לא הצלחתי להתחבר לרשת. כנראה הסיסמה שגויה." +
      (s.detail ? ' (' + s.detail + ')' : '') + "</div><a class='btn' href='/retry'>נסה שוב</a>";
  } else if (s.progress === 'ServerFailed') {
    panel.innerHTML = "<div class='err'>מחובר ל-WiFi אבל לא מצליח להגיע לשרת." +
      (s.detail ? ' (' + s.detail + ')' : '') + "</div>";
  } else if (s.progress === 'WaitingToPair') {
    document.getElementById('head').textContent = 'ההתחברות הושלמה';
    document.getElementById('sub').textContent = 'נשאר רק לשייך את המכשיר לחשבון.';
    panel.innerHTML = '';
  } else if (s.progress === 'Paired') {
    document.getElementById('head').textContent = 'המכשיר מוכן';
    document.getElementById('sub').textContent = '';
    panel.innerHTML = "<div class='ok'>הסורק משויך לחשבון שלך. אפשר לסגור את החלון.</div>";
  } else {
    panel.innerHTML = '';
  }
}

function poll(){
  fetch('/status').then(function(r){ return r.json(); }).then(paint).catch(function(){
    if (++lost === 3) {
      document.getElementById('panel').innerHTML =
        "<p class='hint'>המכשיר עבר לרשת הביתית והקשר לעמוד הזה נותק — זה תקין ומצופה. " +
        (document.getElementById('code') === null
           ? "השיוך נעשה אוטומטית — אין מה לעשות."
           : (copied ? "הקוד כבר אצלך." : "העתק את הקוד למעלה לפני שאתה סוגר.")) + "</p>";
    }
  });
}
poll(); setInterval(poll, 1500);
)JS";
  page += "</script></body></html>";
  server.send(200, "text/html; charset=utf-8", page);
}

const char *progressName(Provisioning::Progress p) {
  switch (p) {
    case Provisioning::Progress::WaitingForInput: return "WaitingForInput";
    case Provisioning::Progress::Connecting:      return "Connecting";
    case Provisioning::Progress::WifiFailed:      return "WifiFailed";
    case Provisioning::Progress::SyncingTime:     return "SyncingTime";
    case Provisioning::Progress::Registering:     return "Registering";
    case Provisioning::Progress::ServerFailed:    return "ServerFailed";
    case Provisioning::Progress::WaitingToPair:   return "WaitingToPair";
    case Provisioning::Progress::Paired:          return "Paired";
  }
  return "Unknown";
}

void handleStatus() {
  String json = "{\"progress\":\"";
  json += progressName(progress);
  json += "\",\"detail\":\"" + htmlEscape(progressDetail) + "\"";
  json += ",\"code\":\"" + DeviceIdentity::pairingCode() + "\"";
  json += ",\"serial\":\"" + DeviceIdentity::serial() + "\"}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", json);
}

void handleRetry() {
  submitted = false;
  progress = Provisioning::Progress::WaitingForInput;
  progressDetail = "";
  server.sendHeader("Location", "/");
  server.send(302, "text/plain", "");
}

}  // namespace

namespace Provisioning {

bool hasCredentials() {
  // Read-write, so the namespace exists on a factory-fresh chip. Opening it
  // read-only on a blank NVS logs an error that looks like a fault.
  wifiPrefs.begin("wifi", false);
  const bool has = wifiPrefs.getString("ssid", "").length() > 0;
  wifiPrefs.end();
  return has;
}

void loadCredentials(String &ssid, String &password) {
  wifiPrefs.begin("wifi", false);
  ssid = wifiPrefs.getString("ssid", "");
  password = wifiPrefs.getString("password", "");
  wifiPrefs.end();
}

void saveCredentials(const String &ssid, const String &password) {
  wifiPrefs.begin("wifi", false);
  wifiPrefs.putString("ssid", ssid);
  wifiPrefs.putString("password", password);
  wifiPrefs.end();
}

void clearCredentials() {
  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();
  wifiPrefs.end();
}

void startPortal() {
  if (running) return;

  Feedback::setState(Feedback::State::Provisioning);

  // Last four of the serial, so a household setting up two devices can tell
  // which one it is looking at.
  const String serial = DeviceIdentity::serial();
  const String apName = "ScanCart-" + serial.substring(serial.length() - 4);

  // AP_STA, not AP: the device joins the home network while still hosting this
  // page, which is what lets the phone watch the connection succeed.
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apName.c_str());
  const IPAddress ip = WiFi.softAPIP();
  LOG_I("portal", "%s at %s", apName.c_str(), ip.toString().c_str());

  // Answering every DNS query with our own address is what makes the phone
  // open the setup page by itself instead of the user hunting for an IP.
  dns.start(53, "*", ip);

  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/progress", handleProgress);
  server.on("/status", handleStatus);
  server.on("/retry", handleRetry);
  // The URLs each platform probes to decide whether a network has internet.
  server.on("/generate_204", handleRoot);
  server.on("/gen_204", handleRoot);
  server.on("/hotspot-detect.html", handleRoot);
  server.on("/connecttest.txt", handleRoot);
  server.on("/ncsi.txt", handleRoot);
  server.onNotFound(handleRoot);
  server.begin();

  running = true;
  submitted = false;
  progress = Progress::WaitingForInput;
}

void stopPortal() {
  if (!running) return;
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  running = false;
  LOG_I("portal", "closed");
}

bool portalRunning() { return running; }

void tick() {
  if (!running) return;
  dns.processNextRequest();
  server.handleClient();
}

bool consumeSubmission(String &ssid, String &password) {
  if (!submitted || pendingSsid.length() == 0) return false;
  // Joining the home network moves the access point to its channel and drops
  // the phone. Hold off long enough for the page we just wrote to arrive.
  if (millis() - submittedAt < 1500) return false;
  ssid = pendingSsid;
  password = pendingPassword;
  pendingSsid = "";
  pendingPassword = "";
  return true;
}

const String &claimToken() { return claimTokenValue; }

void setProgress(Progress next, const String &detail) {
  progress = next;
  progressDetail = detail;
}

}  // namespace Provisioning
