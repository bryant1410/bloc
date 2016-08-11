'use strict';

var express = require('express');
var cors = require('cors');
var router = express.Router();
var contractHelpers = require('../lib/contract-helpers.js');
var lw = require('eth-lightwallet');

var es = require('event-stream');
var del = require('del');
//var rimraf = require('rimraf');
//var vinylFs = require( 'vinyl-fs' );
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs')); 
var mkdirp = Promise.promisifyAll(require('mkdirp'));

var path = require('path');
var yaml = require('js-yaml');

var config = yaml.safeLoad(fs.readFileSync('config.yaml'));
var apiURI = config.apiURL;

var api = require('blockapps-js');

var Solidity = require('blockapps-js').Solidity;
var bodyParser = require('body-parser');

var jsonParser = bodyParser.json();

var Transaction = api.ethbase.Transaction;
var units = api.ethbase.Units;
var Int = api.ethbase.Int;
//var ethValue = api.ethbase.Units.ethValue;

var compile = require("../lib/compile.js");
var upload = require("../lib/upload.js");

function float2rat(x) {
  var tolerance = 1.0E-6;
  var h1=1; var h2=0;
  var k1=0; var k2=1;
  var b = x;
  do {
    var a = Math.floor(b);
    var aux = h1; h1 = a*h1+h2; h2 = aux;
    aux = k1; k1 = a*k1+k2; k2 = aux;
    b = 1/(b-a);
  } while (Math.abs(x-h1/k1) > x*tolerance);
    
  return h1+"/"+k1;
}

router.get('/', cors(), function(req, res) {
  contractHelpers.userNameStream()
      .pipe(contractHelpers.collect())
      .on('data', function(data) {
        res.send(JSON.stringify(data));
      });
});

router.get('/:user', cors(), function(req, res) {
  var user = req.params.user;

  contractHelpers.userKeysStream(user)
      .pipe( es.map( function (data, cb) { 
        cb(null, data.addresses[0]);
      }))
      .pipe(contractHelpers.collect())
      .on('data', function(data) {
        res.send(JSON.stringify(data));
      });
});

/* generate key, and hit faucet */
router.post('/:user', cors(), function(req, res) {

  var user = req.params.user;
  var thePath = path.join('app', 'users', user);
  var password = req.body.password;

  console.log("body: " + JSON.stringify(req.body));

  //console.log("thePath: " + thePath);
    
  if (req.body.faucet === '1'){
    if (typeof password === 'undefined' || password === '') { 
      res.send('password required for faucet call');
      return;
    }
    var seed = lw.keystore.generateRandomSeed();

    var store = new lw.keystore(seed, password);
    store.generateNewAddress(password);

    var fileName = path.join(thePath, store.addresses[0] + '.json');
      
    mkdirp(thePath, function (err) { 
      if (err) { console.err(err); res.send(err); }
      else { 
        fs.writeFile(fileName, store.serialize(), function() { 
          console.log("wrote: " + fileName);
        });
      }
    });
   
    api.query.serverURI = process.env.API || apiURI;
    console.log("hitting faucet for " + store.addresses[0]);
      
    api.routes.faucet(store.addresses[0])
      .then(function(_) {
        res.send(store.addresses[0]);
      })
      .catch(function(err) { 
        res.send(err);
      });

  } else if(req.body.remove === '1'){

    if (typeof password === 'undefined' || password === '') { 
      // TODO should really check password here?
      res.send('password required for removal call');
      return;
    }
    var newAddress = req.body.address;
    var fileName = path.join(thePath, newAddress + '.json');
    console.log("REMOVING: name: " + user + "  address = " + req.body.address)

    del([fileName]).then(function(paths){
      console.log('Deleted files and folders:\n', paths.join('\n'));
      fs.rmdir(thePath, function(err, _){
        console.log("user " + user + " gone because empty: "+err);
      });
    });

  } else if(req.body.register == '1'){
    console.log("registering address with device");

    var address = req.body.address;
    var token = req.body.token;

    var json = {"addresses":[address], "token":token};

    var fileName = path.join(thePath, address + '.json');
    console.log("filename: " + fileName)

    mkdirp(thePath, function (err) { 
      if (err) { console.err(err); res.send(err); }
      else { 
        fs.writeFile(fileName, JSON.stringify(json), function() { 
          res.send(address);
        });
      }
    });

  } else {
    if (typeof password === 'undefined' || password === '') { 
      res.send('password required for key generation');
      return;
    }
    console.log("just registering name, no faucet called");

    var seed = lw.keystore.generateRandomSeed();
  
    var store = new lw.keystore(seed, password);
    store.generateNewAddress(password);

    var newAddress = store.addresses[0];

    var fileName = path.join(thePath, newAddress + '.json');
    
    mkdirp(thePath, function (err) { 
      if (err) { console.err(err); res.send(err); }
      else { 
        fs.writeFile(fileName, store.serialize(), function() { 
          res.send(newAddress);
        });
      }
    });
  }
});


router.post('/:user/:address/send', cors(), function(req, res) {
  var password = req.body.password;
  var user = req.params.user;  
  var address = req.params.address;
  var toAddress = req.body.toAddress;
  var value = req.body.value;

  var found = false;

  var strVal = float2rat(value);

  var h1 = strVal.split('/')[0];
  var h2 = strVal.split('/')[1];

  if (typeof password === 'undefined' || password === '') {
    res.send('password required');
    return;
  }

  if (typeof toAddress === 'undefined' || toAddress === '') {
    res.send('toAddress required');
    return;
  }

  if (typeof value === 'undefined' || value === '') {
    res.send('value required');
    return;
  }

  contractHelpers.userKeysStream(user)
      .pipe(es.map(function (data,cb) {
        if (data.addresses[0] == address) cb(null,data);
        else cb();
      }))

      .on('data', function (data) {
         
        api.query.serverURI = process.env.API || apiURI;               
        found = true; 
             
        try { 
          var store = new lw.keystore.deserialize(JSON.stringify(data));
          var privkeyFrom = store.exportPrivateKey(address, password);
        } catch (e) {
          console.log("don't have the key!");
          res.send("invalid address or incorrect password");     
          return;
        }
  
        var valWei = units.convertEth(h1,h2).from("ether").to("wei");
        console.log(valWei);

        var valueTX = Transaction({"value" : valWei, 
                                         "gasLimit" : Int(21000),
                                         "gasPrice" : Int(50000000000)});
                 
        valueTX.send(privkeyFrom, toAddress)
        .then(function(txResult) {
          console.log("transaction result: " + txResult.message);
          res.send(JSON.stringify(valueTX));
        })
        .catch(function(err) { 
          res.send(err);
        }); 
      })

      .on('end', function () {
        if (!found) res.send('address ' + address + ' for user ' + user + ' not found');
      });
});

/* create contract from source */
router.options('/:user/:address/contract', cors()); // enable pre-flight request for DELETE request
router.post('/:user/:address/contract', cors(), function(req, res) {
  var user = req.params.user;  
  var address = req.params.address;
  var txParams = req.body.txParams;
  var contract = req.body.contract;
  console.log("contract as body is: " + contract)

  var args = req.body.args || {};
  console.log("constructor arguments: " + JSON.stringify(req.body.args));

  var password = req.body.password;
  var src = req.body.src;
  var found = false;

  if (typeof password === 'undefined' || password === '') {
    res.send('password required');
    return;
  }

  contractHelpers.userKeysStream(user)
      .pipe(es.map(function (data,cb) {
        if (data.addresses[0] == address) cb(null,data);
        else cb();
      }))
      .on('data', function (data) {
        console.log("data is: " + data.addresses[0])
        api.query.serverURI = process.env.API || apiURI;               
        found = true; 

        try { 
          var store = new lw.keystore.deserialize(JSON.stringify(data));
          var privkeyFrom = store.exportPrivateKey(address, password);
          
          console.log("About to upload contract")
        } catch (e) {
          console.log("don't have the key! error: " + e);
          res.send('invalid address or incorrect password');
          return;
        }

        compile(src)
        .then(function (solObj) {
          if (((typeof contract) === 'undefined') || (contract === undefined)) {
            console.log("caught a single contract")
            contract = solObj.src;
            console.log("uploading " + Object.keys(contract)[0])
            return upload(Object.keys(contract)[0],privkeyFrom, args, txParams);
          } else {
            console.log("caught a multi-contract")
            console.log("uploading " + contract)
            return upload(contract, privkeyFrom, args, txParams);
          }
          
        }).then(function (arr) {
          console.log("address of contract: " + arr[3]);
          res.send(arr[3]);
        }).catch(function(e) {
          console.log("error uploading contract: " + e);
          res.send("error uploading contract: " + e);
        });
      })
    .on('end', function () {
      if (!found) res.send('invalid address or incorrect password');
    }
  );
});

/* create contract from source */
router.options('/:user/:address/import', cors()); // enable pre-flight request for DELETE request
router.post('/:user/:address/import', jsonParser, cors(), function(req, res) {
  var password = req.body.password;
  //var method = req.body.method;
  var args = req.body.args;
  //var value = req.body.value;
  var src = req.body.src;
  var address = req.params.address;
  var user = req.params.user;
  
  var txParams = req.params.txParams;

  var name = req.body.name;
  var contract = req.body.contract;

  var args = req.body.args || {};
  console.log("constructor arguments: " + JSON.stringify(req.body.args));

  contractHelpers.userKeysStream(user)
  .pipe(es.map(function (data,cb) {

    if (data.addresses[0] == address) {
      console.log("user address found"); 
      cb(null,data); 
    }
    else{
      console.log("address does not exist for user");
      cb();
    } 
  }))
  .pipe(es.map(function(data, cb) {

    var privkeyFrom;
    try { 
      var store = new lw.keystore.deserialize(JSON.stringify(data));
      privkeyFrom = store.exportPrivateKey(address, password);
    } catch (e) {
      res.send("address not found or password incorrect");
    }

    cb(null, privkeyFrom);
    
  }))

  .on('data', function(privkeyFrom) {

    console.log("src: " + JSON.stringify(src))
    
    api.Solidity(src)
    .then(function(solObjs) { 
      console.log("have solidity object: " + JSON.stringify(solObj))
      var solObj = solObjs[contract][name]
      var toret;
      if (args.constructor === Object) {
        console.log("calling constructor")
        toret = solObj.construct(args);
      }
      else {
        console.log("calling constructor(2)")
        toret = solObj.construct.apply(solObj, args);
      }
      return toret.txParams(txParams).callFrom(privkeyFrom);
    })
    .then(function (arr) {
      console.log("address of imported contract: " + arr.account.address);
      res.send(arr.account.address.toString());
    }).catch(function(e) {
      res.send("error uploading contract: " + e);
    });
    return;
  })
  .on('end', function(){
    console.log("no more users to process")
  })
})

/*
   arguments JSON object
   {
     contract: contractName,
     password: yourPassword,
     method: theMethod,
     args: {
        namedArg1: val1,
        namedArg2: val2,
        ..
        }
    }
*/
router.options('/:user/:address/contract/:contractName/:contractAddress/call', cors()); // enable pre-flight request for POST request
router.post('/:user/:address/contract/:contractName/:contractAddress/call', jsonParser, cors(), function(req, res) {
  var password = req.body.password;
  var method = req.body.method;
  var args = req.body.args;
  var value = req.body.value;
  var txParams = req.body.txParams || {};
  var contractName = req.params.contractName;
  var contractAddress = req.params.contractAddress;
  var address = req.params.address;
  var user = req.params.user;
  var found = false;
  var remote = req.body.remote;
  //var userContractPath = path.join('app', 'users', user, 'contracts', contractName);
  //var metaPath = path.join('app', 'meta', contractName);

  console.log('args: ' + JSON.stringify(args));
  console.log('method: ' + method);
  console.log("remote is " + remote)
    
  contractHelpers.userKeysStream(user)
  .pipe(es.map(function (data,cb) {

    if (data.addresses[0] == address) {
      console.log("user address found");
      found = true; cb(null,data); 
    }
    else{
      console.log("address does not exist for user");
      cb();
    } 
  }))
  .pipe(es.map(function(data, cb) {

    if (data.token) {
      console.log("actually called through device - saving in queue"); 
      cb(null, data)
    } else { 
  
      var privkeyFrom;
      try { 
        var store = new lw.keystore.deserialize(JSON.stringify(data));
        privkeyFrom = store.exportPrivateKey(address, password);
      } catch (e) {
        res.send("address not found or password incorrect");
      }

      cb(null, privkeyFrom);
    }
  }))
  .on('data', function(privkeyFrom) {

    var cmas = contractHelpers.contractsMetaAddressStream(contractName, contractAddress);
    // if(cmas === null) {

    //   //console.log("no contract found at that address");
    //   //res.send("no contract found at that address");
    //   cmas = contractHelpers.contractsMetaAddressStream(contractName, contractName);
    // }
  
    cmas
    .pipe(contractHelpers.collect())
    .on('data', function(data){

      console.log("contract: " + JSON.stringify(data))

  // var fileName = path.join(metaPath,contractAddress+'.json');
  // fs.readFile(fileName, function (err,data) {

  //   if(data == undefined && remote == false){
  //     console.log("contract does not exist at that address: " + err);
  //     res.send("contract does not exist at that address");
  //     return;
  //   } else if (data == undefined && remote == true){
  //     var msg = "you want to invoke contract " + contractName + " at address " + contractAddress;

  //     // try opening `contractName.json` and attach it at contractAddress
  //     var fileNameMod = path.join(metaPath, contractName + '.json');
  //     console.log("contract to open: " + fileNameMod);

  //     contractHelpers.contractNameStream(contractName)
  //       .pipe(contractHelpers.collect())
  //       .on('data', function(contractdata) {
  //         console.log("hello data!!: " + contractdata)
  //         res.send(contractData);
  //       });


  //     // fs.readFile(fileNameMod, function(errMod, dataMod){
  //     //   console.log("this is the contract to modify: " + dataMod);

  //     //     res.send(msg);

  //     // })
  //   }

      //data[0].address = contractAddress;
      var contractJson = data[0];
      var contract = Solidity.attach(contractJson);
      //contract.address = contractJson.address;
      value = Math.max(0, value)
      if (value != undefined) {
        var pv = units.convertEth(value).from("ether").to("wei" );
        console.log("pv: " + pv.toString(10))
      }
      txParams.value = pv.toString(10);
      console.log("trying to invoke contract")

      if(contract.state[method] != undefined){
        console.log("args: " + JSON.stringify(args))
        try {
          var contractstate = contract.state[method](args).txParams(txParams);
        } catch (error){
          console.log("failed to look at state for contract: " + error)
          res.send("failed to look at state for contract: " + error)
          return;
        }

        if(privkeyFrom.token){
          console.log("Putting transaction in /pending")

          var date = new Date();
          var dt = date.getTime();
          var pp = path.join('app', 'pending', address);
          var filename = path.join(pp, dt+".json");
          mkdirp(pp, function (err) {   
            if (err) { 
              console.err(err); 
              res.send(err); 
            } else { 
              console.log('path: ' + pp)
              console.log('filename: ' + filename)
              var callData = {
                contractName: contractName, 
                method: method,
                args: args,
                time: dt,
                value: pv,
                message: req.body.message
              };
              var allData = {
                "tx":contractHelpers.txToJSON(contractstate)
                                    , "time":dt
                                    , "contract": JSON.parse(contract.detach())
                                    , "call":callData
              };
              console.log("to put in file: " + JSON.stringify(allData))
              fs.writeFile(filename, JSON.stringify(allData), function() { 
                console.log("wrote: " + filename);
                res.send("put transaction in queue for: " + address)
              });
            }
          });
        } else {
          console.log("Making function call now")
          contractstate.callFrom(privkeyFrom)
          .then(function (txResult) {
            var string = (txResult && Buffer.isBuffer(txResult)) ? txResult.toString('hex') : txResult+"";
            console.log("txResult", typeof txResult, txResult, string);
            res.send("transaction returned: " + string);
          })
          .catch(function(err) { 
            console.log("error calling contract: " + err)
            res.send(err);
            return;
          });
        }
      } else {
        console.log("contract " + contractName + " doesn't have method: " + method);
        res.send("contract " + contractName + " doesn't have method: " + method);
        return;
      } 
    }).on('end', function(){
      console.log("no more contract(s) found at address")
    })
  })
  .on('end', function () {
    if (!found){
      console.log('user not found: ' + user);
      res.send('user not found: ' + user);
    }
  })
});

module.exports = router;
