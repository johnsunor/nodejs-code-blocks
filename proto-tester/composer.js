
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var DEFAULT_MAX_LENGTH = -1;  // default max package size: unlimited
var LEFT_SHIFT_BITS = 1 << 7;
var PROTO_HEADER_LENGTH = 18;

var ST_HEADER = 1;  // state that we should read length
var ST_DATA = 2;  // state that we should read data
var ST_ERROR = 3;  // state that something wrong has happened

var Composer = function(opts) {
  EventEmitter.call(this);

  opts = opts || {};
  this._maxLength = opts.maxLength || DEFAULT_MAX_LENGTH;

  this.reset();
};

module.exports = Composer;

util.inherits(Composer, EventEmitter);

var pro = Composer.prototype;

/**
 * Compose data into package.
 *
 * @param  {String|Buffer}  data data that would be composed.
 * @return {Buffer}        compose result in Buffer.
 */
pro.compose = function(uid, cmd, data) {
  if (typeof uid !== 'number' || typeof cmd !== 'number') {
    throw new Error('both typeof uid and typeof cmd should be number');
  }

  if(typeof data === 'string') {
    data = new Buffer(data, 'utf-8');
  }

  if(!(data instanceof Buffer)) {
    throw new Error('data should be an instance of String or Buffer');
  }

  if(this._maxLength > 0 && data.length > this._maxLength) {
    throw new Error('data length exceeds the limitation:' + this._maxLength);
  }

  var len = data.length + PROTO_HEADER_LENGTH;
  var buf = new Buffer(len);
  fillHeader(buf, 0, uid, cmd, len);
  data.copy(buf, PROTO_HEADER_LENGTH);

  return buf;
};

/**
 * Feed data into composer. It would emit the package by an event when the package finished.
 *
 * @param  {Buffer} data   next chunk of data read from stream.
 * @param  {Number} offset (Optional) offset index of the data Buffer. 0 by default.
 * @param  {Number} end    (Optional) end index (not includ) of the data Buffer. data.lenght by default.
 * @return {Void}
 */
pro.feed = function(data, offset, end) {
  if(!data) {
    return;
  }

  if(this._state === ST_ERROR) {
    throw new Error('compose in error state, reset it first');
  }

  offset = offset || 0;
  end = end || data.length;
  while(offset < end) {
    if(this._state === ST_HEADER) {
      offset = this._readHeader(data, offset, end);
    }

    if(this._state === ST_DATA) {
      offset = this._readData(data, offset, end);
    }

    if(this._state === ST_ERROR) {
      break;
    }
  }
};

/**
 * Reset composer to the init status.
 */
pro.reset = function() {
  this._state = ST_HEADER;
  this._buf = new Buffer(PROTO_HEADER_LENGTH);
  this._offset = 0;
  this._left = 0;

  this._header = null;
};

pro._readHeader = function(data, offset, end) {
  var dataLen = end - offset;
  var left = PROTO_HEADER_LENGTH - this._offset; 

  if (dataLen < left) {
    data.copy(this._buf, this._offset, offset, end);
    this._offset += dataLen;
    return dataLen;
  }

  var headerEndPos = offset + left;
  data.copy(this._buf, this._offset, offset, headerEndPos);

  this._header = {
    len : this._buf.readUInt32LE(0),
    seq : this._buf.readUInt32LE(4),
    cmd : this._buf.readUInt16LE(4 * 2),
    ret : this._buf.readUInt32LE(4 * 2 + 2),
    uid : this._buf.readUInt32LE(4 * 3 + 2)
  };

  this._state = ST_DATA;
  this._offset = 0;
  this._left = this._header.len - PROTO_HEADER_LENGTH;
  this._buf = new Buffer(this._left);

  return headerEndPos;
};

// read data part of package
pro._readData = function(data, offset, end) {
  var left = end - offset;
  var size = Math.min(left, this._left);
  data.copy(this._buf, this._offset, offset, offset + size);
  this._left -= size;
  this._offset += size;

  if(this._left === 0) {
    var header = this._header;
    var buf = this._buf;
    this.reset();
    this.emit('data', header, buf);
  }

  return offset + size;
};

// {
//  uint32 len,
//  uint32 seq,
//  uint16 cmd,
//  uint32 ret,
//  uint32 uid
// }
var fillHeader = function(buf, offset, uid, cmd, len) {
  buf.writeUInt32LE(len, offset); 
  buf.writeUInt32LE(0, offset + 4); 
  buf.writeUInt16LE(cmd, offset + 4 * 2); 
  buf.writeUInt32LE(0, offset + 4 * 2 + 2);
  buf.writeUInt32LE(uid, offset + 4 * 3 + 2);
};
