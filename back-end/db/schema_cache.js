var modelRouting = require("../api/model_routing");

var redis = require('./redis');
var _ = require('underscore');

var loadingSchemas = null;

// The schemas defined here will be cached by id when the application starts
var cacheByDefault = {
    position:"positions",
    payroll_frequency:"payroll_frequencies",
    role:"roles",
    service:"services"
};

var schemaKeyMap = {
};

var databasesCached = {

};

// fill in schemaKeyMap based on the defaults above
for (var key in cacheByDefault) {
    if (cacheByDefault.hasOwnProperty(key)) {
        schemaKeyMap[key] = cacheByDefault[key];
    }
}

var calculateKeyName = function(schemaName, keyName){
    // if there is already an entry in the schemaKeyMap, use that keyName
    if(schemaKeyMap[schemaName] !== undefined){
        keyName = schemaKeyMap[schemaName];

    // otherwise, check if they provided a keyName
    }else if(keyName !== undefined){
        var schemaKey = schemaKeyMap[schemaName];
        // if the map doesn't yet contain an entry linking the collection (schema) to the redis key, add it to the running list of caches
        if(schemaKey === undefined){
            // save the provided name in the schemaKeyMap for later use
            schemaKeyMap[schemaName] = keyName;
        }else if(schemaKeyMap[schemaName] === keyName){
            throw "Redis key for schema " + schemaName + " already defined with different value: " + schemaKeyMap[schemaName] + " != " + keyName;
        }
    }else{
        throw "Unable to determine redis key for schema " + schemaName;
    }

    return keyName;
};

/*
* Queries mongo to load the collection and store them as a map in redis
*/
var cacheSchema = function (db, schemaName, idField, keyName, callBack) {
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling cacheSchema without a proper db object";
    }
    schemaName = schemaName.toLowerCase();
    var Model = modelRouting.getModelByName(db, schemaName);
     if(Model){

        var key = db.name + "-" + calculateKeyName(schemaName, keyName);
        Model.find(function(err, models){
            if(err){
                console.error(err);
                return;
            }

            var redisMap = {};
            if(models.length > 0){
                for (var i = 0; i < models.length; i++) {
                    var row = models[i];
                    redisMap[row[idField]] = JSON.stringify(row);
                }
                var redisClient = redis.getClient();
                redisClient.hmset(key, redisMap, function(err, reply){
                    if(err){
                        console.error(err);
                        return;
                    }
                    if(callBack) callBack();
                });
            }else{
                if(callBack) callBack();
            }

        });
     }
};


var updateKeyValue = function(db, schemaName, idField, keyName, value, callBack){
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling updateKeyValue without a proper db object";
    }
    if(!_.isObject(value)){
        throw "Calling updateKeyValue without a value object";
    }

    schemaName = schemaName.toLowerCase();
    var Model = modelRouting.getModelByName(db, schemaName);
    if(Model){
        var key = db.name + "-" + calculateKeyName(schemaName, keyName);
        var redisClient = redis.getClient();
        var redisMap = {};
        redisMap[value[idField]] = JSON.stringify(value);
        redisClient.hmset(key, redisMap, function(err, reply){
            if(err){
                console.error(err);
                return;
            }
            if(callBack) callBack();
        });        
    }
};

/*
* get the names of the cache keys used for the schemas
*/
var getKeys = function () {
    var keys = [];
    for (var schemaName in schemaKeyMap) {
        if (schemaKeyMap.hasOwnProperty(schemaName)) {
            keys.push(schemaKeyMap[schemaName]);
        }
    }
    return keys;
};

/*
* get the names of the schames this class will cache by default
*/
var getDefaultSchemas = function () {
    var names = [];
    for (var schemaName in cacheByDefault) {
        if (cacheByDefault.hasOwnProperty(schemaName)) {
            names.push(schemaName);
        }
    }
    return names;
};

/*
* get the names of the schames this class has cached, even those added dynamically
*/
var getAllSchemas = function () {
    var names = [];
    for (var schemaName in schemaKeyMap) {
        if (schemaKeyMap.hasOwnProperty(schemaName)) {
            names.push(schemaName);
        }
    }
    return names;
};


/*
* Manually adding the value of a particular db to indicate that we're done caching its collections
*/
var markDbAsCached = function(db){
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling markDbAsCached without a proper db object";
    }    
    databasesCached[db.name] = true;
};


/*
* recursive function which loads all the schemas in the loadingSchemas array
*/
var loadNextSchema = function (db, callBack) {
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling loadNextSchema without a proper db object";
    }    
    if(loadingSchemas && loadingSchemas.length > 0){
        var schemaName = loadingSchemas.pop();
        cacheSchema(db, schemaName, "_id", null, function() {
            console.log(db.name + " > " +schemaName + " cached");
            loadNextSchema(db, callBack);
        });
    }else{
        // this tells the system that all collections that need to be cached for the given db have been cached
        markDbAsCached(db);
        if(callBack) callBack();
    }
};



/*
*  Called when the application starts it loads all the default schemas from the db onto redis
*/
var cacheDefaults = function(db, callBack) {
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling cacheDefaults without a proper db object";
    }      
    // only start the caching process if we haven't done so already
    if(databasesCached[db.name] === undefined || databasesCached[db.name] === null){
        loadingSchemas = getDefaultSchemas();
        console.log("Starting token caching for "+db.name+" ...");
        databasesCached[db.name] = false; // signifies that we've started caching, but we're not done yet...
        loadNextSchema(db, callBack); // callBack will be called when all the schemas have been cached recursively
    // if we already cached these defaults completely, invoke the callback immediately    
    }else if(databasesCached[db.name] === true){
        callBack();
    // if we started caching but we're not done yet, don't do anything, there is another callback waiting...
    }else if(databasesCached[db.name] === false){
        return;
    }
    
    
};

/*
*  Get a schema item by id from the redis cache
*/
var get = function(db, schemaName, id, callBack){
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling get without a proper db object";
    }  
    var key = db.name + "-" + schemaKeyMap[schemaName];
    if(isInitialized(db) && key && id){
        var redisClient = redis.getClient();
        redisClient.hmget(key, id.toString(), function(err, reply){
            if(err){
                console.error(err);
                return;
            }
            var value = null;
            if(reply.length >= 1){
                if(reply[0] !== null){
                    value = JSON.parse(reply[0]);
                }
            }
            if(callBack){
                callBack(value);
            }
        });
    }
};

/*
* Getter for initialized
*/
var isInitialized = function(db){
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling isInitialized without a proper db object";
    }     
    return databasesCached[db.name] === true;
};

/*
* To figure out if a Schema is cached here by default. This is used by the modelRouter to auto-populate properties 
* matching these schema names
*/
var isCachedByDefault = function(db, schemaName){
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling isCachedByDefault without a proper db object";
    }     
    if(!isInitialized(db)) return false;
    return cacheByDefault.hasOwnProperty(schemaName.toLowerCase());
};

/*
* To figure out if a schema is cached here (even if it wasn't cached by default). These don't get auto-populated
* in the modelRouter, but can still be used via the 'get' method.
*/
var isCached = function(db, schemaName){
    if(db === null || db.connection === undefined || db.name === undefined){
        throw "Calling isCached without a proper db object";
    }     
    if(!isInitialized(db)) return false;
    return schemaKeyMap.hasOwnProperty(schemaName.toLowerCase());
};

module.exports = {
    cacheDefaults:cacheDefaults,
    cacheSchema:cacheSchema,
    updateKeyValue:updateKeyValue,
    get:get,
    isInitialized: isInitialized,
    isCached: isCached,
    isCachedByDefault: isCachedByDefault,
    markDbAsCached:markDbAsCached
};