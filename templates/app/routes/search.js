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

var homeTemplate = require('marko').load(require.resolve('../components/home/home.marko'));
var contractTemplate = require('marko').load(require.resolve('../components/contracts/template.marko'));

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

router.get('/:contractName/state', cors(), function (req, res) {
  getStatesFor(req.params.contractName).then(function(resp){
    res.send(resp);
  });
});

router.get('/:contractName/state/reduced', cors(), function (req, res) {
  const reducedStatePropeties = ['currentVendor', 'sampleType', 'currentState',
    'currentLocationType','buid', 'wellName'];
    getStatesFor(req.params.contractName, reducedStatePropeties).then(function(resp){
      res.send(resp);
    });
});

router.get('/:contractName/state/summary', cors(), function (req, res) {
  var well = req.query.well;
  getStatesFor(req.params.contractName).then(function(resp){
    var summary = [];
    if (well) {
      var wellSummary = {};
      var filtered = resp.filter(function(item) {
        return item.state.wellName === well;
      });
      filtered.forEach(function(item) {
        if(wellSummary[item.state.currentState.key]) {
          wellSummary[item.state.currentState.key]++;
        } else {
          wellSummary[item.state.currentState.key] = 1;
        }
      });
      summary.push(wellSummary)
    } else {

      // Get all well names
      var wells = [];
      console.log(resp);
      resp.forEach(function(item){
        if (!wells.includes(item.state.wellName)) {
          wells.push(item.state.wellName);
        }
      });

      wells.forEach(function(item){
        var wellSummary = {};
        wellSummary[item] = {};

        resp.forEach(function(sample) {
          if (sample.state.wellName === item) {
            if (wellSummary[item][sample.state.currentState.key]) {
              wellSummary[item][sample.state.currentState.key]++;
            } else {
              wellSummary[item][sample.state.currentState.key] = 1;
            }
          }
        });
        summary.push(wellSummary);
      });
    }
    res.send(summary);
  });
});

function getStatesFor(contract, reducedState) {
  var contractName = contract;
  var found = false;

  var addresses;
  var states = {};
  var promises = [];
  var masterContract = {};
  var xabi = {};

  return new Promise(function (resolve, reject) {
    let results = helper.contractsMetaAddressStream(contractName, 'Latest');

    if(results === null){
      console.log("couldn't find any contracts");
      res.send("[]")
    } else {
        results.pipe( es.map(function (data,cb) {
          if (data.name == contractName) {
            found = true;
            masterContract = JSON.stringify(data);
            xabi = data.xabi;
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
              cb(null, result)
            })
            .catch(function (err) {
              console.log("rp failure", err);
              cb(null, err)
            });
        }))

        .pipe( es.map(function (data,cb) {
          addresses = data.map(function (item) {
            return item.address;
          });
          cb(null,addresses);
        }))

        .on('data', function(data) {
          let items = data;
          let contractData = {};

          //Get initial abi/bin to create first contract
          for(var prop in masterContract){
            contractData[prop] = masterContract[prop];
          }
          for(var i=0; i < items.length; i++) {
            const item = items[i];
            console.log('address is: ',item);
            const contractData = JSON.parse(masterContract);
            contractData.address = item;
            const contract = Solidity.attach(contractData);

            var promise = Promise.props(contract.state).then(function(sVars) {
              var reduced = {};
              if(reducedState) {
                reducedState.forEach(function(prop) {
                  reduced[prop] = sVars[prop];
                });
              } else {
                reduced = sVars;
              }

              var parsed = traverse(reduced).forEach(function (x) {
                if (Buffer.isBuffer(x)) {
                  this.update(x.toString());
                }
              });
              var stateAndAddress = {};
              stateAndAddress.address = contractData.address;
              stateAndAddress.state = parsed;
              return stateAndAddress;
            })
            .catch(function(err) {
              console.log("contract/state sVars - error: " + err)
            });
            promises.push(promise);
          }
        })

        .on('end', function () {

          if (!found) {
            res.send("contract not found");
          }
          else {
            Promise.all(promises).then(function(resp){
              resolve(resp);
            });
          }
        });
      }
  });

}

module.exports = router;
