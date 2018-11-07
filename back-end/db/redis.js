var redis = require('redis');
var url   = require("url");


var client = null;

var connect = function(errCallback, connectCallBack){

    // for local this is defined in .env (heroku local automatically creates an environment variable from this file)
    // for remote it is defined as an environment variable
    //------------------------------------------
    var redisURL = process.env.REDIS_URL;
    //------------------------------------------
    
    // for debugging, if not launching through heroku local (e.g. vistual studio code), we must define this manually
    //------------------------------------------
    if(redisURL === undefined){
        redisURL = "redis://localhost:6379";
        console.log("Defaulting to localhost:6379 for redis connection");
    }

    var redisUrlObj = url.parse(redisURL);
    //------------------------------------------

    console.log("Attempting Redis connection to " + redisURL);
    client = redis.createClient(redisUrlObj.port, redisUrlObj.hostname); //creates a new client

    if(redisUrlObj.auth){
        client.auth(redisUrlObj.auth.split(":")[1]);
    }

    client.on('error', function (err) {
        console.log('Redis error event - ' + client.host + ':' + client.port + ' - ' + err);
    });

    client.on('connect', function() {
        console.log('Connection to Redis successful');
        if(connectCallBack)connectCallBack();
    });

    return client;
};

var getClient = function(){
    return client;
};


module.exports = {
    connect : connect,
    getClient : getClient
};
