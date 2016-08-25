'use strict';

var express = require('express');
var helper = require('../lib/contract-helpers.js');
var router = express.Router();
var Promise = require('bluebird');
var ba = require('blockapps-js');
var Solidity = ba.Solidity;

var cors = require('cors');
var traverse = require('traverse');
var es = require('event-stream')
var rp = require('request-promise');

require('marko/node-require').install();

var yaml = require('js-yaml');
var fs = require('fs');
var config = yaml.safeLoad(fs.readFileSync('config.yaml'));
var apiURI = config.apiURL;


/* accept header used */
router.get('/:contractName', cors(), function (req, res) {
  var contractName = req.params.contractName;
  helper.contractAddressesStream(contractName)
      .pipe( helper.collect() )
      .pipe( es.map(function (data,cb) {
        var names = data.map(function (item) {
          return item.split('.')[0];
        });

        cb(null,JSON.stringify(names));
      }))
      .pipe(res)
});

router.get('/:contractName/:contractAddress/functions', cors(), function (req, res) {
  var contractName = req.params.contractName;
  var contractAddress = req.params.contractAddress;
  var found = false;

  helper.contractsMetaAddressStream(contractName,contractAddress)
        .pipe( es.map(function (data,cb) {
          if (data.name == contractName) {
            found = true;
            var funcs = Object.keys(data.xabi.funcs);
            cb(null,JSON.stringify(funcs));
          }
          else cb();
        }))
        .on('error', function(err) {
          console.log("error: " + err);
          res.send(err);
        })
        .on('data', function(data) {
          res.send(data);
        })
        .on('end', function() {
          if (!found) res.send("contract not found");
        });
});

router.get('/:contractName/state', cors(), function (req, res) {
  var contractName = req.params.contractName;
  var found = false;

  var addresses;
  var states = {};
  var masterContract;

  helper.contractsMetaAddressStream(contractName, 'Latest')
      .pipe( es.map(function (data,cb) {
        if (data.name == contractName) {
          found = true;
          masterContract = data;
          //console.log("Found contract Latest: " + JSON.stringify(data))
          //console.log("The `address` is: " + data.address)
          cb(null,data);
        }
        else cb();
      }))

      .pipe( es.map(function (data, cb) {
        rp({uri: apiURI + '/eth/v1.2/account?address='+data.address, json: true})
          .then(function (result) {
            //console.log("s1: " + JSON.stringify(result))
            cb(null, result[0].code)
          })
          .catch(function (err) {
            cb(null, err)
          });
      }))

      .pipe( es.map(function (data, cb) {
        rp({uri: apiURI + '/eth/v1.2/account?code='+data, json: true})
          .then(function (result) {
            //console.log("s2: " + JSON.stringify(result))
            cb(null, result)
          })
          .catch(function (err) {
            cb(null, err)
          });
      }))

      .pipe( es.map(function (data,cb) {
        addresses = data.map(function (item) {
          return item.address;
        });
        cb(null,addresses);
      }))

      .pipe( es.map(function (data, cb) {

        var items = data;

        function lookupState(item){
          return new Promise(function(resolve, _){
            setTimeout(function(_){

              var tempContract = masterContract;
              //console.log("Fed data as: " + JSON.stringify(item))
              tempContract.address = item;

              var contract = Solidity.attach(tempContract);
              return Promise.props(contract.state)
                    .then(function(sVars) {

                      var parsed = traverse(sVars).forEach(function (x) {
                        if (Buffer.isBuffer(x)) {
                          this.update(x.toString());
                        }
                      });
                      states[item] = parsed;
                      resolve("lookupState() complete: " + JSON.stringify(parsed));
                    })

                    .catch(function(err) {
                      console.log("contract/state sVars - error: " + err)
                    });
            });
          });
        }

        function processItem(item){
          var steps = [lookupState];
          return steps.reduce(function(current, next){
            return current.then(function(_) {
              //console.log("l1: " + res);
              return next(item);
            }).then(function(_){
              //console.log("l2: " + res);
            });
          },Promise.resolve());
        }
        var processedItems = items.map(function(i){processItem(i)}).reduce(
            function(p, next){p.then(next)}, Promise.resolve()
        ).then(function(_){
          cb(null, processedItems)
        });

      }))

      .on('data', function(_) {
        // console.log("on: " + JSON.stringify(states))
        res.send(JSON.stringify(states))
      })

      .on('end', function () {
        if (!found) res.send("contract not found");
      });
});

module.exports = router;
