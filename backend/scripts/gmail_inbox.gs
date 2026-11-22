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
 *
 * POST <url> with JSON {"token", "to": [...], "cc": [...], "subject", "body",
 * "reply_to"} sends the mail from this Gmail account (used where SMTP is
 * blocked, MAIL_TRANSPORT=gmail_script) and returns {"message_id": "..."}.
 * After pasting a new version: Deploy -> Manage deployments -> edit -> New version,
 * and allow the extra "send email" permission when asked.
 */
function doGet(e) {
  var token = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!token || !e || e.parameter.token !== token) {
    return json_({ error: "forbidden" });
  }
  var days = Math.min(Number(e.parameter.days || 14), 60);
  // The account the script runs as ("Execute as: Me"). getActiveUser() would be the
  // caller, which is empty for the anonymous backend, and indexOf("") matches every
  // sender, so it hid all mail.
  var me = (Session.getEffectiveUser().getEmail() || "").toLowerCase();
  var messages = [];
  GmailApp.search("in:inbox newer_than:" + days + "d", 0, 100).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      if (me && m.getFrom().toLowerCase().indexOf(me) >= 0) return; // our own mail
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

function doPost(e) {
  var data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  var token = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!token || data.token !== token) return json_({ error: "forbidden" });
  if (!data.to || !data.to.length || !data.subject) return json_({ error: "to and subject are required" });
  var options = {};
  if (data.cc && data.cc.length) options.cc = data.cc.join(",");
  if (data.reply_to) options.replyTo = data.reply_to;
  // A draft's send() returns the sent message, so the backend gets its Message-ID
  var sent = GmailApp.createDraft(data.to.join(","), data.subject, data.body || "", options).send();
  return json_({ message_id: sent.getHeader("Message-ID") || sent.getId() });
}

function split_(list) {
  return (list || "").split(",").map(function (s) { return s.trim(); }).filter(String);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON
  );
}
