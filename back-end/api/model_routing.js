var express = require("express");
var router = express.Router();
var redis = require('../db/redis');
var mongodb = require('../db/mongodb');
var _ = require('underscore');
var async = require("async");
var json2csv = require('json2csv');

var validModels = {};
var modelSchemas = {};
/*
// load all the files in the models directory to figure out which ones are valid schemas
// load all the schemas that are used at the top level key database
var fs = require('fs');
fs.readdir("./back-end/api/models/portals", function(err, fileNames) {
    if (err) {
        console.log(err);
        return;
    }
    for (var i = 0; i < fileNames.length; i++) {
        if (fileNames[i].indexOf(".js") == -1) continue; //Exclude all non js files
        var fileNameSplit = fileNames[i].split(".js")[0]; //Will remove the .js string from the name
        validModels[fileNameSplit] = true;
    };
    for (var m in validModels) {
        modelSchemas[m] = require("./models/portals/" + m);
    }
    console.log("Portal Schema files loaded");
});

// load all the schemas that are used within a particular portal (working database)
fs.readdir("./back-end/api/models/working", function(err, fileNames) {
    if (err) {
        console.log(err);
        return;
    }
    var currentModels = [];
    for (var i = 0; i < fileNames.length; i++) {
        if (fileNames[i].indexOf(".js") == -1) continue; //Exclude all non js files
        var fileNameSplit = fileNames[i].split(".js")[0]; //Will remove the .js string from the name

        currentModels[fileNameSplit] = true;
        validModels[fileNameSplit] = true;
    };
    for (var m in currentModels) {
        modelSchemas[m] = require("./models/working/" + m);
    }
    console.log("Working Schema files loaded");
});
*/




var auth = require("./auth/auth");
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();

/*
 * getModel
 * 
 * Grabs a model from the proper tenant database using information in the request
 * i.e. the req.params.model and req.portal.db.connection
 */
var getModel = function(req, res) {

    if (validModels[req.params.model] !== true) {
        res.json({ error: "invalid model " + req.params.model });
        return null;
    }
    var modelInfo = modelSchemas[req.params.model];
    if (modelInfo && modelInfo.getModel) {
        return modelInfo.getModel(req.portal.db.connection);
    } else {
        throw req.params.model + " does not define a getModel method";
    }

};

var getModelSchemas = function() {
    return modelSchemas;
};


/*
 * getModelByName
 * 
 * Does not rely on the request to grab a model, requires a specific db in order to get the correct model!
 */
var getModelByName = function(db, schemaName) {
    if (db === null || db.connection === undefined || db.name === undefined) {
        throw "Calling getModelByName without a proper db object";
    }
    if (validModels[schemaName] !== true) {
        return null;
    }
    var modelInfo = modelSchemas[schemaName];
    if (modelInfo && modelInfo.getModel) {
        return modelInfo.getModel(db.connection);
    } else {
        throw schemaName + " does not define a getModel method";
    }
};


/*
 * getSchemaByName
 * 
 * Mostly useful for metadata, for actual data see getModel or getModelByName
 */
var getSchemaByName = function(schemaName) {
    if (validModels[schemaName] !== true) {
        return null;
    }
    var modelInfo = modelSchemas[schemaName];
    if (modelInfo && modelInfo.schema) {
        return modelInfo.schema;
    }

    return null;

};

/*
 * hasProperty
 * 
 * checks if the schema passed has the given property
 * 
 */
var hasProperty = function(schemaName, property) {
    var schemaInfo = modelSchemas[schemaName];
    if (!property || !schemaInfo || !schemaInfo.schema || !schemaInfo.schema.tree) return false;
    return schemaInfo.schema.tree[property];
};

/*
 * validatePermission
 * 
 * checks if user has a valid CRUD permission to work with a specific model
 * 
 */
var validatePermission = function(req, res, callback) {
    if (_.isObject(req) && _.isString(req.method) && _.isString(req.params.model)) {
        var methodSubstring = null;
        switch (req.method.toUpperCase()) {
            case "POST":
                methodSubstring = "CREATE";
                break;
            case "GET":
                methodSubstring = "READ";
                break;
            case "PUT":
                methodSubstring = "UPDATE";
                break;
            case "DELETE":
                methodSubstring = "DELETE";
                break;
        }

        if (methodSubstring !== null) {
            var modelSubstring = req.params.model.toUpperCase();
            // returns true if it has at least one of the permissions in the array
            // in this case is checking for something like VIEW_ORDER or VIEW_*
            auth.hasOneOfPermission(
                req.portal.db,
                req.user, [
                    methodSubstring + "_" + modelSubstring,
                    methodSubstring + "_*"
                ],
                // err callback
                function() {
                    res.statusMessage = "Yo do not have permission to perform the requested operation";
                    console.log(req.user._id + " request was denied because lacked " + methodSubstring + " permission on model " + req.params.model);
                    res.status(403).end();
                },
                // success callback
                callback
            );
        }

    }

};

/*
 * getEid : 
 *
 */
var getIdFields = function(list, modelInfo) {
    if (_.isObject(modelInfo) && _.isObject(modelInfo.eids) && modelInfo.eids.hasOwnProperty(list)) {
        return modelInfo.eids[list];
    } else {
        return null;
    }
};

/** 
 * this function will call setEid() defined in schema if getIdFields produce null
 */
var getEidFromSchema = function(key, modelInfo, model_id) {
    if (_.isObject(modelInfo) && _.isFunction(modelInfo.setEid)) {

        return modelInfo.setEid(key, model_id);
    } else {
        return null;
    }
}
var getEid = function(list, item, modelInfo, model_id) {
    var eidFields = getIdFields(list, modelInfo);
    if (eidFields !== null) {
        var keyParts = [];
        for (var i = 0; i < eidFields.length; i++) {
            var field = eidFields[i]; //(item["department"])["_id"]
            var obj = item[field];
            if (_.isObject(obj)) {
                obj = obj._id;
            }
            //keyParts.push(obj._id);// why obj._id?????
            keyParts.push(obj);
        }
        return keyParts.join(".");
    } else {
        var eid = getEidFromSchema(list, modelInfo, model_id)
        return eid;
    }
    return null;
};

/*
 * execute a JavaScript function when it have its name as a string
 *
 */
function executeFunctionByName(functionName, context) {
    var args = [].slice.call(arguments).splice(2);
    var namespaces = functionName.split(".");
    var func = namespaces.pop();
    for (var i = 0; i < namespaces.length; i++) {
        context = context[namespaces[i]];
    }
    return context[func].apply(context, args);
}

/*
 * has method
 * check if object (/model) has given method
 */
var hasMethod = function(schemaName, property) {
    var schemaInfo = modelSchemas[schemaName];
    if (typeof schemaInfo[property] === 'function') {
        return true;
    } else if (typeof schemaInfo[property] === 'undefined') {
        return false;
    } else {
        console.log(property + "() is not definer in " + schemaName + " model.");
        return false;
    }
};

/*
 * Catch-all, all the requests for models will come through here first. We verify the auth_token here before continuing
 *
 */
router.use(function(req, res, next) {
    if (req.headers && req.headers.hasOwnProperty("x-auth-token")) {
        // get the redis client and try to get the corresponding object using the auth_token as a key
        var redisClient = redis.getClient();
        redisClient.get('auth_token.' + req.headers["x-auth-token"], function(err, reply) {
            if (err || !reply) {
                res.statusMessage = "Session expired. please login again";
                res.status(401).end();
                return;
            }

            // refresh the session expire to 20 mins
            redisClient.expire('auth_token.' + req.headers["x-auth-token"], 28800);
            req.user = JSON.parse(reply);
            // continue evaluating routes
            next();


        });
    } else {
        res.json({ error: "Missing Authentication: Please sign in" });
        return;
    }
});

/**
 * a temp function to create showroom stock number string type
 */
function saveSupplierStockString(doc, Model) {
    if (doc.supplierStockNumber) {
        var query = { _id: doc._id },
            update = { 'supplierStockString': doc.supplierStockNumber.toString() };

        // Find the document
        Model.findOneAndUpdate(query, update, function(error, result) {
            if (error) {
                console.error("problem updating supplierStockNumber");
            } else {
                console.log("updated showroom for id" + doc._id);
            }
        });
    }
}

router.route("/nextId/:model") //to get the next order number/ id if using mongoose-auto-increment
    .get(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (_.isFunction(Model.nextCount)) {
            Model.nextCount(function(err, count) {
                if (err) {
                    res.send(err);
                }
                res.json({ count: count });
            });
        } // if(model) ends here
    });

router.route("/connector/:model/:model_id")
    .delete(function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);

            if (Model) {
                Model.findById(req.params.model_id, function(err, raw) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    model = raw._doc || raw;

                    // this field will save what connector id is active and send it to frontend for further process
                    // it will be removed once we have a route who find out the actice connector
                    var activeConnector = {};
                    // this raw seems to be the loaded doc before updating it!
                    // we're passing raw here because in the eent of a validator error, it will contain the error 

                    //---------------------------------------------
                    // deleteItem(model, id, item, callback) : update a record in qb.
                    //---------------------------------------------
                    var returnObj = [];
                    var returnSuccessObj = raw;
                    async.waterfall([
                        checkAccountingGateway,
                        checkEcommerceGateway,
                    ], function(err, resObj) {
                        if (err) {
                            res.status(409).send({ message: err.message });
                            return;
                        } else {
                            console.log("delete response: " + returnObj);
                            if (activeConnector) {
                                raw.activeConnector = activeConnector;
                                raw._doc.activeConnector = activeConnector;
                            }
                            res.json(raw);
                            return;
                        }
                    });

                    function checkAccountingGateway(callback) {
                        // First check if there is an accounting gateway and we can get an active connector
                        if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {
                            accountingGateway.getActiveConnector(req, function(connector) {
                                // if the connector exists and it is active...
                                if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                    if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                        // call its postItem method to save this m

                                        // accounting_connector - array containing all the connector info
                                        var accounting_ids = model.accounting_ids;
                                        var accounting_id = null;
                                        // accounting_id associating with active Connector
                                        var connectorId = connector.data.type._id;
                                        activeConnector.accountingConnector = connectorId;
                                        for (var key in accounting_ids) {
                                            if (accounting_ids[key].connector_id === connectorId) {
                                                accounting_id = accounting_ids[key].id;
                                            }
                                        }
                                        // if the connector exists and it is active...
                                        if (accounting_id !== null && _.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                            connector.deleteItem(req, req.params.model, accounting_id, function(err, deletedItem) {
                                                if (err) {
                                                    returnObj.push("accounting system deleteItem failed");
                                                    callback(err, returnObj);
                                                    // res.statusMessage = "Error: Connector failed to save this record on the accounting system.";
                                                    // res.status(200).end();
                                                    // return;
                                                } else {
                                                    //need to remove ecommerce if from model also!!
                                                    returnObj.push("accounting system deleteItem success");
                                                    callback(null, returnObj);
                                                }
                                            });
                                        } else {
                                            returnObj.push("Delete: Accounting accounting_id does not exists");
                                            callback(null, returnObj);
                                        }
                                    } // isAccountingModel() end
                                    else {
                                        returnObj.push("Delete: Accounting connector does not exists");
                                        callback(null, returnObj);
                                        // res.json(raw);
                                        // return;
                                    }
                                } else { // if the connector is not active/authorized
                                    returnObj.push("Delete: Accounting connector does not exists");
                                    callback(null, returnObj);
                                    // res.json(raw);
                                    // return;
                                }
                            });
                        } else {
                            returnObj.push("Delete: Account connector does not exists");
                            callback(null, returnObj);
                        }
                    }

                    function checkEcommerceGateway(returnObj, callback) {
                        if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector)) {
                            ecommerceGateway.getActiveConnector(req, function(connector) {
                                if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                    if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                        // call its postItem method to save this m
                                        // accounting_connector - array containing all the connector info
                                        var ecommerce_ids = model.ecommerce_ids;
                                        var ecommerce_id = null;
                                        // ecommerce_id associating with active Connector
                                        var connectorId = connector.data.type._id;
                                        activeConnector.ecommerceConnector = connectorId;
                                        for (var key in ecommerce_ids) {
                                            if (ecommerce_ids[key].connector_id === connectorId) {
                                                ecommerce_id = ecommerce_ids[key].id;
                                            }
                                        }
                                        // if the connector exists and it is active...
                                        if (ecommerce_id !== null && _.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                            connector.deleteItem(req, req.params.model, ecommerce_id, raw, function(err, deletedItem) {
                                                if (err) {
                                                    returnObj.push("ecommerce system deleteItem return null;");
                                                    callback(err, returnObj);
                                                    // res.statusMessage = "Connector failed to save this record on accounting system.";
                                                    // res.status(200).end();
                                                    // return;
                                                } else {
                                                    returnObj.push("ecommerce system deleteItem success;");
                                                    callback(null, returnObj);
                                                }
                                            });
                                        } else {
                                            returnObj.push("Delete: Ecommerce ecommerce_id does not exists");
                                            callback(null, returnObj);
                                        }
                                    } else {
                                        returnObj.push("Delete: Ecommerce connector does not exists");
                                        callback(null, returnObj);
                                    }
                                } else {
                                    returnObj.push("Delete: Ecommerce connector is not active/authorized");
                                    callback(null, returnObj);
                                }
                            });
                        } else {
                            returnObj.push("Delete: Ecommerce connector does not exists");
                            callback(null, returnObj);
                        }
                    }




                })
            };
        });
    });

/**
 * For bulk operation
 * for now only support for one/multiple insert
 * $http.post("api/models/bulk/modelName", obj);  where obj can be one obj or array of objs
 */

router.route("/bulk/:model")
    .post(jsonParser, function(req, res) { //create

        validatePermission(req, res, function() {

            var Model = getModel(req, res);
            var resultSet = [];
            if (Model) {
                var responseList = [];
                async.eachSeries(req.body, function(doc, callback) {
                        var model = new Model();
                        for (var prop in doc) {
                            model[prop] = doc[prop];
                        }
                        model.save(function(err, result) {
                            if (err || result == null) {
                                callback(err, null);
                            } else {
                                saveSupplierStockString(result, Model);
                                resultSet.push(result);
                                callback(null, result);
                            }
                        });
                    },
                    function(err, response) {
                        if (err) {
                            res.json(err);
                            return;
                        } else {
                            res.json(resultSet);
                            return;
                        }
                    }
                );
            }
        });
    })
    .put(jsonParser, function(req, res) { //create

        validatePermission(req, res, function() {

            var Model = getModel(req, res);
            var resultSet = [];
            if (Model) {
                var reqBody = req.body;
                if (reqBody && reqBody.query) {
                    var query = reqBody.query;

                    Model.update(query._filter, query._updateObj, query._option, function(err, raw) {
                        if (err) {
                            console.error("Error " + err);
                            res.send(err);
                            return;
                        } else {
                            res.json(raw);
                        }
                    });
                    /*var query = reqBody.query;
                        
                    var qry = Model["update"](JSON.stringify(query._filter), JSON.stringify(query._updateObj));
                    if ((typeof query._projection != 'undefined'))
                        qry.select(query._projection);
                    if ((typeof query._order != 'undefined'))
                        qry.sort(query._order);
                    if ((typeof query._skip != 'undefined'))
                        qry.skip(query._skip);
                    if ((typeof query._limit != 'undefined'))
                        qry.limit(query._limit);
                    if ((typeof query._sort != 'undefined'))
                        qry.sort(query._sort);
                    if ((typeof query._option != 'undefined'))
                        qry.option(query._option);

                    qry.exec(function(err, retrunObj) { //retrunObj : count in case of count method || find 
                        if (err) {
                            res.send(err);
                            return;
                        } else {
                            res.json(retrunObj);
                            return;
                        }
                    });*/

                } else {
                    console.error("Error: " + "request body is not defined!");
                    res.send("request body is not defined!");
                    return;
                }
            }
        });
    })
    .delete(jsonParser, function(req, res) {
        validatePermission(req, res, function() {

            var Model = getModel(req, res);
            if (Model) {
                var model = new Model();
                //Site.deleteMany({ userUID: uid, id: { $in: [10, 2, 3, 5]}}, function(err) {})

                model.deleteMany(query, function(err) {
                    if (err) {
                        console.error("Error " + err);
                        res.send(err);
                        return;
                    } else {
                        res.json(raw);
                    }
                });

            }
        });
    })

//bulk delete router
//this router works when you send the field name and the list of values you want to compare.
//example field is _id and list is [1,2,3,4] etc.
router.route("/bulk_delete/:model")
    .put(jsonParser, function(req, res) {

        validatePermission(req, res, function() {
            if (req.body && req.body.field && _.isArray(req.body.list)) {
                var Model = getModel(req, res);
                var resultSet = req.body.list;
                var _fieldName = req.body.field;
                var query = {};
                query[_fieldName] = { "$in": resultSet };
                if (Model) {
                    Model.deleteMany(query, function(err) {
                        if (err) {
                            console.error("Error " + err);
                            res.send(err);
                            return;
                        } else {
                            res.json("Queue Cleared Successfully");
                        }
                    });
                }
            } else {
                res.error("Request body format error.");
            }
        });
    });


/*Sorting router.

 /* this function checks the fields object format for sorting like example { field1:-1 , field2:1 } 
            if the format is wrong it just returns the data with out sorting based on limit and skip */
var checkSortObject = function(sOjbect) {
    if (sOjbect !== null && sOjbect !== undefined) {
        var Obj = JSON.parse(sOjbect);
        if (_.isObject(Obj)) {
            var objKeys = Object.keys(Obj);
            for (var i = 0; i < objKeys.length; i++) {
                if (Obj[objKeys[i]] != -1 && Obj[objKeys[i]] != 1) {
                    return {};
                }
            }
            return Obj;
        }
    }
    return {};
}

/*to get the sorted list for any model.
this router works with the service ListViewService. */
router.route("/sort/:model")
    .get(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            var sortQuery = req.query;
            var skipCount = 0;
            var limitCount = 20;

            if (Model) {
                var reqQuery = checkSortObject(sortQuery.fields);
                /* below two conditions check the skip and limit values otherwise by default it returns 20 records */
                if (req.query.skip !== null && req.query.skip !== undefined && !isNaN(req.query.skip)) {
                    if (Number(req.query.skip) && Number(req.query.skip) % 1 == 0) {
                        skipCount = Number(req.query.skip);
                    }
                }
                if (req.query.limit !== null && req.query.limit !== undefined && !isNaN(req.query.limit)) {
                    if (Number(req.query.limit) && Number(req.query.skip) % 1 == 0) {
                        limitCount = Number(req.query.limit);
                    }
                }
                Model.find().sort(reqQuery).skip(skipCount).limit(limitCount).exec(
                    function(err, data) {
                        if (err) {
                            res.send(err);
                        } else {
                            res.json(data);
                            return;
                        }
                    }
                );
            }
        });
    });

/*Sorting router ends router*/

/* Filter router.
            
            
 This function checks the search text object passed by the controller
            and neglects if it is not good format */
var checkFilterObject = function(sOjbect) {
    if (sOjbect !== null && sOjbect !== undefined) {
        var Obj = JSON.parse(sOjbect);
        if (_.isObject(Obj)) {
            var objKeys = Object.keys(Obj);
            for (var i = 0; i < objKeys.length; i++) {
                if (Obj[objKeys[i]] !== null && Obj[objKeys[i]] !== undefined) { //each search field passed.
                    var _objEle = { $regex: '', $options: "i" };
                    _objEle.$regex = '.*' + Obj[objKeys[i]] + '.*';
                    Obj[objKeys[i]] = _objEle;
                } else {
                    delete Obj[objKeys[i]];
                }
            }
            return Obj;
        }
    }
    return {};
}

/*to get the filtered data for the given model.
this router works with the service ListViewService. */

router.route("/filter/:model")
    .get(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            var sortQuery = req.query;
            var skipCount = 0;
            var limitCount = 20;


            if (Model) {
                var reqQuery = checkFilterObject(sortQuery.fields);
                /* below two conditions check the skip and limit values otherwise by default it returns 20 records */
                if (req.query.skip !== null && req.query.skip !== undefined && !isNaN(req.query.skip)) {
                    if (Number(req.query.skip) && Number(req.query.skip) % 1 == 0) {
                        skipCount = Number(req.query.skip);
                    }
                }
                if (req.query.limit !== null && req.query.limit !== undefined && !isNaN(req.query.limit)) {
                    if (Number(req.query.limit) && Number(req.query.skip) % 1 == 0) {
                        limitCount = Number(req.query.limit);
                    }
                }
                Model.find(reqQuery).skip(skipCount).limit(limitCount).exec(
                    function(err, data) {
                        if (err) {
                            res.send(err);
                        } else {
                            res.json(data);
                            return;
                        }
                    }
                );
            }
        });
    });

/*Filter router ends here*/
// Get a list of model populated by another model :referenceModel in the attribute :attribute
router.route("/:model/populate/:referenceModel/:attribute")
    .get(function(req, res) {
        validatePermission(req, res, function() {
            var model = getModelByName(req.portal.db, req.params.model);
            var referenceModel = getModelByName(req.portal.db, req.params.referenceModel);

            model.find({}).populate({ path: req.params.attribute, model: referenceModel }).exec(function(err, model) {
                if (err) {
                    res.send(err);
                    return;
                }
                res.json(model);
            });
        });
    });

// Get the model :model populated by another model :referenceModel in the attribute :attribute
router.route("/:model/:modelId/populate/:referenceModel/:attribute")
    .get(function(req, res) {
        validatePermission(req, res, function() {
            var model = getModelByName(req.portal.db, req.params.model);
            var referenceModel = getModelByName(req.portal.db, req.params.referenceModel);

            model.findById(req.params.modelId).populate({ path: req.params.attribute, model: referenceModel }).exec(function(err, model) {
                if (err) {
                    res.send(err);
                    return;
                }
                res.json(model);
            });

        });
    });

// Post a new model or get all the models (requests without id)
router.route("/:model")
    .post(jsonParser, function(req, res) { //create

        validatePermission(req, res, function() {

            var Model = getModel(req, res);
            if (Model) {
                var model = new Model();
                for (var prop in req.body) {
                    model[prop] = req.body[prop];
                }
                var modelInfo = modelSchemas[req.params.model];

                if (_.isFunction(modelInfo.prePersist)) {
                    model = modelInfo.prePersist(model, model);
                }

                model.save(function(err, raw) {
                    if (err) {
                        res.send(err);
                        return;
                    } else {
                        var returnObj = [];
                        var returnSuccessObj = model;
                        async.waterfall([
                            insertSupplierStockString,
                            checkAccountingGateway,
                            checkEcommerceGateway,
                        ], function(err, resObj) {
                            if (err) {
                                raw = raw._doc || raw;
                                raw.message = err.message;
                                res.status(409).send(raw);
                                return;
                            } else {
                                console.log("post response: " + returnObj);
                                res.json(returnSuccessObj);
                                return;
                            }
                        });

                        // --------------
                        // after saveing the record in showroom updated SupplierStockString
                        // post save mongoose middleware
                        // --------------

                        function insertSupplierStockString(callback) {
                            if (_.isFunction(modelInfo.postPersist)) {
                                model = modelInfo.postPersist(model);
                                if (model == false) {
                                    returnObj.push("post persist retrun false");
                                    callback(null, returnObj);
                                    return;
                                }
                                var query = { _id: model._doc._id },
                                    options = { new: true };

                                // Find the document
                                Model.findOneAndUpdate(query, model, options, function(error, result) {
                                    if (error) {
                                        returnObj.push("problem updating supplierStockNumber");
                                        callback(err, returnObj);
                                    } else {
                                        returnSuccessObj = result;
                                        returnObj.push("supplierStockNumber updated");
                                        callback(null, returnObj);
                                    }
                                    // console.log("postPersist method failed at route /:model, method post");
                                    // console.log("postPersist found and saved the record");
                                    // do something with the document
                                });

                            } else {
                                callback(null, returnObj)
                            }

                        }

                        // --------------
                        // Hook to connect to the accounting system to sync the model we just saved in our database
                        // --------------

                        function checkAccountingGateway(returnObj, callback) {
                            // First check if there is an accounting gateway and we can get an active connector
                            if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {
                                accountingGateway.getActiveConnector(req, function(connector) {
                                    // accounting connector used
                                    // if the connector exists and it is active...
                                    if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                        if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                            // call its postItem method to save this m
                                            connector.postItem(req, req.params.model, model, function(err, accountingId) { //item with accounting ID
                                                if (err || accountingId === null) {
                                                    returnObj.push("accounting system postItem return null;");
                                                    callback(err, returnObj);
                                                    // res.statusMessage = "Error: Connector failed to save this record on the accounting system.";
                                                    // res.status(200).end();
                                                    // return;
                                                } else {
                                                    // inserting accounting_ids info to the target collection
                                                    var newAccountingId = {
                                                        connector_id: connector.data.type._id,
                                                        id: accountingId
                                                    };

                                                    Model.findByIdAndUpdate({ _id: raw._id }, { $addToSet: { accounting_ids: newAccountingId } }, { runValidators: true }, function(err, raw) {
                                                        if (err) {
                                                            returnObj.push("error fetching record after accounting postItem function;");
                                                            callback(err, returnObj);
                                                            // res.statusMessage = "Error: Accounting ID did not saved.";
                                                            // res.status(200).end();
                                                            // return;
                                                        } else {
                                                            returnSuccessObj = raw;
                                                            returnObj.push("Accounting system postItem ends with a success");
                                                            callback(null, returnObj);
                                                            // res.send(raw);
                                                            // return;
                                                        }
                                                    });
                                                }
                                            });
                                        } // isAccountingModel() end
                                        else {
                                            returnObj.push("Post: Accounting connector does not exists");
                                            callback(null, returnObj);
                                            // res.json(raw);
                                            // return;
                                        }
                                    } else { // if the connector is not active/authorized
                                        returnObj.push("Post: Accounting connector does not exists");
                                        callback(null, returnObj);
                                        // res.json(raw);
                                        // return;
                                    }
                                });
                            } else {
                                returnObj.push("Post: Accounting connector does not exists");
                                callback(null, returnObj);
                            }
                        }

                        function checkEcommerceGateway(returnObj, callback) {
                            if (!_.isFunction(modelInfo.isModelSyncEcommerce) || modelInfo.isModelSyncEcommerce(raw, model)) {
                                if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector)) {
                                    ecommerceGateway.getActiveConnector(req, function(connector) {
                                        if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                            if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                                // call its postItem method to save this m
                                                connector.postItem(req, req.params.model, raw, function(err, ecommerceId) {
                                                    if (err || ecommerceId === null) {
                                                        var uobj = {};
                                                        if (_.isFunction(modelInfo.modelEcommerceFailure)) {
                                                            uobj = modelInfo.modelEcommerceFailure(req.method, raw); //make eComerce.sync = false 
                                                            Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true }, function(err, raw) {
                                                                if (err) {
                                                                    returnObj.push("modelEcommerceFailure err code");
                                                                    // callback(err, returnObj);
                                                                } else {
                                                                    returnObj.push("modelEcommerceFailure success code");
                                                                    // callback(null, raw);
                                                                }
                                                            });
                                                        }

                                                        returnObj.push("ecommerce system postItem return null;");
                                                        callback(err, returnObj);
                                                    } else {
                                                        var uobj = {};
                                                        if (_.isFunction(modelInfo.modelEcommerceSuccess)) {
                                                            uobj = modelInfo.modelEcommerceSuccess(req.method, raw); //make eComerce.sync = false 
                                                            Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true }, function(err, raw) {
                                                                if (err) {
                                                                    returnObj.push("modelEcommerceSuccess err code");
                                                                    // callback(err, returnObj);
                                                                } else {
                                                                    returnObj.push("modelEcommerceSuccess success code");
                                                                    // callback(null, raw);
                                                                }
                                                            });
                                                        }


                                                        // inserting ecommerce_ids info to the target collection
                                                        var newEcommerceId = {
                                                            connector_id: connector.data.type._id,
                                                            id: ecommerceId
                                                        };

                                                        Model.findByIdAndUpdate({ _id: raw._id }, { $addToSet: { ecommerce_ids: newEcommerceId } }, { runValidators: true }, function(err, raw) {
                                                            if (err) {
                                                                returnObj.push("error fetching record after ecommerce postItem function;");
                                                                callback(err, returnObj);
                                                                // res.statusMessage = "Error: Ecommerce ID did not saved.";
                                                                // res.status(200).end();
                                                                // return;
                                                            } else {
                                                                returnSuccessObj = raw;
                                                                returnObj.push("Post: Ecommerce update ecommerce_ids");
                                                                callback(null, returnObj);
                                                                //     res.send(raw);
                                                                //     return;
                                                            }
                                                        });

                                                    }
                                                });
                                            } else {
                                                returnObj.push("Post: Ecommerce connector does not exists");
                                                callback(null, returnObj);
                                            }
                                        } else {
                                            returnObj.push("Post: Ecommerce connector not authorized or not active");
                                            callback(null, returnObj);
                                        }
                                    });
                                } else {
                                    returnObj.push("Post: Ecommerce connector does not exists");
                                    callback(null, returnObj);
                                }
                            } else {
                                callback(null, returnObj);
                            }
                        }

                    }

                });
            }
        });
    })
    .get(function(req, res) { //select all
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                var query = {};
                if (req.query !== null && req.query !== undefined) {
                    var reqQuery = req.query;
                    for (var p in reqQuery) {
                        if (reqQuery[p].includes('*')) {
                            if (reqQuery[p].startsWith('*')) {
                                reqQuery[p] = reqQuery[p].replace('*', '');
                            } else {
                                reqQuery[p] = '^' + reqQuery[p];
                            }
                            if (reqQuery[p].endsWith('*')) {
                                reqQuery[p] = reqQuery[p].replace('*', '');
                            } else {
                                reqQuery[p] = reqQuery[p] + '\\Z';
                            }
                            reqQuery[p] = { $regex: reqQuery[p] };
                            //notes: {$regex : "ash\Z"}
                        }
                        query[p] = reqQuery[p];
                    }
                }
                Model.find(query, function(err, models) {
                    if (err) {
                        res.send(err);
                    } else {
                        res.json(models);
                        return;
                    }

                });
            }
        });
    });


// Update a model, get a single model or delete a model (requests with an id)  
router.route("/:model/:model_id")
    .get(function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err || model == null) {
                        res.send(err);
                        return;
                    }
                    // res.json(model);
                    // return;
                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        // load model-dependant references if required
                        async.waterfall([
                            loadModelReferences,
                            loadCachedReferences,
                        ], function(err, result) {
                            if (err) {
                                console.error(err);
                                res.json(model);
                                return;
                            } else {
                                res.json(result);
                                return;
                            }
                        });

                        function loadModelReferences(callback) {

                            if (_.isFunction(model.loadReferences)) {
                                model.loadReferences(req.portal.db, filledModel, function() {
                                    callback(null, filledModel);
                                });
                            } else {
                                callback(null, filledModel);
                            }
                        }

                        function loadCachedReferences(filledModel, callback) {
                            var loadCachedReferenceArray = [];
                            var schemaCache = require('../db/schema_cache');
                            var modelObj = model || model._doc; // model._doc missed virtual properties
                            for (var prop in modelObj) {

                                var loadCachedReference = function(prop) {
                                    return function(callback) {
                                        if (schemaCache.isCachedByDefault(req.portal.db, prop)) {
                                            schemaCache.get(
                                                req.portal.db,
                                                prop,
                                                modelObj[prop],
                                                function(value) {
                                                    // inject the value returned from cache in the model
                                                    filledModel[prop] = value;
                                                    callback(null); //callbacks for inner async
                                                }
                                            );
                                        } else {
                                            filledModel[prop] = modelObj[prop];
                                            callback(null); //callbacks for inner async
                                        }
                                    };
                                }
                                loadCachedReferenceArray.push(loadCachedReference(prop));
                            }
                            async.waterfall(loadCachedReferenceArray, function(err, result) {
                                if (err) {
                                    callback(err, null); //callbacks for outter async
                                } else {
                                    callback(null, filledModel); //callbacks for outter async
                                }
                            });
                        }
                    }

                });
            }
        });
    })
    .put(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);

            if (Model) {

                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        var updateObj = {};
                        for (var prop in req.body) {
                            updateObj[prop] = req.body[prop];
                        }
                        var modelInfo = modelSchemas[req.params.model];

                        if (_.isFunction(modelInfo.prePersist)) {
                            updateObj = modelInfo.prePersist(updateObj, model);
                        }
                        // Model.findByIdAndUpdate({ _id: req.params.model_id }, { $set: updateObj, $setOnInsert: { updated_at: new Date() } }, { runValidators: true, upsert: false, new: true, lean: true }, function(err, raw) {
                        Model.findByIdAndUpdate({ _id: req.params.model_id }, { $set: updateObj }, { runValidators: true, upsert: false, new: true, lean: true }, function(err, raw) {
                            if (err) {
                                res.json({ error: err.message });
                                return;
                            }
                            // this raw seems to be the loaded doc before updating it ---  we're passing raw here because in the eent of a validator error, it will contain the error 
                            else {
                                raw = raw._doc || raw;
                                var returnObj = [];
                                var returnSuccessObj = raw;
                                async.waterfall([
                                    checkAccountingGateway,
                                    checkEcommerceGateway,
                                ], function(err, resObj) {
                                    if (err) {
                                        console.log("error updating item through connector: " + JSON.stringify(err));
                                        res.status(409).send({ message: err.message });
                                        return;

                                    } else {
                                        console.log("put response: " + returnObj);
                                        res.json(returnSuccessObj);
                                        return;
                                    }
                                });

                                function checkAccountingGateway(callback) {
                                    if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {

                                        accountingGateway.getActiveConnector(req, function(connector) {
                                            if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                                if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                                    // accounting_connector - array containing all the connector info
                                                    var accounting_ids = model.accounting_ids;
                                                    var accounting_id = null;
                                                    // accounting_id associating with active Connector
                                                    var connectorId = connector.data.type._id;
                                                    for (var key in accounting_ids) {
                                                        if (accounting_ids[key].connector_id === connectorId) {
                                                            accounting_id = accounting_ids[key].id;
                                                        }
                                                    }

                                                    //if accounting_id is defined just update 
                                                    if (accounting_id !== null) {
                                                        //to update a record on QB we need ID (accountind_id) and sync token
                                                        connector.putItem(req, req.params.model, accounting_id, raw, function(err, updatedItem) {
                                                            if (err || updatedItem === null) {
                                                                returnObj.push("accounting system putItem return null;");
                                                                callback(err, returnObj);
                                                                // res.statusMessage = "Error: Connector did not update this record on the accounting system.";
                                                                // res.status(200).end();
                                                                // return;
                                                            } else {
                                                                Model.findById({ _id: req.params.model_id }, function(err, updatedModel) {
                                                                    updatedModel = updatedModel._doc || updatedModel;
                                                                    if (err || updatedModel === null) {
                                                                        returnObj.push("error fetching record after accounting putItem function;");
                                                                        callback(err, returnObj);
                                                                        // res.send(err);
                                                                        // return;
                                                                    } else {
                                                                        returnSuccessObj = updatedModel;
                                                                        returnObj.push("Accounting system putItem ends with a success");
                                                                        callback(null, returnObj);

                                                                        //     res.json(updatedModel);
                                                                        //     return;
                                                                    }
                                                                });
                                                            }
                                                        });

                                                    } else { //if accountind_id is not defined then create a new model
                                                        connector.postItem(req, req.params.model, raw, function(err, accountingId) { //item with accounting ID
                                                            if (err || accountingId === null) {
                                                                returnObj.push("accounting system postItem return null");
                                                                callback(err, returnObj);
                                                                // res.statusMessage = "Connector failed to save this record on accounting system.";
                                                                // res.status(200).end();
                                                                // return;
                                                            } else {
                                                                // inserting accounting_ids info to the target collection
                                                                var newAccountingId = {
                                                                    connector_id: connector.data.type._id,
                                                                    id: accountingId
                                                                };

                                                                Model.findByIdAndUpdate({ _id: req.params.model_id }, { $addToSet: { accounting_ids: newAccountingId } }, { runValidators: true }, function(err, raw) {
                                                                    if (err) {
                                                                        returnObj.push("error fetching record after postItem function;");

                                                                        callback(err, returnObj);
                                                                        // res.statusMessage = "Error: Accounting ID did not saved.";
                                                                        // res.status(200).end();
                                                                        // return;
                                                                    } else {
                                                                        returnObj.push("Accounting system postItem ends with a success");
                                                                        returnSuccessObj = raw;
                                                                        callback(err, returnObj);
                                                                        // res.send(raw);
                                                                        // return;
                                                                    }
                                                                });

                                                            }
                                                        });
                                                    }
                                                } else {
                                                    returnObj.push("connector.isAccountingModel return false");
                                                    callback(null, returnObj);
                                                    //     res.json(raw);
                                                    //     return;
                                                }

                                            } else {
                                                returnObj.push("Accounting system connector either not active or authorized");
                                                callback(null, returnObj);
                                                //     res.json(raw);
                                                //     return;
                                            }

                                        });
                                    } else {
                                        returnObj.push("Accounting connector does not exists");
                                        callback(null, returnObj);
                                        //     res.json(raw);
                                        //     return;
                                    }
                                }

                                function checkEcommerceGateway(returnObj, callback) {
                                    // check if we want to perform this operation or not: ! notSYNC 
                                    if (!_.isFunction(modelInfo.isModelSyncEcommerce) || modelInfo.isModelSyncEcommerce(raw, model)) {
                                        //it for model with sync and visible feature
                                        if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector)) {

                                            ecommerceGateway.getActiveConnector(req, function(connector) {
                                                if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                                    if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                                        // accounting_connector - array containing all the connector info
                                                        var ecommerce_ids = model.ecommerce_ids;
                                                        var ecommerce_id = null;
                                                        // ecommerce_id associating with active Connector
                                                        var connectorId = connector.data.type._id;
                                                        for (var key in ecommerce_ids) {
                                                            if (ecommerce_ids[key].connector_id === connectorId) {
                                                                ecommerce_id = ecommerce_ids[key].id;
                                                            }
                                                        }
                                                        //if accounting_id is defined just update 
                                                        if (ecommerce_id !== null) {
                                                            //to update a record on QB we need ID (accountind_id) and sync token

                                                            connector.putItem(req, req.params.model, ecommerce_id, raw, function(err, updatedItem) {
                                                                if (err || updatedItem === null) {
                                                                    var uobj = {};
                                                                    if (_.isFunction(modelInfo.modelEcommerceFailure)) {
                                                                        uobj = modelInfo.modelEcommerceFailure(req.method, raw); //make eComerce.sync = false 
                                                                        Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true }, function(err, raw) {
                                                                            if (err) {
                                                                                returnObj.push("modelEcommerceFailure err code");
                                                                                // callback(err, returnObj);
                                                                            } else {
                                                                                returnObj.push("modelEcommerceFailure success code");
                                                                                // callback(null, raw);
                                                                            }
                                                                        });
                                                                    }

                                                                    returnObj.push("ecommerce system putItem return null;");
                                                                    callback(err, returnObj);
                                                                    // res.statusMessage = "Error: Connector did not update this record on the accounting system.";
                                                                    // res.status(200).end();
                                                                    // return;
                                                                } else {
                                                                    var uobj = {};
                                                                    if (_.isFunction(modelInfo.modelEcommerceSuccess)) {
                                                                        uobj = modelInfo.modelEcommerceSuccess(req.method, raw); //make eComerce.sync = false 
                                                                        Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true }, function(err, raw) {
                                                                            if (err) {
                                                                                returnObj.push("modelEcommerceSuccess err code");
                                                                                // callback(err, returnObj);
                                                                            } else {
                                                                                returnObj.push("modelEcommerceSuccess success code");
                                                                                // callback(null, raw);
                                                                            }
                                                                        });
                                                                    }

                                                                    Model.findById({ _id: req.params.model_id }, function(err, updatedModel) {
                                                                        updatedModel = updatedModel._doc || updatedModel;
                                                                        if (err || updatedModel === null) {
                                                                            returnObj.push("error fetching record after ecommerce putItem function;");
                                                                            callback(err, returnObj);
                                                                            // res.send(err);
                                                                            // return;
                                                                        } else {
                                                                            returnObj.push("Ecommerce system putItem ends with a success");
                                                                            returnSuccessObj = updatedModel;
                                                                            callback(null, returnObj);
                                                                            //     res.json(updatedModel);
                                                                            //     return;
                                                                        }
                                                                    });
                                                                }
                                                            });

                                                        } else { //if accountind_id is not defined then create a new model
                                                            connector.postItem(req, req.params.model, raw, function(err, ecommerceId) { //item with accounting ID
                                                                if (err || ecommerceId === null) {
                                                                    var uobj = {};
                                                                    if (_.isFunction(modelInfo.modelEcommerceFailure)) {
                                                                        uobj = modelInfo.modelEcommerceFailure(req.method, raw); //make eComerce.sync = false 
                                                                        Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true }, function(err, raw) {
                                                                            if (err) {
                                                                                returnObj.push("modelEcommerceFailure err code");
                                                                                // callback(err, returnObj);
                                                                            } else {
                                                                                returnObj.push("modelEcommerceFailure success code");
                                                                                // callback(null, raw);
                                                                            }
                                                                        });
                                                                    }
                                                                    returnObj.push("ecommerce system postItem return null;");
                                                                    callback(err, returnObj);
                                                                    // res.statusMessage = "Connector failed to save this record on accounting system.";
                                                                    // res.status(200).end();
                                                                    // return;
                                                                } else {
                                                                    // inserting ecommerce_ids info to the target collection
                                                                    var newEcommerceId = {
                                                                        connector_id: connector.data.type._id,
                                                                        id: ecommerceId
                                                                    };
                                                                    var uobj = {};
                                                                    if (_.isFunction(modelInfo.modelEcommerceSuccess)) {
                                                                        uobj = modelInfo.modelEcommerceSuccess(req.method, raw); //make eComerce.sync = false 
                                                                        Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true }, function(err, raw) {
                                                                            if (err) {
                                                                                returnObj.push("modelEcommerceSuccess err code");
                                                                                // callback(err, returnObj);
                                                                            } else {
                                                                                returnObj.push("modelEcommerceSuccess success code");
                                                                                // callback(null, raw);
                                                                            }
                                                                        });
                                                                    }

                                                                    Model.findByIdAndUpdate({ _id: req.params.model_id }, { $addToSet: { ecommerce_ids: newEcommerceId } }, { runValidators: true }, function(err, raw) {
                                                                        if (err) {
                                                                            returnObj.push("error fetching record after ecommerce postItem function");
                                                                            callback(err, returnObj);
                                                                            // res.statusMessage = "Error: Accounting ID did not saved.";
                                                                            // res.status(200).end();
                                                                            // return;
                                                                        } else {
                                                                            returnSuccessObj = raw;
                                                                            returnObj.push("ecommerce system postItem ends with a success");
                                                                            callback(null, returnObj);
                                                                        }
                                                                        // else {
                                                                        //     res.send(raw);
                                                                        //     return;
                                                                        // }
                                                                    });

                                                                }
                                                            });
                                                        }
                                                    } else {
                                                        returnObj.push("ecommerce connector.isAccountingModel return false");
                                                        callback(null, returnObj);
                                                        //     res.json(raw);
                                                        //     return;
                                                    }
                                                } else {
                                                    returnObj.push("ecommerce system connector either not active or authorized");
                                                    callback(null, returnObj);
                                                    //     res.json(raw);
                                                    //     return;
                                                }
                                            });

                                        } else {
                                            returnObj.push("ecommerce connector does not exists");

                                            callback(null, returnObj);
                                        }
                                    } else {
                                        console.log('Ecommerce gateway skiped as sync is not active for the records');
                                        callback(null, returnObj);

                                    }

                                }


                            }
                        });
                    }
                });
            }
        });
    })
    .delete(function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);

            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    var modelInfo = modelSchemas[req.params.model];

                    if (model._doc) {
                        Model.remove({ _id: req.params.model_id }, function(err, raw) {
                            if (err) {
                                res.send(err);
                            }
                            // this field will save what connector id is active and send it to frontend for further process
                            // it will be removed once we have a route who find out the actice connector
                            var activeConnector = {};
                            // this raw seems to be the loaded doc before updating it!
                            // we're passing raw here because in the eent of a validator error, it will contain the error 

                            //---------------------------------------------
                            // deleteItem(model, id, item, callback) : update a record in qb.
                            //---------------------------------------------
                            var returnObj = [];
                            var returnSuccessObj = raw;
                            async.waterfall([
                                checkAccountingGateway,
                                checkEcommerceGateway,
                            ], function(err, resObj) {
                                if (err) {
                                    res.status(409).send({ message: err.message });
                                    return;
                                } else {
                                    console.log("delete response: " + returnObj);
                                    if (activeConnector)
                                        raw.activeConnector = activeConnector;
                                    res.json(raw);
                                    return;
                                }
                            });

                            function checkAccountingGateway(callback) {
                                // First check if there is an accounting gateway and we can get an active connector
                                if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {
                                    accountingGateway.getActiveConnector(req, function(connector) {
                                        // if the connector exists and it is active...
                                        if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                            if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                                // call its postItem method to save this m

                                                // accounting_connector - array containing all the connector info
                                                var accounting_ids = model.accounting_ids;
                                                var accounting_id = null;
                                                // accounting_id associating with active Connector
                                                var connectorId = connector.data.type._id;
                                                activeConnector.accountingConnector = connectorId;
                                                for (var key in accounting_ids) {
                                                    if (accounting_ids[key].connector_id === connectorId) {
                                                        accounting_id = accounting_ids[key].id;
                                                    }
                                                }
                                                // if the connector exists and it is active...
                                                if (accounting_id !== null && _.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                                    connector.deleteItem(req, req.params.model, accounting_id, function(err, deletedItem) {
                                                        if (err) {
                                                            returnObj.push("accounting system deleteItem failed");
                                                            callback(err, returnObj);
                                                            // res.statusMessage = "Error: Connector failed to save this record on the accounting system.";
                                                            // res.status(200).end();
                                                            // return;
                                                        } else {
                                                            //need to remove ecommerce if from model also!!
                                                            returnObj.push("accounting system deleteItem success");
                                                            callback(null, returnObj);
                                                        }
                                                    });
                                                } else {
                                                    returnObj.push("Delete: Accounting accounting_id does not exists");
                                                    callback(null, returnObj);
                                                }
                                            } // isAccountingModel() end
                                            else {
                                                returnObj.push("Delete: Accounting connector does not exists");
                                                callback(null, returnObj);
                                                // res.json(raw);
                                                // return;
                                            }
                                        } else { // if the connector is not active/authorized
                                            returnObj.push("Delete: Accounting connector does not exists");
                                            callback(null, returnObj);
                                            // res.json(raw);
                                            // return;
                                        }
                                    });
                                } else {
                                    returnObj.push("Delete: Account connector does not exists");
                                    callback(null, returnObj);
                                }
                            }

                            function checkEcommerceGateway(returnObj, callback) {
                                if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector)) {
                                    ecommerceGateway.getActiveConnector(req, function(connector) {
                                        if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                            if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                                // call its postItem method to save this m
                                                // accounting_connector - array containing all the connector info
                                                var ecommerce_ids = model.ecommerce_ids;
                                                var ecommerce_id = null;
                                                // ecommerce_id associating with active Connector
                                                var connectorId = connector.data.type._id;
                                                activeConnector.ecommerceConnector = connectorId;
                                                for (var key in ecommerce_ids) {
                                                    if (ecommerce_ids[key].connector_id === connectorId) {
                                                        ecommerce_id = ecommerce_ids[key].id;
                                                    }
                                                }
                                                // if the connector exists and it is active...
                                                if (ecommerce_id !== null && _.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                                    connector.deleteItem(req, req.params.model, ecommerce_id, raw, function(err, deletedItem) {
                                                        if (err) {
                                                            returnObj.push("ecommerce system deleteItem return null;");
                                                            callback(err, returnObj);
                                                            // res.statusMessage = "Connector failed to save this record on accounting system.";
                                                            // res.status(200).end();
                                                            // return;
                                                        } else {
                                                            returnObj.push("ecommerce system deleteItem success;");
                                                            callback(null, returnObj);
                                                        }
                                                    });
                                                } else {
                                                    returnObj.push("Delete: Ecommerce ecommerce_id does not exists");
                                                    callback(null, returnObj);
                                                }
                                            } else {
                                                returnObj.push("Delete: Ecommerce connector does not exists");
                                                callback(null, returnObj);
                                            }
                                        } else {
                                            returnObj.push("Delete: Ecommerce connector is not active/authorized");
                                            callback(null, returnObj);
                                        }
                                    });
                                } else {
                                    returnObj.push("Delete: Ecommerce connector does not exists");
                                    callback(null, returnObj);
                                }
                            }

                        })
                    }

                })
            };
        });
    });

// Working with sets
router.route("/:model/:model_id/add_to_set")
    .put(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        var addToSet = {
                            "$addToSet": {}
                        };
                        var modelInfo = modelSchemas[req.params.model];
                        var updateObj = addToSet.$addToSet;
                        for (var prop in req.body) {
                            var newObj = req.body[prop];
                            var eid = getEid(prop, newObj, modelInfo, req.params.model_id);

                            if (eid !== null) {
                                newObj["eid"] = eid;
                            }
                            updateObj[prop] = newObj;
                        }
                        Model.findByIdAndUpdate({ _id: req.params.model_id }, addToSet, { runValidators: true, new: true }, function(err, raw) {
                            if (err) {
                                res.send(err);
                                return;
                            }
                            // this raw seems to be the loaded doc before updating it!
                            // we're passing raw here because in the eent of a validator error, it will contain the error
                            Model.findById(req.params.model_id, function(err, model) {
                                res.json(model);
                            });
                        });
                    }
                });
            }
        });
    });

// Working with sets
router.route("/:model/:model_id/update_set")
    .put(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }

                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        // query to include the sub item
                        var query = { _id: req.params.model_id };
                        //query[req.params.set_identifier] = req.params.set_id;

                        var modelInfo = modelSchemas[req.params.model];

                        var updateSet = {
                            "$set": {}
                        };
                        var updateObj = updateSet.$set;

                        var propCounter = 0;
                        for (var listName in req.body) {
                            propCounter++;
                            var listItem = req.body[listName];
                            var eidFields = getIdFields(listName, modelInfo);
                            // make a  quick map of the eid fields to look them up
                            var eidMap = {};
                            for (var i = eidFields.length - 1; i >= 0; i--) {
                                var field = eidFields[i];
                                eidMap[field] = true;
                            }

                            if (_.isObject(listItem)) {
                                for (var p in listItem) {
                                    var propValue = listItem[p];
                                    if (eidMap[p] !== undefined) {
                                        query[listName + "." + p] = propValue;
                                    } else {
                                        updateObj[listName + ".$." + p] = propValue;
                                    }
                                }
                            }

                            for (var j = eidFields.length - 1; j >= 0; j--) {
                                if (query[listName + "." + eidFields[j]] === undefined) {
                                    res.send({ error: { message: "All the eid fields are required to update an embedded list item" } });
                                    return;
                                }
                            }

                            if (propCounter > 1) {
                                res.send({ error: { message: "Only one embedded list can be updated at a time" } });
                                return;
                            }
                        }

                        Model.update(query, updateSet, function(err, raw) {
                            if (err) {
                                res.send(err);
                                return;
                            }
                            // this raw seems to be the loaded doc before updating it!
                            // we're passing raw here because in the eent of a validator error, it will contain the error
                            Model.findById(req.params.model_id, function(err, model) {
                                res.json(model);
                            });
                        });
                    }
                });
            }
        });
    });


router.route("/:model/:model_id/:nested_operation/:property")
    .put(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }

                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {

                        // query to include the sub item
                        var query = { _id: req.params.model_id };
                        //query[req.params.set_identifier] = req.params.set_id;

                        var modelInfo = modelSchemas[req.params.model];

                        var updateSet = {};
                        var updateObj = {};

                        if (req.params.nested_operation) {
                            if (req.params.nested_operation == 'add') {
                                //add a new nested array record - $push
                                updateSet = {
                                    "$push": {}
                                };
                                updateObj = updateSet.$push;
                            } else if (req.params.nested_operation == 'remove') {
                                //remove a condition - $pull
                                updateSet = {
                                    "$pull": {}
                                };
                                updateObj = updateSet.$pull;
                            }
                        } else {
                            //do nothing toast mesg in valid query
                        }

                        // var updateObj = {};
                        var propCounter = 0;
                        for (var listName in req.body) {
                            propCounter++;
                            var listItem = req.body[listName];
                            var eidFields = getIdFields(listName, modelInfo);
                            // make a  quick map of the eid fields to look them up
                            var eidMap = {};
                            for (var i = eidFields.length - 1; i >= 0; i--) {
                                var field = eidFields[i];
                                eidMap[field] = true;
                            }

                            if (_.isObject(listItem)) {
                                for (var p in listItem) {
                                    var propValue = listItem[p];
                                    if (eidMap[p] !== undefined) {
                                        query[listName + "." + p] = propValue;
                                    } else if (p === req.params.property) {
                                        updateObj[listName + ".$." + p] = propValue;
                                    } else {
                                        console.log("unwanted fields in /:model/:model_id/:nested_operation/:property route")
                                    }
                                }
                            }

                            for (var j = eidFields.length - 1; j >= 0; j--) {
                                if (query[listName + "." + eidFields[j]] === undefined) {
                                    res.send({ error: { message: "All the eid fields are required to update an embedded list item" } });
                                    return;
                                }
                            }

                            if (propCounter > 1) {
                                res.send({ error: { message: "Only one embedded list can be updated at a time" } });
                                return;
                            }
                        }

                        Model.findOneAndUpdate(query, updateSet, { new: true }, function(err, raw) { // {new : true} so it will retrun updated record.
                            if (err) {
                                res.send(err);
                                return;
                            }
                            // this raw seems to be the loaded doc before updating it!
                            // we're passing raw here because in the eent of a validator error, it will contain the error
                            Model.findById(req.params.model_id, function(err, model) {
                                res.json(model);
                            });
                        });
                    }
                });
            }
        });
    });

router.route("/:model/:model_id/update_to_set")
    .put(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        var removeFromSet = {
                            "$pull": {}
                        };
                        var updateObj = removeFromSet.$pull;
                        for (var prop in req.body) {
                            updateObj[prop] = req.body[prop];
                        }
                        Model.findByIdAndUpdate({ _id: req.params.model_id }, removeFromSet, { runValidators: true, new: true }, function(err, raw) {
                            if (err) {
                                res.send(err);
                            } else {
                                // this raw seems to be the loaded doc before updating it!
                                // we're passing raw here because in the eent of a validator error, it will contain the error
                                Model.findById(req.params.model_id, function(err, model) {
                                    res.json(model);
                                });
                            }
                        });
                    }
                });
            }
        });
    });

router.route("/:model/:model_id/remove_from_set")
    .put(jsonParser, function(req, res) {
        validatePermission(req, res, function() {
            var Model = getModel(req, res);
            if (Model) {
                Model.findById(req.params.model_id, function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }
                    var filledModel = {};
                    var pendingCallBacks = [];
                    if (model._doc) {
                        var removeFromSet = {
                            "$pull": {}
                        };
                        var updateObj = removeFromSet.$pull;
                        for (var prop in req.body) {
                            updateObj[prop] = req.body[prop];
                        }
                        Model.findByIdAndUpdate({ _id: req.params.model_id }, removeFromSet, { runValidators: true, new: true }, function(err, raw) {
                            if (err) {
                                res.send(err);
                            } else {
                                // this raw seems to be the loaded doc before updating it!
                                // we're passing raw here because in the eent of a validator error, it will contain the error
                                Model.findById(req.params.model_id, function(err, model) {
                                    res.json(model);
                                });
                            }
                        });
                    }
                });
            }
        });
    });



//==============================
//=========search filter========
//==============================
router.route("/search/:model/:query_function") //search in the model schema for query function
    .get(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            if (hasMethod(req.params.model, req.params.query_function)) {

                var modelInfo = modelSchemas[req.params.model];
                var query = executeFunctionByName(req.params.query_function, modelInfo, req.body);

                var qry = Model.find(query._filter);

                if ((typeof query._projection != 'undefined'))
                    qry.select(query._projection);
                if ((typeof query._order != 'undefined'))
                    qry.sort(query._order);
                if ((typeof query._limit != 'undefined'))
                    qry.limit(query._limit);

                qry.exec(function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }

                    res.json(model);
                });
            } // if(hasMethod) ends here
        } // if(model) ends here
    });

router.route("/:model/:query_function/:value") //search in the model schema for query function
    .get(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            if (hasMethod(req.params.model, req.params.query_function)) {

                var modelInfo = modelSchemas[req.params.model];
                var query = executeFunctionByName(req.params.query_function, modelInfo, req.params.value);
                var qry = Model.find(query._filter);

                if ((typeof query._query != 'undefined'))
                    qry = Model[query._query](query._filter);
                if ((typeof query._aggregate != 'undefined'))
                    qry = Model.aggregate(query._aggregate);
                if ((typeof query._projection != 'undefined'))
                    qry.select(query._projection);
                if ((typeof query._order != 'undefined'))
                    qry.sort(query._order);
                if ((typeof query._sort != 'undefined'))
                    qry.sort(query._sort);
                if ((typeof query._limit != 'undefined'))
                    qry.limit(query._limit);
                qry.exec(function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }

                    res.json(model);
                });
            } // if(hasMethod) ends here
        } // if(model) ends here
    })
    .put(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            if (hasMethod(req.params.model, req.params.query_function) && _.isArray(req.body) && req.params.value == "update") {

                var modelInfo = modelSchemas[req.params.model];
                var query = executeFunctionByName(req.params.query_function, modelInfo);
                var qry = Model.update({
                    _id: {
                        "$in": req.body
                    }
                }, query._filter, { multi: true });

                if ((typeof query._projection != 'undefined'))
                    qry.select(query._projection);
                if ((typeof query._order != 'undefined'))
                    qry.sort(query._order);
                if ((typeof query._limit != 'undefined'))
                    qry.limit(query._limit);

                qry.exec(function(err, model) {
                    if (err) {
                        res.send(err);
                        return;
                    }

                    res.json(model);
                });
            } // if(hasMethod) ends here
        } // if(model) ends here
    });



/**
 * csv uploader route
 */
var multipart = require('connect-multiparty');

var csv = require('fast-csv');
var multipartMiddleware = multipart();
var uploaderCount = 0;

// csv functions
function calculateCSVField(field, value) {
    switch (field) {
        case 'purchaseDate':
            var d = new Date();
            var dateVar = value.split('/');
            if (dateVar.length == 3) {
                d.setDate(dateVar[0]);
                d.setMonth((parseInt(dateVar[1]) - 1));
                d.setFullYear(dateVar[2]);
                return d;
            } else {
                return null;
            }
            break;

        default:
            console.log("undefined field name in calcylateCSVField function");
            break;
    }
}
router.route("/csv/upload/:model") //search in the model schema for query function
    .post(multipartMiddleware, function(req, res) {
        if (!(Object.keys(req.files).length === 0 && req.files.constructor === Object)) { // false request.
            var file = req.files.file;
            var images = [];
            var src = file.path;

            uploaderCount = 0;
            fs.createReadStream(src)
                .pipe(csv())
                .on("data", function(data) {

                    // 0             1            2           3           4       5         6           7            8           9           10         11        12           13          14          15     16          17              18         19     20    21          22          23         24                                               25         26           27        28          
                    //[STOCK_NUM','PURCH_DATE','PURCH_NUM','CONSIGMENT','COST','SUPPLIER','SUPPL_NUM','SUPPL_INV','PURCH_INIT','SALE_PRICE','STATUS','SOLD_BY','SOLD_DATE','SOLD_PRICE','INVOICE','JOURNAL','REFERENCE','TYPE',        'COUNTRY','COLOR','WIDTH','LENGTH','COMMENT_1','COMMENT_2','COMMENT_3',                                  'COMMENT_4','COMMENT_5','INITIALS','RESERVED' ]
                    // ['9963i',  '01/02/1989', '18609',     'FALSE',    '28',   'ANGLO',     '',         '',       'SUPERUSER',  '56',      'SOLD',   'AMIR',   '20/12/1990', '30',     '135821',    '',        '',    'CHINESE SILK', 'CHINA', 'GREEN', '0.305', '0.305', '',           '',     'RUG #106  CHINESE SILK  1X1  0228T9  $56.00', '',            '',      'SUPERUSER', '']
                    // supplierStockNumber purchaseDate ownership cost Supplier Void Void Void Sticker price Status Rug type Country Colour Yup Yup Yup Nope Status
                    //
                    if (data[0] != 'STOCK_NUM' && data[10] == 'SHOWROOM') {
                        var doc = {
                            rug: {
                                length: '',
                                width: '',
                                stickerPrice: 0
                            },
                            consignment: {
                                agreedRevisedDate: null,
                                agreedLowPrice: 0,
                                agreedHighPrice: 0,
                                contract: '',
                                customerName: null,
                                costpsf: 0,
                                cost: 0
                            },
                            stock: {
                                assessDate: null,
                                landed: 0,
                                landedpsf: 0,
                                markup: 0,
                                suggestedPrice: 0,
                                supplierInvoiceNumber: '',
                                supplierName: '',
                                supplierSizes: 0,
                                profitMargin: ''
                            },
                            created: new Date(),
                            generalComments: '',
                            onApproval: false,
                            onProgram: false,
                            ownership: '',
                            purchaseDate: null,
                            status: 'available',
                            isOnEcommerance: false,

                            _colourTags: '',
                            _country: '',
                            _rugType: '',
                            _stockNumber: '',
                            _purchaseDate: '',
                            uploadedItem: false
                        }

                        doc['_stockNumber'] = data[0];
                        //calculate date 
                        doc['purchaseDate'] = calculateCSVField('purchaseDate', data[1]);

                        //calculate ownership field
                        if (data[3] == 'TRUE') { //true means consignment
                            doc['ownership'] = 'consignment';
                            doc.consignment.cost = data[4];
                            delete doc['stock'];
                            // doc['consignment.customerName'] = doc[5];
                        } else {
                            doc['ownership'] = 'owned';
                            doc.stock.landed = data[4];
                            delete doc['consignment'];
                            // doc['stock.supplierName'] = doc[5];
                        }

                        doc.rug.stickerPrice = data[9];

                        if (data[20] > data[21]) { //if w > l that means w is not w but length
                            doc.rug.width = data[21];
                            doc.rug.length = data[20];
                        } else {
                            doc.rug.width = data[20];
                            doc.rug.length = data[21];
                        }

                        doc['status'] = 'available';

                        doc['_rugType'] = data[17];
                        doc['_country'] = data[18];
                        doc['_colourTags'] = data[19];
                        doc['_stickerPrice'] = data[9];
                        doc['_supplierName'] = data[5];
                        doc['_supplierNumber'] = data[6];
                        doc['isMigratedItem'] = true;
                        doc['showMigratedFields'] = true;
                        doc['GLUpdated'] = true;

                        doc['generalComments'] = data[22] + ' ' + data[23] + ' ' + data[24] + ' ' + data[25] + ' ' + data[26];

                        var Model = getModel(req, res);
                        if (Model) {
                            var model = new Model();
                            for (var prop in doc) {
                                model[prop] = doc[prop];
                            }
                            var modelInfo = modelSchemas[req.params.model];


                            model.save(function(err, raw) {
                                if (err) {
                                    console.log("err " + err);
                                    return;
                                }
                                if (_.isFunction(modelInfo.postPersist)) {
                                    model = modelInfo.postPersist(model, model);
                                    var query = { _id: model._doc._id },
                                        update = { 'supplierStockString': model._doc['supplierStockString'] },
                                        options = { upsert: true, new: true, setDefaultsOnInsert: true };

                                    // Find the document
                                    Model.findOneAndUpdate(query, update, options, function(error, result) {
                                        if (error)
                                            console.log("postPersist method failed at route /:model, method post");
                                        console.log("postPersist found and saved the record");
                                        // do something with the document
                                    });

                                }
                                console.log(++uploaderCount);

                                // console.log("raw: " + raw);
                            });
                        }
                    }

                })
                .on('error', function(err) {
                    console.log(err.message);
                    res.send(err.message);
                })
                // .on('finish', function(err) {
                //     console.log("finish uploading: uploaderCount " + uploaderCount);
                // })
                .on("end", function() {
                    res.send("finish uploading : uploaderCount " + uploaderCount);
                    console.log("done");
                });


        }
    });



/** 
 * download collection as csv
 * using json2csv | link: https://www.npmjs.com/package/json2csv
 */

// var mkdirp = require('mkdirp');
// var getDirName = require('path').dirname;
// var csv = require('csv-express');

var flatten = function(data, excludeMap) {
    var result = {};

    function recurse(cur, prop) {
        if (Object(cur) !== cur) {
            result[prop] = cur;
        } else if (Array.isArray(cur)) {
            for (var i = 0, l = cur.length; i < l; i++)
                recurse(cur[i], prop ? prop + "." + i : "" + i);
            if (l == 0)
                result[prop] = [];
        } else {
            var isEmpty = true;
            for (var p in cur) {
                isEmpty = false;
                if (excludeMap && Object(excludeMap) && excludeMap[p]) {
                    continue;
                } else if (!(_.isNull(cur[p])) && _.isObject(cur[p]._doc)) {
                    recurse(cur[p]._doc, prop ? prop + "." + p : p);
                } else {
                    recurse(cur[p], prop ? prop + "." + p : p);
                }
            }
            if (isEmpty)
                result[prop] = {};
        }
    }
    recurse(data, "");
    // console.log("flatten: " + JSON.stringify(result, null, "    "));

    return result;
}

var unflatten = function(data) {
    "use strict";
    if (Object(data) !== data || Array.isArray(data))
        return data;
    var result = {},
        cur, prop, idx, last, temp;
    for (var p in data) {
        cur = result, prop = "", last = 0;
        do {
            idx = p.indexOf(".", last);
            temp = p.substring(last, idx !== -1 ? idx : undefined);
            cur = cur[prop] || (cur[prop] = (!isNaN(parseInt(temp)) ? [] : {}));
            prop = temp;
            last = idx + 1;
        } while (idx >= 0);
        cur[prop] = data[p];
    }
    console.log("unflatten: " + JSON.stringify(result, null, "    "));
    return result;
}

router.route("/report/download/:model/:ext")
    .get(function(req, res) { //select all
        var Model = getModel(req, res);
        if (Model) {
            res.json(Model.schema.paths);
            return;
        }
    })
    .post(jsonParser, function(req, res, next) {
        var Model = getModel(req, res);
        if (Model) {

            var query = req.body;
            var fields = query._projection;

            var qry = Model.find(query._filter);
            if ((typeof query._projection != 'undefined'))
                qry.select(query._projection);
            if ((typeof query._order != 'undefined'))
                qry.sort(query._order);
            if ((typeof query._limit != 'undefined')) 5
            qry.limit(query._limit);
            if ((typeof query._lean != 'undefined') && query._lean)
                qry.lean();

            qry.exec(function(err, models) {
                if (err) {
                    res.send(err);
                    return;
                } else {
                    try {

                        //json2csv Converts json into csv with column titles and proper line endings. Can be used as a module and from the command line.
                        var result = json2csv({ data: models, fields: fields });

                        //res created
                        res.charset = this.charset || 'utf-8';
                        res.header('Content-Type', 'text/csv');
                        res.send(result);

                    } catch (err) {
                        // Errors are thrown for bad options, or if the data is empty and no fields are provided.
                        // Be sure to provide fields if it is possible that your data array will be empty.
                        res.send(err);
                        console.error(err);
                    }
                }
                // res.json(model);
            });


        }

    });

/**
 * sync ecommerce products
 */

var returnObj = [];
var count = 0;
var successUploadCount = 0;
router.route("/ecommerce/sync/:model/:type") //search in the model schema for query function
    .post(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            returnObj = [];
            count = 0;
            successUploadCount = 0;
            var type = req.params.type;
            var query = req.body;
            var uploadedItems = [];
            var failedItems = [];
            var modelInfo = modelSchemas[req.params.model];
            Model.find(query).lean().exec(function(err, models) {
                if (err) {
                    res.send(err);
                    return;
                } else {
                    async.eachSeries(models, function(raw, callback) {
                        count++;
                        if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector) && (_.isFunction(modelInfo.getEcommerceStatus))) {
                            ecommerceGateway.getActiveConnector(req, function(connector) {
                                if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                    if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                        // call its postItem method to save this m
                                        var ecommerce_ids = raw.ecommerce_ids;
                                        var ecommerce_id = null;
                                        // ecommerce_id associating with active Connector
                                        var connectorId = connector.data.type._id;
                                        for (var key in ecommerce_ids) {
                                            if (ecommerce_ids[key].connector_id === connectorId) {
                                                ecommerce_id = ecommerce_ids[key].id;
                                            }
                                        }
                                        //if accounting_id is defined just update 
                                        if (ecommerce_id !== null) {
                                            connector.putItem(req, req.params.model, ecommerce_id, raw, function(err, updatedItem) {
                                                if (err || updatedItem === null) {
                                                    failedItems.push(raw.supplierStockNumber);
                                                    callback(null, returnObj);
                                                } else {
                                                    console.log("uploading count (update): " + count + ',' + ecommerce_id);
                                                    returnObj.push(updatedItem.supplierStockString + " update");
                                                    successUploadCount++;
                                                    uploadedItems.push(raw.supplierStockNumber);
                                                    callback(null, returnObj);
                                                }
                                            });
                                        }
                                        /*
                                        else {
                                            connector.postItem(req, req.params.model, raw, function(err, ecommerceId) { //item with accounting ID
                                                if (err || ecommerceId === null) {
                                                    returnObj.push("ecommerce system postItem return null;");
                                                    callback(err, returnObj);
                                                } else {
                                                    // inserting ecommerce_ids info to the target collection
                                                    var newEcommerceId = {
                                                        connector_id: connector.data.type._id,
                                                        id: ecommerceId
                                                    };
                                                    console.log("uploading count (create): " + count);

                                                    Model.findByIdAndUpdate({ _id: raw._id }, { $addToSet: { ecommerce_ids: newEcommerceId } }, { runValidators: true }, function(err, raw) {
                                                        if (err) {
                                                            returnObj.push();
                                                            callback(err, returnObj);
                                                        } else {
                                                            returnObj.push(raw.supplierStockString + " created for eCommerece id " + ecommerceId);
                                                            successUploadCount++;
                                                            callback(null, returnObj);
                                                        }
                                                    });

                                                }
                                            });
                                        }
                                    */
                                    } else {
                                        failedItems.push(raw.supplierStockNumber);
                                        returnObj.push("Post: isAccountingModel return false");
                                        callback({ statusMessage: "Post: isEcommerceModel return false" }, returnObj);
                                    }
                                } else {
                                    failedItems.push(raw.supplierStockNumber);
                                    returnObj.push("Post:  Ecommerce connector does not exists");
                                    callback({ statusMessage: "Post:  Ecommerce connector does not exists" }, returnObj);
                                }
                            });
                        } else {
                            failedItems.push(raw.supplierStockNumber);
                            returnObj.push("Post: Ecommerce connector does not exists");
                            callback({ statusMessage: "Post:  Ecommerce connector does not exists" }, returnObj);
                        }

                    }, function(err, response) {
                        // if any of the file processing produced an error, err would equal that error
                        if (err) {
                            err["uploadedItems"] = uploadedItems;
                            err["failedItems"] = failedItems;
                            res.json(err);
                            return;
                        } else {
                            // console.log('All files have been processed successfully' + returnObj);
                            var response = {};
                            response["count"] = count;
                            response["successUploadCount"] = successUploadCount;
                            response["uploadedItems"] = uploadedItems;
                            response["failedItems"] = failedItems;
                            if (successUploadCount == 0) {
                                response["statusMessage"] = "no item sync";
                            } else {
                                response["statusMessage"] = successUploadCount + " item/s sync";
                            }
                            console.log(new Date() + " syncing " + req.params.model + " with " + req.params.type + " has failed items: " + failedItems.join(','));
                            res.json(response);
                            return;
                        }
                    });

                }

            });
        }
    })
    .delete(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            returnObj = [];
            var id = req.params.type;
            var query = {};
            query["_id"] = id;


            var modelInfo = modelSchemas[req.params.model];
            Model.find(query, function(err, raw) {
                if (err) {
                    res.send(err);
                } else {
                    raw = raw[0];
                    if (_.isObject(ecommerceGateway) && _.isFunction(ecommerceGateway.getActiveConnector) && (_.isFunction(modelInfo.getEcommerceStatus))) {
                        ecommerceGateway.getActiveConnector(req, function(connector) {
                            if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                    // call its postItem method to save this m
                                    var ecommerce_ids = raw.ecommerce_ids;
                                    var ecommerce_id = null;
                                    // ecommerce_id associating with active Connector
                                    var connectorId = connector.data.type._id;
                                    for (var key in ecommerce_ids) {
                                        if (ecommerce_ids[key].connector_id === connectorId) {
                                            ecommerce_id = ecommerce_ids[key].id;
                                        }
                                    }
                                    //if accounting_id is defined just update 
                                    if (ecommerce_id !== null) {
                                        connector.deleteItem(req, req.params.model, ecommerce_id, raw, function(err, response) {
                                            if (err) {
                                                returnObj.push("error fetching record after ecommerce delete function");
                                                res.json(err);
                                            } else {
                                                res.json(response);
                                            }
                                        });
                                    }
                                } else {
                                    returnObj.push("Post: isAccountingModel return false");
                                    res.json(returnObj);
                                }
                            } else {
                                returnObj.push("Post:  Ecommerce connector does not exists");
                                res.json(returnObj);
                            }
                        });
                    } else {
                        returnObj.push("Post: Ecommerce connector does not exists");
                        res.json(returnObj);
                    }


                }

            });
        }
    });

router.route("/accounting/sync/:model/:type") //search in the model schema for query function
    .post(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            returnObj = [];
            count = 0;
            successUploadCount = 0;
            var type = req.params.type;
            var query = req.body;

            var modelInfo = modelSchemas[req.params.model];
            Model.find(query).lean().exec(function(err, models) {
                if (err) {
                    res.send(err);
                    return;
                } else {
                    async.eachSeries(models, function(raw, callback) {
                        count++;
                        if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {
                            accountingGateway.getActiveConnector(req, function(connector) {
                                if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                                    if (connector.isAccountingModel(req.params.model)) { // to check if the model is required to sync with accounting system
                                        // call its postItem method to save this m
                                        var accounting_ids = raw.accounting_ids;
                                        var accounting_id = null;
                                        // ecommerce_id associating with active Connector
                                        var connectorId = connector.data.type._id;
                                        for (var key in accounting_ids) {
                                            if (accounting_ids[key].connector_id === connectorId) {
                                                accounting_id = accounting_ids[key].id;
                                            }
                                        }
                                        //if accounting_id is defined just update 
                                        if (accounting_id !== null) {
                                            connector.putItem(req, req.params.model, accounting_id, raw, function(err, updatedItem) {
                                                if (err || updatedItem === null) {
                                                    callback(err, returnObj);
                                                } else {
                                                    console.log("uploading count (update): " + count);
                                                    successUploadCount++;
                                                    callback(null, returnObj);
                                                }
                                            });
                                        } else {
                                            connector.postItem(req, req.params.model, raw, function(err, accountingId) { //item with accounting ID
                                                if (err || accountingId === null) {
                                                    returnObj.push("accounting system postItem return null;");
                                                    callback(err, returnObj);
                                                } else {
                                                    // inserting accounting_ids info to the target collection
                                                    var newAccoutingId = {
                                                        connector_id: connector.data.type._id,
                                                        id: accountingId
                                                    };
                                                    console.log("uploading count (create): " + count);

                                                    Model.findByIdAndUpdate({ _id: raw._id }, { $addToSet: { accounting_ids: newAccoutingId } }, { runValidators: true }, function(err, raw) {
                                                        if (err) {
                                                            returnObj.push();
                                                            callback(err, returnObj);
                                                        } else {
                                                            returnObj.push(raw.supplierStockString + " created for eCommerece id " + accountingId);
                                                            successUploadCount++;
                                                            callback(null, returnObj);
                                                        }
                                                    });

                                                }
                                            });
                                        }
                                    } else {
                                        returnObj.push("Post: isAccountingModel return false");
                                        callback({ statusMessage: "Post: isAccountingModel return false" }, returnObj);
                                    }
                                } else {
                                    returnObj.push("Post:  Accounting connector does not exists");
                                    callback({ statusMessage: "Post:  Accounting connector does not exists" }, returnObj);
                                }
                            });
                        } else {
                            returnObj.push("Post: Accounting connector does not exists");
                            callback({ statusMessage: "Post:  Accounting connector does not exists" }, returnObj);
                        }

                    }, function(err, response) {
                        // if any of the file processing produced an error, err would equal that error
                        if (err) {
                            res.json(err);
                            return;
                        } else {
                            // console.log('All files have been processed successfully' + returnObj);
                            var response = {};
                            response["count"] = count;
                            response["successUploadCount"] = successUploadCount;
                            if (successUploadCount == 0) {
                                response["statusMessage"] = "no item sync";
                            } else {
                                response["statusMessage"] = successUploadCount + " item/s sync";
                            }
                            res.json(response);
                            return;
                        }
                    });

                }

            });
        }
    })
    .get(function(req, res) { //select all
        validatePermission(req, res, function() {
            var query = {};
            if (req.query !== null && req.query !== undefined) {
                var reqQuery = req.query;
            }
            if (_.isObject(accountingGateway) && _.isFunction(accountingGateway.getActiveConnector)) {
                accountingGateway.getActiveConnector(req, function(connector) {
                    if (_.isObject(connector) && connector.isActive() && connector.isAuthorized()) {
                        if (connector.isAccountingModel(req.params.model)) {
                            connector.listItems(req, req.params.model, query, function(err, items) {
                                if (err || items === null) {
                                    res.send(err);
                                } else {
                                    res.json(items);
                                }
                            })
                        }
                    }
                })
            }
        })
    })



router.route("/get/:method/:model") //search in the model schema for query function
    .post(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            var query = req.body;

            var qry = Model[req.params.method](query._filter);
            if (req.params.method != 'count') {
                if ((typeof query._projection != 'undefined'))
                    qry.select(query._projection);
                if ((typeof query._order != 'undefined'))
                    qry.sort(query._order);
                if ((typeof query._skip != 'undefined'))
                    qry.skip(query._skip);
                if ((typeof query._limit != 'undefined'))
                    qry.limit(query._limit);
                if ((typeof query._sort != 'undefined'))
                    qry.sort(query._sort);
            }

            qry.exec(function(err, retrunObj) { //retrunObj : count in case of count method || find 
                if (err) {
                    res.send(err);
                    return;
                } else {
                    res.json(retrunObj);
                    return;
                }
            });
        }
    });


/**
 * patches mongodb design
 */
router.route("/patch/:model/:patch_number")
    .post(jsonParser, function(req, res) {
        var Model = getModel(req, res);
        if (Model) {
            var returnObj = [],
                count = 0,
                successUploadCount = 0;
            var patch_number = req.params.patch_number;
            var query = req.body || {}; //{ "isOnEcommerce": true };

            var modelInfo = modelSchemas[req.params.model];
            Model.find(query).lean().exec(function(err, models) {
                if (err) {
                    res.send(err);
                    return;
                } else {
                    async.eachSeries(models,
                        function(raw, callback) {
                            count++;
                            if (_.isFunction(modelInfo.patches)) {
                                var uobj = modelInfo.patches(raw, patch_number);
                                Model.findByIdAndUpdate({ _id: raw._id }, uobj, { runValidators: true, new: true }, function(err, raw) {
                                    if (err || raw == null) {
                                        console.error("error occur for id " + raw._id);
                                        callback(err, successUploadCount);

                                    } else {
                                        successUploadCount++;
                                        console.info("update id " + raw._id);
                                        callback(null, successUploadCount);
                                    }
                                });
                            } else
                                callback(null, successUploadCount);

                        },
                        function(err, response) {
                            console.log(count + "||" + successUploadCount)
                            if (err) {
                                res.json(err);
                                return;
                            } else {
                                res.json(response);
                                return;
                            }
                        }
                    );
                }

            });
        }
    })



module.exports = {
    router: router,
    getModel: getModel,
    getModelByName: getModelByName,
    getSchemaByName: getSchemaByName,
    getModelSchemas: getModelSchemas
};

// else if(p.includes('_id')){ //this code helps to 'convert a string to ObjectId in nodejs mongodb native driver?'
//      var mongoose = require('mongoose');
//      reqQuery[p] = mongoose.Types.ObjectId(reqQuery[p]);
// }