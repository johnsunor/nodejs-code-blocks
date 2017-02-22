
var fs = require('fs');
var async = require('async');
var protobuf = require('protocol-buffers');
var utils = require('./util/utils');
var TcpClient = require('./tcpClient');

var logger = console;

var genMessages = function(target) {
  if (!fs.existsSync(target)) {
    throw new Error('target not exists:' + target);
  }

  var protoFileList;
  var lstat = fs.lstatSync(target);
  if (lstat.isDirectory()) {
    protoFileList = fs.readdirSync(target)
                        .map(function(file) { return target + '/' + file; });
  } else if (lstat.isFile()) {
    protoFileList = [target];
  } else {
    throw new Error('target should be a dir or a regular file');
  }

  var protoFile, content, idx;
  var mergedContent = '';
  for (var i = 0, len = protoFileList.length; i < len; ++i) {
    protoFile = protoFileList[i];
    if (!utils.endsWith(protoFile, '.proto')) {
      continue;
    }
    content = fs.readFileSync(protoFile).toString();
    idx = content.indexOf('import');
    if (idx !== -1) {
      idx = content.indexOf('\n', idx);
    }
    idx = (idx === -1) ? 0 : idx;
    mergedContent += content.substr(idx, content.length);
  }

  return protobuf(mergedContent);
};

var testproto = genMessages('./proto');
var client = TcpClient.create({host : '127.0.0.1', port : '8080'});

async.waterfall([
  function(next) {
    client.connect(function(err) {
      if (err) {
        logger.log('client setup failed: ', err);
      }
      next(err);
    });
  },

  function(next) {
    var uid = 123;
    var cmd = 123;
    var csMsg = testproto.csTestMsg.encode({type : 123});
    client.send(uid, cmd, csMsg, (err, header, data) => {
      if (err) {
        logger.log('err: ', err);
      } else {
        logger.log('header: ', header);
        var scMsg = testproto.scTestMsg.decode(data);
        logger.log('scMsg: ', scMsg);
      }
      next(err);
    });
  }
]);
