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

var strregex = "^[0-9a-fa-f]+$";
var re = new RegExp(strregex);
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
  if(typeof(req.query.lookup) !== 'object' && req.query.lookup)
    req.query.lookup = [req.query.lookup]

  getStatesFor(req.params.contractName, req.query.lookup).then(function(resp){
    res.send(resp);
  });
});

// TODO: deprecate this function
// it is now equivalent to
// `/:contractName/state?lookup=currentVendor&lookup=sampleType...`
router.get('/:contractName/state/reduced', cors(), function (req, res) {
  if (typeof(req.query.props) === 'undefined' ) {
    res.status(400).send('Bad Request: No `props` parameter in query string')
    return;
  }

  var props;

  if (typeof(req.query.props) === 'string' ) {
    props = req.query.props.split();
  } else {
    props = req.query.props;
  }

  getStatesFor(req.params.contractName, props).then(function(resp){
    res.send(resp);
  });
});

// TODO: re-write for req.query.lookup
router.get('/:contractName/state/summary', cors(), function (req, res) {
  var well = req.query.well;
  getStatesFor(req.params.contractName).then(function(resp){
    if (resp.length === 0) {
      res.send(resp);
      return;
    }
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
  var promises = [];
  var masterContract = {};
  return new Promise(function (resolve, reject) {
    var results = helper.contractsMetaAddressStream(contractName, 'Latest');
    if(results === null){
      console.log("couldn't find any contracts");
      resolve([]);
    } else {
      results.pipe( es.map(function (data,cb) {
        if (data.name === contractName) {
          if(!re.test(data.address)) {
            resolve('[]');
            return;
          }
          found = true;
          masterContract = JSON.stringify(data);
          cb(null,data);
        }
        else cb();
      }))

      .pipe( es.map(function (data, cb) {
        rp({uri: apiURI + '/eth/v1.2/account?address='+data.address, json: true})
          .then(function (result) {
            cb(null, result[0].code)
          })
          .catch(function (err) {
            cb(null, err)
          });
      }))

      .pipe( es.map(function (data, cb) {
        // resolve(data);
        var options = {
          method: 'POST',
          uri: apiURI + '/eth/v1.2/account/code' ,
          form: {
            code: data
          },
        }
        rp(options)
          .then(function (result) {
            console.log(result);
            cb(null, JSON.parse(result));
          })
          .catch(function (err) {
            console.log("rp failure", err);
            cb(null, err)
          });
      }))

      .pipe( es.map(function (data,cb) {
        // console.log('data',data)
        addresses = data.map(function (item) {
          return item.address;
        });
        cb(null,addresses);
      }))

      .on('data', function(data) {
        var items = data;

        var delay = 0;
        for(var i=0; i < items.length; i++) {
          var item = items[i];
          var contractData = JSON.parse(masterContract);
          contractData.address = item;
          var contract = Solidity.attach(contractData);

          var payload = {contract:contract, reducedState:reducedState, attempt:0};

          var promise = DelayPromise(delay, payload).then(function(payload) {
            return buildContractState(payload.contract, payload.reducedState, payload.attempt);
          });
          delay += 15;
          promises.push(promise);

        }
      })

      .on('end', function () {

        if (!found) {
          resolve([]);
        }
        else {
          Promise.all(promises).then(function(resp){
            resolve(resp);
          }).catch(function(err){
            reject(err);
          });
        }
      });
    }
  });

}

function buildContractState(contract, reducedState, attempt) {
  if(reducedState){
    var tempState = {};
    reducedState.forEach(function(x){
      tempState[x] = contract.state[x];
    })
    contract.state = tempState;
  }

  // console.log("State length:"  + Object.keys(contract.state).length)

  return Promise.props(contract.state).then(function(sVars) {

    var parsed = traverse(sVars).forEach(function (x) {
      if (Buffer.isBuffer(x)) {
        this.update(x.toString());
      }
    });

    var stateAndAddress = {};
    stateAndAddress.address = contract.account.address;
    stateAndAddress.state = parsed;
    return stateAndAddress;
  })
  .catch(function(err) {
    console.log("contract/state sVars - error: " + err);
    if(attempt < 10) {
      console.log('attempt: ', attempt);
      return new Promise(function(resolve, _) {
        setTimeout(function(){
          resolve(buildContractState(contract, reducedState, attempt + 1));
        }, 100);
      });
    }
  });
}

function DelayPromise(delay, payload) {
  return new Promise(function(resolve, _) {
    setTimeout(function() {
      resolve(payload);
    }, delay);
  });
}

module.exports = router;
