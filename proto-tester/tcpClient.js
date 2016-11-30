var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('./util/utils');
var Composer = require('./composer');
var net = require('net');

var logger = console;

var DEFAULT_CALLBACK_TIMEOUT = 10 * 1000;
var DEFAULT_INTERVAL = 50;

var TcpClient = function(server, opts) {
  EventEmitter.call(this);
  this.opts = opts || {};
  this.host = server.host;
  this.port = server.port;
  this.socket = null;
  this.composer = new Composer({maxLength: opts.pkgSize});
  this.requests = {};
  this.timeout = {};
  this.curcmd = 0;
  this.queue = [];
  this.bufferPkg = opts.bufferPkg;
  this.interval = opts.interval || DEFAULT_INTERVAL;
  this.timeoutValue = opts.timeout || DEFAULT_CALLBACK_TIMEOUT;
  this.connected = false;
  this.closed = false;
};
util.inherits(TcpClient, EventEmitter);

var pro = TcpClient.prototype;

pro.connect = function(cb) {
  if (this.connected) {
    utils.invokeCallback(cb, new Error('tcpClient has already connected.'));
    return;
  }

  var self = this;

  this.socket = net.connect({port: this.port, host: this.host}, function() {
    logger.info('connect to ' + self.host + ':' + self.port + ' ok');
    // success to connect
    self.connected = true;
    if (self.bufferPkg) {
      // start flush interval
      self._interval = setInterval(function() {
        flush(self);
      }, self.interval);
    }
    utils.invokeCallback(cb);
  });

  this.composer.on('data', function(header, data) {
    processMsg(self, header, data);
  });

  this.socket.on('data', function(data) {
    self.composer.feed(data);
  });

  this.socket.on('error', function(err) {
    if (!self.connected) {
      utils.invokeCallback(cb, err);
      return;
    }
    self.emit('error', err, self);
  });

  this.socket.on('end', function() {
    self.emit('close', self.cmd);
  });

  // TODO: reconnect and heartbeat
};

/**
 * close tcpClient
 */
pro.close = function() {
  if (this.closed) {
    return;
  }
  this.closed = true;
  if (this._interval) {
    clearInterval(this._interval);
    this._interval = null;
  }
  if (this.socket) {
    this.socket.end();
    this.socket = null;
  }
};

/**
 * send data to server
 *
 * @param data {encoded protocol-buffers data}
 * @param cb declaration deccmded by remote interface
 */
pro.send = function(uid, cmd, data, cb) {
  if (!this.connected) {
    utils.invokeCallback(cb, new Error('not init.'));
    return;
  }

  if (this.closed) {
    utils.invokeCallback(cb, new Error('tcpClient alread closed.'));
    return;
  }

  this.requests[cmd] = cb;
  setCbTimeout(this, cmd, cb);

  var pkg = this.composer.compose(uid, cmd, data);
  if (this.bufferPkg) {
    enqueue(this, pkg);
  } else {
    this.socket.write(pkg);
  }
};

var enqueue = function(tcpClient, pkg) {
  tcpClient.queue.push(pkg);
};

var flush = function(tcpClient) {
  if (tcpClient.closed || !tcpClient.queue.length) {
    return;
  }
  tcpClient.queue.forEach(function(pkg) {
    tcpClient.socket.write(pkg);
  });
  tcpClient.queue = [];
};

var processMsg = function(tcpClient, header, data) {
  logger.info('recv msg from ' + tcpClient.host + ':' + tcpClient.port + ', header:' + JSON.stringify(header));

  clearCbTimeout(tcpClient, header.cmd);
  var cb = tcpClient.requests[header.cmd];
  if (!cb) {
    return;
  }  
  delete tcpClient.requests[header.cmd];

  var args = [null, header, data];
  cb.apply(null, args);
};

var setCbTimeout = function(tcpClient, cmd, cb) {
  var timer = setTimeout(function() {
    clearCbTimeout(tcpClient, cmd);
    if (!!tcpClient.requests[cmd]) {
      delete tcpClient.requests[cmd];
    }
    utils.invokeCallback(cb, new Error('pkg callback timeout'));
  }, tcpClient.timeoutValue);
  tcpClient.timeout[cmd] = timer;
};

var clearCbTimeout = function(tcpClient, cmd) {
  if (!tcpClient.timeout[cmd]) {
    console.warn('timer not exists, cmd: %s', cmd);
    return;
  }
  clearTimeout(tcpClient.timeout[cmd]);
  delete tcpClient.timeout[cmd];
};

/**
 * Factory method to create tcpClient
 *
 * @param {Object} server remote server info {host:"", port:""}
 * @param {Object} opts construct parameters
 *                      opts.bufferPkg {Boolean} pkg should be buffered or send immediately.
 *                      opts.interval {Boolean} pkg queue flush interval if bufferPkg is true. default is 50 ms
 */
module.exports.create = function(server, opts) {
  return new TcpClient(server, opts || {});
};
