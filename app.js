/**
 * Module dependencies.
 */

var express = require('express'),
         io = require("socket.io"),
        irc = require("irc"),
     stylus = require("stylus"),
        nib = require("nib"),
       gzip = require('connect-gzip'),
      debug = false,
        app = module.exports = express.createServer(),
CouchClient = require('couch-client'),
 connection = CouchClient("http://jsfoobot:foobotpass@netroy.iriscouch.com/irc_jsfoo"),
      docId = "backlog";

// Configuration
app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.enable('view cache');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(stylus.middleware({
    src: __dirname + '/src',
    dest: __dirname + '/static',
    compile: function (str, path, fn) {
      return stylus(str).set('filename', path).set('compress', true).use(nib());
    }
  }));
  app.use(app.router);
  app.use(express.static(__dirname + '/static'));
  app.use(gzip.staticGzip(__dirname + '/public', { maxAge: 86400*1000 }));
});
app.configure('development', function(){
  debug = true;
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});
app.configure('production', function(){
  app.use(express.errorHandler()); 
});

var server  = "irc.freenode.net",
   channel  = debug?"#jsfootest":"#hasgeek";

// Routes
app.get('/', function(req, resp){
  resp.render('index', {
    'title': 'jsFoo 2011'
  });
});
app.get('/irc', function(req, resp){
  resp.render('irc', {
    'title': 'jsFoo 2011',
    'channel': channel,
    'server': server
  });
});
app.get(/^\/(about\-(event|hasgeek)|proposals|venue|home|videos|sponsors|credits|register)\/?$/, function(req, resp){
  var path = req.url.substr(1).match(/[a-zA-Z\-]+/)[0];
  var opts = {
    title: 'jsFoo 2011 India'
  };
  resp.render('main', opts);
});

// Catch all route
app.use(function(eq, resp){
  resp.redirect("/");
});

// prevent server from starting as module - can be used with something like multinode
if (!module.parent) {
  app.listen(process.env['app_port'] || 11728);
  console.info("Started on port %d", app.address().port);
}

if(debug){
  return;
}

var nick  = debug?"blahblahblah":"jsFooBot",
   names  = {},
   topic  = "",
messages  = [],
 MAX_LOG  = 250;

// Bind Socket.IO server to the http server
var io = io.listen(app);
io.set('log level', debug?2:1);
io.sockets.on('connection', function(client){
  // Send the Back-log
  io.sockets.emit('names', names);
  io.sockets.emit('topic', topic);
  io.sockets.emit('message', messages);
});

// Before initializing IRC client, pull the json from couchDB
console.info("fetching back log");
connection.get(docId, function(err, doc){
  if(err){
    console.error(err);
    return;
  }else if(doc.messages && doc.messages.length){
    messages = doc.messages;
    console.log("Fetched the backlog. Message count : " + messages.length);
  }
});

// And set a timer to take backups every 60 seconds
var lastTimeStamp = 0, last;
setInterval(function(){
  if(messages.length === 0) return;
  last = messages[messages.length - 1];
  if(last.time <= lastTimeStamp) return;
  connection.save({
    "_id": docId,
    "messages": messages
  }, function(err, doc){
    if(err){
      console.error("Saving failed");
      console.error(err);
      return;
    }
    lastTimeStamp = last.time;
    console.info("Saved the backlog at " + new Date(lastTimeStamp));
  })
},60*1000);

// Init the IRC client & connect to #hasgeek
var ircClient = new irc.Client(server, nick, {
  'channels'  : [channel],
  'userName'  : "jsFooBot",
  'realName'  : "jsFooBot",
  'password'  : null,
  'autoRejoin': true,
  'debug'     : debug
});

console.info("Connecting to freenode");

// Add message handlers to the IRC client
ircClient.addListener('names', function(ch, nicks){
  if(ch.toLowerCase() !== channel) return;
  names = nicks;
  io.sockets.emit('names', nicks);
});
ircClient.addListener('topic', function(ch, tp){
  if(ch.toLowerCase() !== channel) return;
  topic = tp;
  io.sockets.emit('topic', topic);
});
ircClient.addListener('join', function(ch, nick){
  if(ch.toLowerCase() !== channel) return;
  names[nick] = '';
  io.sockets.emit('join', nick);
});
ircClient.addListener('part', function(ch, nick){
  if(ch.toLowerCase() !== channel) return;
  delete names[nick];
  io.sockets.emit('part', nick);
});
ircClient.addListener('nick', function(old, nick){
  delete names[old];  
  names[nick] = '';
  io.sockets.emit('nick', old, nick);
});
ircClient.addListener('message', function (from, ch, text) {
  if(ch.toLowerCase() !== channel) return;
  var packet = {from: from, text: text, time: (new Date()).getTime()};
  messages.push(packet);
  if(messages.length > MAX_LOG) messages.shift();
  io.sockets.emit('message', packet);
});
