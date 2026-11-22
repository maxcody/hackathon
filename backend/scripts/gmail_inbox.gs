/**
 * Google Apps Script web app that lets the Linewatch backend read the team
 * Gmail inbox over HTTPS (no IMAP, no Google Cloud project needed).
 *
 * Setup (once, signed in as the sender Gmail account, any device works):
 *   1. https://script.google.com -> New project, paste this file.
 *   2. Project Settings -> Script properties -> add TOKEN = a long random secret.
 *   3. Deploy -> New deployment -> Web app; Execute as: Me; Who has access: Anyone.
 *      Authorize Gmail access when asked.
 *   4. Put the web app URL and the token in backend/.env:
 *      GMAIL_SCRIPT_URL=https://script.google.com/macros/s/.../exec
 *      GMAIL_SCRIPT_TOKEN=<the same secret>
 *
 * GET <url>?token=<secret>&days=14 returns {"messages": [...]}: received mail
 * from the last `days` days, newest first, without mail sent from this account.
 */
function doGet(e) {
  var token = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!token || !e || e.parameter.token !== token) {
    return json_({ error: "forbidden" });
  }
  var days = Math.min(Number(e.parameter.days || 14), 60);
  var me = Session.getActiveUser().getEmail().toLowerCase();
  var messages = [];
  GmailApp.search("in:inbox newer_than:" + days + "d", 0, 100).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      if (m.getFrom().toLowerCase().indexOf(me) >= 0) return; // our own mail
      messages.push({
        message_id: m.getHeader("Message-ID") || m.getId(),
        in_reply_to: m.getHeader("In-Reply-To") || "",
        at: m.getDate().toISOString(),
        sender: m.getFrom(),
        to: split_(m.getTo()),
        cc: split_(m.getCc()),
        subject: m.getSubject(),
        body: m.getPlainBody().slice(0, 20000),
      });
    });
  });
  messages.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return json_({ messages: messages });
}

function split_(list) {
  return (list || "").split(",").map(function (s) { return s.trim(); }).filter(String);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON
  );
}
