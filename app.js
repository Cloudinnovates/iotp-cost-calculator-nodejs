/*jshint esversion: 6, node:true */
"use strict";
const jsonSize = require("json-size");
const Cloudant = require('cloudant');
const fs = require("fs");

const DependencyFactory = require("./util/dependencyFactory");

const dbName = "iotp-cost-calculator";
const inputFile = require("./jsonconf.json");

var contents = fs.readFileSync('VERSION', 'utf8');
var version = contents.substring(0,contents.indexOf("\n"));
var version_date = contents.substring(contents.indexOf("\n"),contents.length);
console.log("Running version: " + version);
console.log("This was last verified on: " + version_date);

let wait_time = setWaitTime();
let device_type = "SimDevice";
let device_id = "SimDevice";
let event_type = "calculator-event";
let env = DependencyFactory.getEnvironment();
let appClient = DependencyFactory.getIotClient();

var storage;

let start_date = new Date().toISOString().replace(/T.+/, '');

appClient.on("error", function(err) {
  console.log("A wild error appeared! : " + err);
});

appClient.on("connect", function() {
  console.log("Appclient connected");
  let qos_levels = [0, 1, 2];
  let sending_times = [10, 100, 1000, 10000, 100000, 1000000];
  let iteration_sets = [];
  let iteration_set;

  let inputs = Object.keys(inputFile.sizes);
  for (let key in inputs) {
    let actual_size = jsonSize(inputFile.sizes[inputs[key]]);
    for (let qos in qos_levels) {
      for (let sending_time in sending_times) {
          iteration_set = {
            "sending_time": sending_times[sending_time],
            "actual_size": actual_size,
            "payload": inputFile.sizes[inputs[key]],
            "qos": qos
          };
          iteration_sets.push(iteration_set);
      }
     }
    }
    console.log("Waiting " + wait_time + " seconds to be sure no old runs interfer with usage reporting");
    setTimeout(function(){
      calculatorIteration(iteration_sets);
    },wait_time*1000);
});
/**
 */
function publishMessages(sending_time,old_data_usage,start,iteration_set,iteration_sets,callback){
  if(sending_time > 0){
    sending_time = sending_time-1;
    appClient.publishDeviceEvent(device_type,device_id, event_type, "json", JSON.stringify(iteration_set.payload), iteration_set.qos, () => {
      publishMessages(sending_time,old_data_usage,start,iteration_set,iteration_sets,callback);
    });
    } else {
    let end = Date.now();
    console.log("Finished sending messages");
    let time_took = (end - start)/1000;
    console.log("Sending the messages took " + time_took + " seconds");
    if(callback){
      let data = {};
      data.iteration_set = iteration_set;
      data.time_took = time_took;
      data.old_data_usage = old_data_usage;
      callback(data);
    }
  }
}

function calculatorIteration(iteration_sets){
  if(iteration_sets.length > 0){
    let iteration_set = iteration_sets[0];
    iteration_sets.splice(0,1);
    let doc_id = wait_time + "_" + iteration_set.qos + "_" + iteration_set.sending_time + "_" + iteration_set.actual_size;
    docExists(doc_id,function(){
      //does exist
      iteration_sets.splice(0,1);
      calculatorIteration(iteration_sets);
    }, function(){
      //does not exist
      appClient.getDataUsage(start_date, new Date().toISOString().replace(/T.+/, '')).then(function(data) {
        let old_data_usage = data.total;
        console.log("Sending messages of size: " + iteration_set.actual_size + " with qos: " + iteration_set.qos + " " + iteration_set.sending_time + " times");
        let start = Date.now();
        publishMessages(iteration_set.sending_time,old_data_usage,start,iteration_set,iteration_sets,function(data){
          setTimeout(function(){
            createAndStoreIterationInfo(data,iteration_sets,calculatorIteration);
          },wait_time*1000);
        });
      });
    });
  } else {
    appClient.disconnect();
    console.log("App run finished");
  }
}

function createAndStoreIterationInfo(data,iteration_sets,callback){
  console.log("Waiting " + wait_time + " to get data usage.");
  setTimeout(function(){
    appClient.getDataUsage(start_date, new Date().toISOString().replace(/T.+/, '')).then(function(newData) {
    let doc_id = wait_time + "_" + data.iteration_set.qos + "_" + data.iteration_set.sending_time + "_" + data.iteration_set.actual_size;
    let information = {"_id": doc_id,
    "storage_datetime": new Date().toISOString(),
    "storage_timestamp": Date.now(),
    "old_data_usage": data.old_data_usage,
    "reported_data_usage": newData.total,
    "delta_data_usage": newData.total - data.old_data_usage,
    "assumed_delta_data_usage": data.iteration_set.sending_time * data.iteration_set.actual_size,
    "sending_time": data.iteration_set.sending_time,
    "qos": data.iteration_set.qos,
    "actual_size": data.iteration_set.actual_size,
    "time_took": data.time_took,
    "version": version};
    console.log(information);
    console.log("Storing information under id " + doc_id);
    storage.insert(information, doc_id, function(err, body) {
      if (!err){
        console.log("Successfully stored information:\n" + JSON.stringify(body));
        if(callback){
          callback(iteration_sets);
        }
      } else {
        console.log("Doc already exists");
        if(callback){
          callback(iteration_sets);
        }
      }
    });
    });
  },wait_time*1000);
}

/**
 */
function initializeCloudant(callback) {
  let credentials = DependencyFactory.getCredentials("cloudantNoSQLDB");
  let cloudant = Cloudant({
    url: credentials.url
  });
  cloudant.db.create(dbName, function(err, data) {
    if (err) { //If database already exists
      console.log("Database exists.");
    } else {
      console.log("Created database.");
    }
  });
  storage = cloudant.db.use(dbName);
  storage.list(function(err, body) {
    if (!err) {
      console.log("Cloudant contains " + body.rows.length + " documents.");
      callback(storage);

    }
  });
}

function setWaitTime(){
  if(process.env.VCAP_SERVICES){
    console.log("Running on cloud foundry setting wait_time to 10800");
    return 10800;
  } else {
    console.log("Running on local setting wait_time to 1");
    return 1;
  }
}

function docExists(doc_id, exists_callback, not_exists_callback){
  storage.get(doc_id, function(err, data) {
    if(!err){
      exists_callback();
    } else {
      not_exists_callback();
    }
});
}

initializeCloudant(function() {
  console.log("Starting iotp-cost-calculator");
  console.log("Start Date: " + start_date);
  appClient.connect();
});
