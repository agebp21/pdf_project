// Google Drive picker folders: selectable (the Picker greys out folders that
// can't be selected, which looked disabled); picking a folder opens the picker
// inside it, and the file picked there is the one downloaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const builders = [], requests = [];
const replies = [];
global.document = {documentElement: {lang: 'id'}, createElement: () => ({}), head: {appendChild(s) { setTimeout(() => s.onload(), 0); }}};
global.window = global;
global.File = class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } };
global.gapi = {load(name, opts) { setTimeout(opts.callback, 0); }};
const picker = {
  ViewId: {DOCS: 'docs'}, Action: {PICKED: 'picked', CANCEL: 'cancel'},
  Response: {ACTION: 'action', DOCUMENTS: 'docs'}, Document: {ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType'},
  DocsView: class { setIncludeFolders() { return this; } setSelectFolderEnabled(on) { this.selectFolders = on; return this; } setMimeTypes() { return this; }
    setLabel(l) { this.label = l; return this; } setParent(p) { this.parent = p; return this; } setOwnedByMe() { return this; }
    setEnableDrives() { return this; } setStarred() { return this; } },
  DocsUploadView: class {},
  PickerBuilder: class {
    constructor() { builders.push(this); this.views = []; }
    addView(v) { this.views.push(v); return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; }
    setTitle() { return this; } setAppId() { return this; } setLocale() { return this; } setCallback(cb) { this.cb = cb; return this; }
    build() { const self = this; return {setVisible() { setTimeout(() => self.cb(replies.shift()), 0); }}; }
  },
};
global.google = {picker, accounts: {oauth2: {initTokenClient(opts) {
  const client = {requestAccessToken() { setTimeout(() => client.callback({access_token: 't', expires_in: 3600}), 0); }};
  return client;
}}}};
global.fetch = async url => { requests.push(url); return {ok: true, status: 200, blob: async () => ({type: 'application/pdf'})}; };
eval(fs.readFileSync(require('node:path').join(__dirname, '../assets/drive-picker.js'), 'utf8'));

(async () => {
  replies.push({action: 'picked', docs: [{id: 'fold-1', name: 'Kuliah', mimeType: 'application/vnd.google-apps.folder'}]},
               {action: 'picked', docs: [{id: 'pdf-9', name: 'modul.pdf', mimeType: 'application/pdf'}]});
  const file = await DrivePicker.pick({clientId: 'c', apiKey: 'k'});
  assert.ok(builders[0].views.slice(0, 4).every(v => v.selectFolders === true), 'folders look normal (selectable)');
  assert.equal(builders.length, 2, 'the picked folder opened in a second picker');
  assert.equal(builders[1].views[0].parent, 'fold-1'); assert.equal(builders[1].views[0].label, 'Kuliah');
  assert.equal(file.name, 'modul.pdf');
  assert.ok(requests.every(u => !u.includes('fold-1')), 'a folder is never downloaded');
  // Cancelling inside a folder: nothing picked.
  replies.push({action: 'picked', docs: [{id: 'fold-2', name: 'Arsip', mimeType: 'application/vnd.google-apps.folder'}]}, {action: 'cancel'});
  assert.equal(await DrivePicker.pick({clientId: 'c', apiKey: 'k'}), null);
  console.log('PASS drive folders: selectable (not greyed), a picked folder opens, its file downloads, cancel inside a folder');
})().catch(e => { console.error(e); process.exit(1); });
